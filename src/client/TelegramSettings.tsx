/**
 * The Telegram bot settings form on the dsh-telegram page of the Plugins page:
 * the write-only bot token and the allowed user ids.
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { TelegramSettingsFace } from './settings-controller.ts'

/** Props the renderer binds for the settings form. */
export type TelegramSettingsProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'dshTelegram'>
  & InjectFace<TelegramSettingsFace>

/**
 * Render the bot settings form.
 * @param props - locale copy, the form snapshot, and its actions.
 * @returns the form.
 */
export function TelegramSettings(props: TelegramSettingsProps) {
  const { t } = props
  const state = props.useTelegramSettings(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsSecretField
        id="plugin-config-telegram-token"
        label={t('token')}
        hint={state.tokenInvalid ? t('tokenInvalid') : t('tokenHint')}
        disabled={disabled}
        text={state.token.text}
        configured={state.tokenConfigured}
        stateLabel={state.tokenConfigured ? t('tokenSet') : t('tokenUnset')}
        onEdit={(text) => { props.edit('token', text) }}
      />
      <SettingsValueField
        id="plugin-config-telegram-user-ids"
        label={t('userIds')}
        hint={t('userIdsHint')}
        placeholder="123456789"
        numeric
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('userIdsInvalid')}
        disabled={disabled}
        {...state.userIds}
        onEdit={(text) => { props.edit('allowedUserIds', text) }}
        onReset={() => { props.resetField('allowedUserIds') }}
      />
    </SettingsForm>
  )
}
