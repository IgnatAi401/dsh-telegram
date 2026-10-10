import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
/** One replaceable complete output per bot/chat; retained for display recovery. */
export class TelegramResultCache {
    queues = new Map();
    directory;
    constructor(token, directory) {
        // Match DSH's own home resolution: blank means unset; `~`, `~/` and `~\` expand.
        const configured = process.env.DSH_HOME?.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh');
        const home = configured === '~' ? homedir()
            : configured.startsWith('~/') || configured.startsWith('~\\') ? join(homedir(), configured.slice(2)) : resolve(configured);
        // Bot identity survives token rotation; never put the token in a file name.
        const bot = createHash('sha256').update(token.split(':')[0]).digest('hex');
        this.directory = join(directory ?? join(home, 'telegram-results'), bot);
    }
    async exclusive(chatId, task) {
        const previous = this.queues.get(chatId) ?? Promise.resolve();
        const next = previous.catch(() => { }).then(task);
        this.queues.set(chatId, next);
        try {
            return await next;
        }
        finally {
            if (this.queues.get(chatId) === next)
                this.queues.delete(chatId);
        }
    }
    path(chatId) {
        if (!Number.isSafeInteger(chatId))
            throw new Error('Invalid Telegram chat id');
        return join(this.directory, `${chatId}.json`);
    }
    /** Persist `markdown` before sending it, so a failed or unrendered delivery can be resent. */
    async deliver(chatId, markdown, send) {
        return this.exclusive(chatId, async () => {
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            const path = this.path(chatId);
            const temporary = `${path}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, JSON.stringify({ markdown }), { mode: 0o600 });
                await rename(temporary, path);
            }
            finally {
                await rm(temporary, { force: true });
            }
            // API acceptance does not guarantee that a client rendered the message.
            await send(markdown);
        });
    }
    /** Resend the cached output; `false` when this chat has none. */
    async resend(chatId, send) {
        return this.exclusive(chatId, async () => {
            let raw;
            try {
                raw = await readFile(this.path(chatId), 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return false;
                throw error;
            }
            const value = JSON.parse(raw);
            if (typeof value !== 'object' || value === null || !('markdown' in value) || typeof value.markdown !== 'string') {
                throw new Error('Invalid Telegram result cache');
            }
            await send(value.markdown);
            return true;
        });
    }
}
