/**
 * Browser half of dsh-telegram: the bot settings form on the package's page
 * of the DSH Plugins page. It edits the `telegram` entry's volatile token and
 * allowlist; the Host writes them to the profile patch and the bridge restarts
 * with them. The form is registered only while the Host serves that entry.
 */

// Type-only: the ctx.locale merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.bundle.config' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the ctx.remote merge, including its settings namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.slots merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { TelegramSettings } from './TelegramSettings.tsx'
import { TELEGRAM_ENTRY, TelegramSettingsController, type TelegramSettings as TelegramSettingsSection } from './settings-controller.ts'
import { en, zh, type TelegramSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Telegram bot settings copy. */
    dshTelegram: TelegramSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'dshTelegram'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'configForms']

/**
 * Register the dictionaries and, while the Host serves the `telegram` entry,
 * the settings form on the bundle's page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-telegram: dictionaries')
  const settings = new TelegramSettingsController(
    ctx.configForms.get<TelegramSettingsSection>(TELEGRAM_ENTRY),
    async () => {
      const response = await ctx.remote.settings.describe()
      if (!response.ok) return false
      const entry = response.value.namespaces.find(view => view.ns === TELEGRAM_ENTRY)
      return entry?.secrets.some(secret => secret.path[0] === 'token' && secret.set) ?? false
    },
  )
  ctx.effect(() => () => { settings.dispose() }, 'dsh-telegram: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([TELEGRAM_ENTRY], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-telegram',
    locale: NS,
    inject: () => settings.inject(),
  }, TelegramSettings))), 'dsh-telegram: settings form')
}
