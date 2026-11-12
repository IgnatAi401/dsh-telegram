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
import type { SecureClientSessionOptions } from 'node:http2';
/**
 * @param fallback - used for requests this transport does not carry.
 * @param connectOptions - TLS options for each session; tests pass their own CA.
 */
export declare function http2Fetch(fallback: typeof fetch, connectOptions?: SecureClientSessionOptions): typeof fetch;
