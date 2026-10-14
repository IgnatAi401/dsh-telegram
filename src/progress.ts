import { randomInt } from 'node:crypto'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TelegramApiError } from './client.js'
import type { TelegramClientLike } from './client.js'
import { escapeHtml } from './format.js'
import { richBody, TelegramTranscript } from './transcript.js'

const LONG_PREVIEW = '回复较长，完整内容将在生成完成后显示。'

function previewText(text: string, overflow: boolean): string {
  return overflow ? LONG_PREVIEW
    : /<\/?(?:details|summary)\b/i.test(text) ? '折叠内容将在生成完成后显示。'
    : text
}

/**
 * One turn's Telegram output while it runs. Intermediate assistant messages are
 * sent as temporary real messages, removed once the final message (folded
 * process record plus answer) is delivered; a disposable draft previews only
 * the text being generated. Events mutate bounded state synchronously; a
 * coalescer sends only the latest draft through the bridge's delivery queue.
 * No tool arguments or results are shown.
 */
export class TelegramProgress {
  private draftId = randomInt(1, 2 ** 31)
  private readonly started = Date.now()
  private readonly abort = new AbortController()
  private readonly signal: AbortSignal
  private readonly timer: NodeJS.Timeout
  private attempt: AssistantStreamFrame['attemptId'] | undefined
  private revision = -1
  private text = ''
  /** The latest message without tool calls, previewed until the turn goes on. */
  private answer = ''
  private previewOverflow = false
  private phase = '正在思考'
  private readonly activeTools = new Set<string>()
  private readonly transcript = new TelegramTranscript()
  private paused = false
  private waitingForUser = false
  private disposed = false
  private stoppedByUser = false
  private scheduled = false
  private epoch = 0
  private dirty = true
  private nextSend = 0
  private lastSent = 0

  constructor(
    private readonly client: TelegramClientLike,
    private readonly chatId: number,
    /** Aborted when the bridge stops; real messages outlive the turn's draft. */
    private readonly stopSignal: AbortSignal,
    private readonly enqueue: (task: () => Promise<void>) => Promise<void>,
    private readonly warn: (error: unknown) => void,
    /** Record a temporary message for removal after final delivery. */
    private readonly track: (messageId: number) => void,
  ) {
    this.signal = AbortSignal.any([stopSignal, this.abort.signal])
    this.timer = setInterval(() => this.schedule(), 1200)
    this.schedule()
  }

  /** Reject old attempts and revisions, including late chunks after a retry. */
  stream(frame: AssistantStreamFrame): void {
    if (this.disposed || frame.revision <= this.revision) return
    this.revision = frame.revision
    if (frame.type === 'start') {
      this.attempt = frame.attemptId
      this.text = ''
      this.previewOverflow = false
      this.phase = '正在思考'
      this.changed()
    } else if (frame.attemptId === this.attempt && frame.type === 'chunk') {
      if (frame.chunk.type === 'text-delta') {
        // Never truncate rich syntax: a missing closing tag/fence can leave an
        // unusable disclosure. Stop previewing this attempt once it is too long.
        if (!this.previewOverflow) {
          if (this.text.length + frame.chunk.text.length > 16000) {
            this.previewOverflow = true
            this.text = ''
          } else this.text += frame.chunk.text
        }
        this.phase = '正在生成回复'
      } else if (frame.chunk.type === 'reasoning-delta') {
        this.phase = '正在思考'
      } else if (frame.chunk.type === 'tool-call-delta') {
        this.phase = '正在准备工具调用'
      } else return
      this.changed()
    } else if (frame.attemptId === this.attempt && frame.type === 'end'
      && (frame.outcome.kind === 'abandoned' || frame.outcome.eventType === 'assistant/attempt')) {
      this.text = ''
      this.previewOverflow = false
      this.phase = '正在等待重试'
      this.changed()
    }
  }

