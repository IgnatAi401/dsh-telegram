/**
 * A minimal `fetch` over one shared HTTP/2 session per origin, for Bot API
 * calls. The long-polling `getUpdates` request keeps that session busy, so it
 * never idles out: a panel tap after a long pause skips the TLS handshake
 * (about a second through a distant proxy), and a tap's answer and its panel
 * write travel side by side on it. `undici`'s HTTP/2 support queues requests on
 * one session one at a time, which is why `node:http2` is used directly.
 *
 * Only requests with no body or a string body take this path; anything else
 * (multipart uploads), and every request to an origin whose HTTP/2 session
 * could not be opened, goes to `fallback`.
 * @module telegram/http2-fetch
 */
import { connect, constants } from 'node:http2';
import { Readable } from 'node:stream';
/** How long a stalled request waits for a PING answer before its session is dropped. */
const PING_TIMEOUT_MS = 5000;
/** After a session fails to open, that origin uses `fallback` for this long. */
const REFUSED_MS = 10 * 60_000;
/** The HTTP/2 session never opened (no route, a proxy without HTTP/2, a TLS failure). */
class ConnectError extends Error {
    cause;
    constructor(cause) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.cause = cause;
    }
}
/**
 * @param fallback - used for requests this transport does not carry.
 * @param connectOptions - TLS options for each session; tests pass their own CA.
 */
export function http2Fetch(fallback, connectOptions = {}) {
    /** Open or opening sessions; a closed one is dropped and the next request reconnects. */
    const sessions = new Map();
    /** Origins whose session failed to open, until when they stay on `fallback`. */
    const refused = new Map();
    const sessionFor = (origin) => {
        const known = sessions.get(origin);
        if (known !== undefined)
            return known;
        const opening = new Promise((resolve, reject) => {
            const session = connect(origin, connectOptions);
            let connected = false;
            const drop = () => { if (sessions.get(origin) === opening)
                sessions.delete(origin); };
            session.once('connect', () => {
                connected = true;
                // Idle sessions must not keep the host process alive.
                session.unref();
                resolve(session);
            });
            // Kept for the session's whole life: an unhandled 'error' would crash the host.
            session.on('error', (error) => {
                drop();
                if (!connected)
                    reject(new ConnectError(error));
            });
            session.once('close', drop);
            session.once('goaway', drop);
        });
        sessions.set(origin, opening);
        return opening;
    };
    /** A request gave up before any answer: keep its session only if it still answers a PING. */
    const check = (session) => {
        if (session.destroyed)
            return;
        const timer = setTimeout(() => session.destroy(), PING_TIMEOUT_MS);
        timer.unref();
        try {
            session.ping((error) => { clearTimeout(timer); if (error)
                session.destroy(); });
        }
        catch {
            clearTimeout(timer);
            session.destroy();
        }
    };
    const request = async (url, init, body) => {
        const signal = init.signal ?? undefined;
        signal?.throwIfAborted();
        const session = await sessionFor(url.origin);
        const headers = {
            ':method': init.method ?? 'GET',
            ':path': `${url.pathname}${url.search}`,
        };
        new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
        const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
        if (payload !== undefined)
            headers['content-length'] = payload.length;
        const stream = session.request(headers, { endStream: payload === undefined });
        if (payload !== undefined)
            stream.end(payload);
        return new Promise((resolve, reject) => {
            let answered = false;
            const onAbort = () => {
                stream.close(constants.NGHTTP2_CANCEL);
                if (!answered)
                    check(session);
                reject(signal?.reason);
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            stream.once('close', () => signal?.removeEventListener('abort', onAbort));
            stream.on('error', (error) => { if (!answered)
                reject(error); });
            stream.once('response', (incoming) => {
                answered = true;
                const status = Number(incoming[':status']);
                const responseHeaders = new Headers();
                for (const [name, value] of Object.entries(incoming)) {
                    if (name.startsWith(':') || value === undefined)
                        continue;
                    for (const item of Array.isArray(value) ? value : [value])
                        responseHeaders.append(name, String(item));
                }
                const noBody = status === 204 || status === 304 || init.method === 'HEAD';
                if (noBody)
                    stream.resume();
                resolve(new Response(noBody ? null : Readable.toWeb(stream), { status, headers: responseHeaders }));
            });
        });
    };
    return (async (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const body = init.body;
        if (input instanceof Request || url.protocol !== 'https:' || (refused.get(url.origin) ?? 0) > Date.now()
            || (body !== undefined && body !== null && typeof body !== 'string')) {
            return fallback(input, init);
        }
        try {
            return await request(url, init, body ?? undefined);
        }
        catch (error) {
            if (!(error instanceof ConnectError) || init.signal?.aborted)
                throw error;
            // Retry over HTTP/1.1 now, and keep using it for a while.
            refused.set(url.origin, Date.now() + REFUSED_MS);
            return fallback(input, init);
        }
    });
}
