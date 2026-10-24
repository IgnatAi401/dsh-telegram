import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { TelegramSettingsController, looksLikeToken, parseUserIds } from '../src/client/settings-controller.ts'

type Snapshot = { status: 'loading' | 'ready' | 'unavailable'; value: { allowedUserIds?: number[] } | undefined; base: unknown; user: unknown; writable: boolean; revision: number | undefined }

/** A stand-in for the shared config form of the `telegram` entry that accepts every write. */
function fakeScope(initial: Partial<Snapshot> = {}) {
  let snapshot: Snapshot = { status: 'ready', value: { allowedUserIds: [] }, base: { allowedUserIds: [] }, user: {}, writable: true, revision: 1, ...initial }
  const listeners = new Set<() => void>()
  const writes: unknown[][] = []
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async mutate(ops: readonly { op: string; path: readonly string[]; value?: unknown }[]) {
      writes.push([...ops])
      const value = { ...snapshot.value }
      for (const op of ops) {
        if (op.path[0] !== 'allowedUserIds') continue
        value.allowedUserIds = op.op === 'set' ? op.value as number[] : []
      }
      snapshot = { ...snapshot, value, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Telegram settings controller', () => {
  it('parses allowlists and recognizes token shapes', () => {
    expect(parseUserIds('123, 456，789\n123')).toEqual([123, 456, 789])
    expect(parseUserIds('')).toEqual([])
    expect(parseUserIds('12a')).toBeUndefined()
    expect(parseUserIds('0')).toBeUndefined()
    expect(looksLikeToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true)
    expect(looksLikeToken('not-a-token')).toBe(false)
  })

  it('shows the stored allowlist and the token marker', async () => {
    const scope = fakeScope({ value: { allowedUserIds: [11, 22] }, user: { allowedUserIds: [11, 22] } })
    const controller = new TelegramSettingsController(scope, async () => true)
    await settle()
    const state = controller.inject().hooks.telegramSettings.getSnapshot()
    expect(state).toMatchObject({ available: true, dirty: false, tokenConfigured: true, tokenInvalid: false })
    expect(state.userIds).toEqual({ text: '11, 22', overridden: true, invalid: false })
    expect(state.token.text).toBe('')
    controller.dispose()
  })

  it('blocks a malformed token or allowlist and saves valid edits', async () => {
    const scope = fakeScope()
    let stored = false
    const controller = new TelegramSettingsController(scope, async () => stored)
    const face = controller.inject()
    const store = face.hooks.telegramSettings
    face.edit('token', 'bad')
    face.edit('allowedUserIds', '42, x')
    expect(store.getSnapshot()).toMatchObject({ invalid: true, tokenInvalid: true, userIds: { invalid: true } })

    face.edit('token', ' 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw ')
    face.edit('allowedUserIds', '42, 4242')
    expect(store.getSnapshot()).toMatchObject({ invalid: false, dirty: true })
    stored = true
    face.save()
    await vi.waitFor(() => { expect(store.getSnapshot()).toMatchObject({ saving: false, dirty: false }) })
    expect(scope.writes).toEqual([
      [{ op: 'set', path: ['allowedUserIds'], value: [42, 4242] }],
      [{ op: 'set', path: ['token'], value: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' }],
    ])
    expect(store.getSnapshot()).toMatchObject({ failed: false, tokenConfigured: true, token: { text: '' }, userIds: { text: '42, 4242' } })
    controller.dispose()
  })

  it('clears the allowlist when it is emptied', async () => {
    const scope = fakeScope({ value: { allowedUserIds: [7] }, user: { allowedUserIds: [7] } })
    const controller = new TelegramSettingsController(scope, async () => false)
    const face = controller.inject()
    face.edit('allowedUserIds', '')
    face.save()
    await vi.waitFor(() => { expect(scope.writes).toEqual([[{ op: 'unset', path: ['allowedUserIds'] }]]) })
    controller.dispose()
  })
})

/**
 * Evaluate the built lib/browser/client.js the way DSH's module loader does: the
 * script hands a factory to `window.__ModuleLoader__.load`, which receives the
 * shell's shared module table as `require`.
 */
describe('built browser bundle', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/browser/client.js', import.meta.url)), 'utf8')

  function load(): { id: string; exports: Record<string, unknown> } {
    let registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> } | undefined
    runInNewContext(source, { window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value } } } })
    const shared: Record<string, unknown> = { 'react/jsx-runtime': {}, '@deepseek-ai/dsh-client-ui-primitives': primitives }
    const exports = registration!.factory((id) => {
      if (!(id in shared)) throw new Error(`the bundle requested ${id}, which the shell does not share`)
      return shared[id]
    })
    return { id: registration!.id, exports }
  }

  it('stays apart from the host build, whose lib/client.js is the Telegram API client', () => {
    expect(readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')).not.toContain('__ModuleLoader__')
  })

  it('registers under the package name and exports only what Cordis loads', () => {
    const { id, exports } = load()
    expect(id).toBe('dsh-telegram')
    expect(Object.keys(exports).sort()).toEqual(['apply', 'inject'])
    expect(exports.inject).toEqual(['slots', 'locale', 'remote', 'remote.settings', 'configForms'])
  })

  it('registers the dictionaries and, while the entry is served, the form on the bundle page', () => {
    const { exports } = load()
    const dictionaries: Record<string, Record<string, Record<string, string>>> = {}
    const served: string[][] = []
    const registrations: Record<string, unknown>[] = []
    const ctx = {
      effect: (body: () => unknown) => { body() },
      locale: { register: (ns: string, value: Record<string, Record<string, string>>) => { dictionaries[ns] = value } },
      configForms: {
        get: () => ({ getSnapshot: () => ({ status: 'loading', value: undefined, writable: false }), subscribe: () => () => {}, mutate: async () => true }),
        whileServed: (namespaces: string[], body: () => unknown) => { served.push(namespaces); body() },
      },
      slots: {
        inject: (_name: string, body: () => unknown) => body(),
        register: (options: Record<string, unknown>) => { registrations.push(options) },
      },
      remote: { settings: { describe: async () => ({ ok: true, value: { namespaces: [] } }) } },
    }
    ;(exports.apply as (ctx: unknown) => void)(ctx)
    expect(Object.keys(dictionaries.dshTelegram!.zh!).sort()).toEqual(Object.keys(dictionaries.dshTelegram!.en!).sort())
    expect(served).toEqual([['telegram']])
    expect(registrations).toEqual([expect.objectContaining({ name: 'plugins.bundle.config', key: 'dsh-telegram', locale: 'dshTelegram' })])
  })
})