  event(event: SessionEvent): void {
    if (this.disposed) return
    this.transcript.event(event)
    if (event.type === 'assistant/message') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return
      const content = event.data.message.content
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('')
      this.flushAnswer()
      // A message that calls tools is always followed by another step. One
      // without tools is the turn's answer unless the turn continues.
      if (content.some(block => block.type === 'tool-call')) this.publish(text)
      else this.answer = text
      this.text = ''
      this.previewOverflow = false
      this.attempt = undefined
      this.changed()
    } else if (event.type === 'tool/call') {
      this.activeTools.add(event.data.callId)
      this.phase = '正在执行工具'
      this.changed()
    } else if (event.type === 'tool/result') {
      this.activeTools.delete(event.data.message.toolCallId)
      this.phase = this.activeTools.size ? '正在执行工具' : '正在整理工具结果'
      this.changed()
    } else if (event.type === 'step/start') {
      this.flushAnswer()
      this.text = ''
      this.previewOverflow = false
      this.phase = `正在思考 · 第 ${event.data.step} 步`
      this.changed()
    }
  }

  /** The held answer turned out to be intermediate: the turn went on. */
  private flushAnswer(): void {
    this.publish(this.answer)
    this.answer = ''
  }

  /**
   * Send an intermediate message as a temporary real message. Any bot message
   * clears Telegram's draft, and streaming the same draft_id again replays it
   * from empty, so later previews continue in a fresh draft.
   */
  private publish(text: string): void {
    if (!text.trim()) return
    this.newDraft()
    void this.enqueue(async () => {
      try {
        this.track((await this.client.sendRichMessage(this.chatId, richBody(text), this.stopSignal)).message_id)
      } catch (error) {
        if (!this.stopSignal.aborted) this.warn(error)
      }
    })
  }

  private newDraft(): void {
    this.epoch++
    this.draftId = randomInt(1, 2 ** 31)
  }

  private changed(): void {
    this.paused = this.waitingForUser
    this.dirty = true
    this.schedule()
  }

  /** Invalidate queued previews before a persisted assistant message or user question. */
  pause(): void {
    this.paused = true
    this.epoch++
  }

  /** The question message clears the draft; continue in a fresh one afterwards. */
  suspend(): void {
    this.waitingForUser = true
    this.pause()
    this.newDraft()
  }

  resume(): void {
    this.waitingForUser = false
    if (!this.disposed) this.changed()
  }

  dispose(): void {
    this.disposed = true
    this.pause()
    clearInterval(this.timer)
    this.abort.abort()
  }

  stopByUser(): void {
    this.stoppedByUser = true
    this.dispose()
  }

  /** A terminal message clears a tool-only/failed draft even without an assistant answer. */
  terminalNotice(reason: string): string | undefined {
    if (this.stoppedByUser) return undefined
    if (reason === 'completed') return this.transcript.answer.trim() ? undefined : '✅ **任务已完成**'
    if (reason === 'aborted' || reason === 'interrupted') return '⏹ **任务已中断**'
    if (reason === 'error') return '⚠️ **任务执行失败**，请检查 dsh 日志。'
    if (reason === 'blocked') return '⚠️ **任务暂时无法继续**'
    if (reason === 'max-tokens') return '⚠️ **输出已达到长度限制**'
    return 'ℹ️ **任务已结束**'
  }

  /**
   * The complete turn as one rich message: folded intermediate messages, then
   * the answer (or `notice` when the turn produced none). Includes late tool
   * results and reasoning-only turns; `undefined` when nothing was recorded.
   */
  finalMessage(notice?: string): string | undefined {
    if (this.stoppedByUser || !this.transcript.hasEntries) return undefined
    const answer = notice ?? this.transcript.answer
    const markdown = [this.transcript.render(answer), answer].filter(part => part.trim()).join('\n\n')
    return markdown || undefined
  }

  private status(): string {
    return `${this.phase} · ${Math.floor((Date.now() - this.started) / 1000)} 秒`
  }

  private schedule(): void {
    if (this.disposed || this.paused || this.scheduled || Date.now() < this.nextSend
      || (!this.dirty && Date.now() - this.lastSent < 12000)) return
    this.scheduled = true
    const epoch = this.epoch
    void this.enqueue(async () => {
      try {
        if (this.disposed || this.paused || epoch !== this.epoch || this.signal.aborted) return
        this.dirty = false
        await this.send()
        this.lastSent = Date.now()
        this.nextSend = Date.now() + 1200
      } catch (error) {
        if (this.signal.aborted) return
        this.dirty = true
        if (error instanceof TelegramApiError && error.code === 429) {
          const delay = Number.isFinite(error.retryAfter) ? Math.max(1, error.retryAfter!) : 5
          this.nextSend = Date.now() + delay * 1000
        } else if (/not modified/i.test(String(error))) {
          this.nextSend = Date.now() + 1200
        } else {
          this.nextSend = Date.now() + 5000
          this.warn(error)
        }
      } finally {
        this.scheduled = false
        // Superseded by a real message or a new draft: follow up right away.
        if (epoch !== this.epoch) this.schedule()
      }
    })
  }

  private preview(): string {
    // Partial disclosures may have only a summary (or an unfinished body).
    // Leave them to committed delivery, where the complete source is available.
    const current = this.text || this.previewOverflow ? previewText(this.text, this.previewOverflow)
      : previewText(this.answer, this.answer.length > 16000)
    return current.trim() ? richBody(current) : ''
  }

  private async send(): Promise<void> {
    // One stable draft between real messages: replacing its ID makes Telegram
    // remove and recreate the preview on every update.
    await this.client.sendRichMessageDraft(this.chatId, this.draftId,
      `<tg-thinking>${escapeHtml(this.status())}</tg-thinking>\n\n${this.preview()}`, this.signal)
  }
}
