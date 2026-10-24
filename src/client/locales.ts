/** Locale bundles for the Telegram bot settings form. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the form renders. */
export type TelegramSettingsLocaleKey =
  | 'token' | 'tokenHint' | 'tokenInvalid' | 'tokenSet' | 'tokenUnset'
  | 'userIds' | 'userIdsHint' | 'userIdsInvalid'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'

/** English copy. */
export const en: Record<TelegramSettingsLocaleKey, string> = {
  token: 'Bot token',
  tokenHint: 'Message @BotFather in Telegram and send /newbot. Stored on this machine and never shown again; leave blank to keep the current token.',
  tokenInvalid: 'This does not look like a bot token (123456789:AAH…); copy the whole token BotFather gave you.',
  tokenSet: 'Configured',
  tokenUnset: 'Not configured',
  userIds: 'Allowed user ids',
  userIdsHint: 'Your numeric Telegram user id (ask @userinfobot); separate several with commas. Empty means the bot answers nobody.',
  userIdsInvalid: 'Enter positive integer ids separated by commas.',
  overridden: 'Set',
  reset: 'Clear',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'The plugin is not loaded, so it cannot be configured right now. Make sure dsh-telegram is enabled, or restart DSH.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'DSH did not accept these settings; they were left for you to correct.',
}

/** Chinese copy. */
export const zh: Record<TelegramSettingsLocaleKey, string> = {
  token: 'Bot Token',
  tokenHint: '在 Telegram 中私聊 @BotFather 发送 /newbot 获取。只保存在本机，不会回显；留空则保留当前 Token。',
  tokenInvalid: '格式不对：应类似 123456789:AAH…，请完整复制 BotFather 给出的 Token。',
  tokenSet: '已配置',
  tokenUnset: '未配置',
  userIds: '允许的用户 ID',
  userIdsHint: '你的 Telegram 数字用户 ID，可私聊 @userinfobot 查看；多个用逗号分隔。为空时机器人不回复任何人。',
  userIdsInvalid: '只能填写正整数 ID，多个用逗号分隔。',
  overridden: '已设置',
  reset: '清空',
  readOnly: '当前部署的配置文件是只读的。',
  unavailable: '插件尚未加载，暂时无法配置。请确认 dsh-telegram 已启用，或重启 DSH 后再试。',
  save: '保存',
  saving: '保存中…',
  saveFailed: 'DSH 没有接受这些设置，已保留供你修改。',
}

/**
 * The form frame's copy, read from this form's dictionary.
 * @param t - the form's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: TelegramSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
