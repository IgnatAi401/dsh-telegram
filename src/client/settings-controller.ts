/**
 * The staged form over the `telegram` entry's bot settings.
 *
 * The allowlist is an ordinary section field. The token is a `role('secret')`
 * field: its value never rides a response, so it is staged as a write-only
 * control that starts blank, and whether one is stored comes from the Host's
 * redacted secret markers instead of the section.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Settings namespace: the row id the bundle patch declares. */
export const TELEGRAM_ENTRY = 'telegram'

/** The section fields this form edits; the token is redacted from reads. */
export interface TelegramSettings {
  allowedUserIds?: number[]
}

/** What the settings form renders. */
export interface TelegramSettingsState extends SettingsFormShell {
  /** The staged token, blank on every load. */
  token: SettingsFieldState
  /** Whether the staged token has the shape BotFather issues; a blank draft is valid. */
  tokenInvalid: boolean
  /** Whether the Host reports a stored token. */
  tokenConfigured: boolean
  /** The allowlist draft. */
  userIds: SettingsFieldState
}

/** The registration-side face the form's slot entry injects. */
export interface TelegramSettingsFace extends SettingsFormActions {
  hooks: {
    /** Form snapshot bound by the renderer as useTelegramSettings. */
    telegramSettings: SnapshotStore<TelegramSettingsState>
  }
}

/**
 * Parse allowlist text.
 * @param text - ids separated by commas, spaces or newlines.
 * @returns unique ids, or undefined when any part is not a positive safe integer.
 */
export function parseUserIds(text: string): number[] | undefined {
  const parts = text.split(/[\s,，]+/).filter(Boolean)
  if (parts.some(part => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))) return undefined
  return [...new Set(parts.map(Number))]
}

/**
 * @param token - a trimmed draft.
 * @returns whether it has the `<bot id>:<secret>` shape BotFather issues.
 */
export function looksLikeToken(token: string): boolean {
  return /^\d+:[\w-]{20,}$/.test(token)
}

/** The allowlist as one comma-separated control; emptying it clears the field. */
const userIdsField: SettingsFieldSpec = {
  field: 'allowedUserIds',
  format: value => Array.isArray(value) ? value.join(', ') : '',
  parse: (text) => {
    if (!text.trim()) return { kind: 'clear' }
    const ids = parseUserIds(text)
    return ids === undefined ? undefined : { kind: 'set', value: ids }
  },
}

/** Bridges the `telegram` entry's form and its secret marker onto the settings form. */
export class TelegramSettingsController {
  private readonly form: SettingsFormModel<TelegramSettings>
  private readonly store: SnapshotStore<TelegramSettingsState>
  private readonly unsubscribe: () => void
  private tokenConfigured = false
  private reads = 0

  /**
   * @param scope - the shared configuration form of the `telegram` entry.
   * @param readTokenConfigured - asks the Host whether the token slot holds a value.
   */
  constructor(
    private readonly scope: SettingsFormScope<TelegramSettings>,
    private readonly readTokenConfigured: () => Promise<boolean>,
  ) {
    this.form = new SettingsFormModel(scope, [userIdsField], [{ field: 'token', write: text => this.writeToken(text) }])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.refreshToken() })
    void this.refreshToken()
  }

  private projection(): TelegramSettingsState {
    const shell = this.form.shell()
    const token = this.form.field('token')
    const tokenInvalid = token.text.trim() !== '' && !looksLikeToken(token.text.trim())
    return {
      ...shell,
      invalid: shell.invalid || tokenInvalid,
      token,
      tokenInvalid,
      tokenConfigured: this.tokenConfigured,
      userIds: this.form.field('allowedUserIds'),
    }
  }

  /** Re-read the secret marker; a stale answer from an earlier read is dropped. */
  private async refreshToken(): Promise<boolean> {
    const read = ++this.reads
    const configured = await this.readTokenConfigured()
    if (read === this.reads && configured !== this.tokenConfigured) {
      this.tokenConfigured = configured
      this.store.set(this.projection())
    }
    return configured
  }

  /**
   * Write the staged token into the section, then re-read whether one is stored.
   * @param text - the staged token.
   * @returns whether the Host accepted it.
   */
  private async writeToken(text: string): Promise<boolean> {
    const token = text.trim()
    if (!looksLikeToken(token)) return false
    if (!await this.scope.mutate([{ op: 'set', path: ['token'], value: token }])) return false
    return this.refreshToken()
  }

  /**
   * Build the face the form's slot registration injects.
   * @returns the form's snapshot and its actions.
   */
  inject(): TelegramSettingsFace {
    return { hooks: { telegramSettings: this.store }, ...this.form.actions() }
  }

  /** Release configuration subscriptions. */
  dispose(): void { this.unsubscribe(); this.form.dispose() }
}
