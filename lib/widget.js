/**
 * The `telegram_widget` tool: lets the Agent send its own Bot API 10.4 widget
 * (`sendWidget`) into the bound private chat and later replace that widget's
 * chat state (`editMessageWidgetData`). It is registered only in the scope of
 * Agents whose session is bound to a Telegram chat, so other sessions never
 * see it.
 *
 * Agent widgets are self-contained: they are sent without `allow_queries`, so
 * `TelegramWidget.request` is refused by Telegram and taps never reach the
 * bridge; answers from the user still go through `ask_user_question`.
 * @module telegram/widget
 */
import { deflateSync } from 'node:zlib';
export const WIDGET_TOOL_NAME = 'telegram_widget';
/** Bot API 10.4 limits for one widget. */
export const MAX_WIDGET_HTML_BYTES = 32768;
export const MAX_WIDGET_COMPRESSED_BYTES = 4096;
export const MAX_WIDGET_DATA_BYTES = 1024;
export const MAX_WIDGET_CAPTION_LENGTH = 1024;
/** Telegram clamps the bubble to 50–600 px tall and at least 200 px wide. */
const MIN_WIDGET_WIDTH = 200;
const MIN_WIDGET_HEIGHT = 50;
const MAX_WIDGET_HEIGHT = 600;
const encoder = new TextEncoder();
function byteLength(text) {
    return encoder.encode(text).length;
}
/** Thrown for arguments the model can fix; the message is shown to it as the tool error. */
export class WidgetArgsError extends Error {
}
function optionalInteger(value, name, min, max) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
        throw new WidgetArgsError(`${name} 必须是 ${min}${max === undefined ? ' 以上' : `–${max}`} 的整数（逻辑像素）`);
    }
    return value;
}
function checkData(data) {
    if (data === undefined || data === null)
        return undefined;
    if (typeof data !== 'string')
        throw new WidgetArgsError('data 必须是字符串（通常是 JSON 文本）');
    const bytes = byteLength(data);
    if (bytes > MAX_WIDGET_DATA_BYTES) {
        throw new WidgetArgsError(`data 为 ${bytes} 字节，超过 ${MAX_WIDGET_DATA_BYTES} 字节上限；缩短键名或减少内容`);
    }
    return data;
}
/**
 * Validate one call against the Bot API 10.4 limits before anything is sent,
 * so the model gets an actionable error instead of a Telegram refusal.
 * @throws {WidgetArgsError} for arguments outside the limits.
 */
export function parseWidgetArgs(args) {
    const input = (typeof args === 'object' && args !== null ? args : {});
    const action = input.action ?? 'send';
    if (action === 'update') {
        const messageId = input.message_id;
        if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) {
            throw new WidgetArgsError('update 需要 message_id：之前 send 返回的消息编号');
        }
        const data = checkData(input.data);
        if (data === undefined)
            throw new WidgetArgsError('update 需要 data：新的完整状态（空字符串表示清除）');
        return { action, messageId, data };
    }
    if (action !== 'send')
        throw new WidgetArgsError('action 只能是 send 或 update');
    const html = input.html;
    if (typeof html !== 'string' || html.trim() === '')
        throw new WidgetArgsError('send 需要 html：完整的小组件 HTML');
    if (html.includes('\u0000'))
        throw new WidgetArgsError('html 不能包含 NUL 字符');
    const htmlBytes = byteLength(html);
    if (htmlBytes > MAX_WIDGET_HTML_BYTES) {
        throw new WidgetArgsError(`html 为 ${htmlBytes} 字节，超过 ${MAX_WIDGET_HTML_BYTES} 字节上限`);
    }
    const compressed = deflateSync(Buffer.from(html, 'utf8'), { level: 9 }).length;
    if (compressed > MAX_WIDGET_COMPRESSED_BYTES) {
        throw new WidgetArgsError(`html 压缩后为 ${compressed} 字节，超过 ${MAX_WIDGET_COMPRESSED_BYTES} 字节上限；`
            + '精简样式和脚本，重复的数据放进 data 由脚本绘制');
    }
    const caption = typeof input.caption === 'string' ? input.caption.trim() : '';
    if (caption === '')
        throw new WidgetArgsError('send 需要 caption：一句纯文本说明，也是不支持小组件的客户端看到的内容');
    if ([...caption].length > MAX_WIDGET_CAPTION_LENGTH) {
        throw new WidgetArgsError(`caption 超过 ${MAX_WIDGET_CAPTION_LENGTH} 个字符`);
    }
    const data = checkData(input.data);
    const width = optionalInteger(input.width, 'width', MIN_WIDGET_WIDTH);
    const height = optionalInteger(input.height, 'height', MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT);
    return {
        action,
        html,
        caption,
        ...(data === undefined || data === '' ? {} : { data }),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
    };
}
const DESCRIPTION = [
    '在当前 Telegram 私聊里发送一个 HTML 小组件（Telegram Bot API 10.4 widget），或更新之前发送的小组件的数据。',
    '小组件是聊天里的一块可交互画布，由你写的 HTML/CSS/JS 绘制：适合计时器、计算器、进度看板、图表、可切换的卡片、小游戏等需要动态显示或本地交互的内容。普通说明仍写在回复正文里。',
    'action="send"：html 必填，caption 必填（一句纯文本），可选 data（初始状态）、width、height；返回 message_id。小组件立即作为单独消息出现在最终回复之前，并一直保留。',
    'action="update"：message_id 和 data 必填，用新的 data 整体替换该小组件的状态，小组件脚本收到 chatDataChanged 事件后重绘；HTML 发送后不能修改。只能更新本会话用此工具发送的小组件。',
].join('\n');
const PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
        action: { type: 'string', enum: ['send', 'update'], description: 'send 发送新小组件（默认）；update 替换已发送小组件的 data。' },
        html: {
            type: 'string',
            description: `send 时必填：完整、自包含的 HTML 文档（内联 <style> 与 <script>），最多 ${MAX_WIDGET_HTML_BYTES} 字节，zlib 压缩后最多 ${MAX_WIDGET_COMPRESSED_BYTES} 字节。`,
        },
        caption: {
            type: 'string',
            description: `send 时必填：显示在小组件下方的一句纯文本说明（最多 ${MAX_WIDGET_CAPTION_LENGTH} 字符），也是不支持小组件的客户端、通知和聊天列表看到的内容。`,
        },
        data: {
            type: 'string',
            description: `小组件状态文本（通常是 JSON），最多 ${MAX_WIDGET_DATA_BYTES} 字节，脚本通过 TelegramWidget.chatData 读取。update 时必填；空字符串清除状态。`,
        },
        message_id: { type: 'integer', description: 'update 时必填：send 返回的 message_id。' },
        width: { type: 'integer', description: `可选，逻辑像素，至少 ${MIN_WIDGET_WIDTH}；省略则占满气泡宽度。` },
        height: { type: 'integer', description: `可选，逻辑像素，${MIN_WIDGET_HEIGHT}–${MAX_WIDGET_HEIGHT}；省略则按内容高度自适应。` },
    },
};
const OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        action: { type: 'string', enum: ['send', 'update'] },
        messageId: { type: 'integer' },
    },
    required: ['action', 'messageId'],
};
/**
 * Build the tool definition; `handlers` do the Telegram side effects for the
 * calling Agent and throw when its session is no longer bound to a chat.
 */
export function widgetToolDefinition(handlers) {
    return {
        name: WIDGET_TOOL_NAME,
        description: DESCRIPTION,
        parameters: PARAMETERS,
        timeoutMs: 30000,
        output: {
            schema: OUTPUT_SCHEMA,
            render: (_args, value) => {
                const { action, messageId } = value;
                return [{
                        type: 'text',
                        text: action === 'send'
                            ? `小组件已发送，message_id=${messageId}。需要改变显示内容时用 action="update" 和这个 message_id 传入新的 data。`
                            : `小组件 ${messageId} 的数据已更新。`,
                    }];
            },
        },
        async execute(args, exec) {
            const request = parseWidgetArgs(args);
            if (request.action === 'send') {
                const messageId = await handlers.send(exec.agent, request, exec.signal);
                return { action: 'send', messageId };
            }
            await handlers.update(exec.agent, request, exec.signal);
            return { action: 'update', messageId: request.messageId };
        },
    };
}
/** Channel-prompt guidance; kept next to the tool so its rules match the limits above. */
export const WIDGET_PROMPT_LINES = [
    `- 小组件（${WIDGET_TOOL_NAME} 工具，Telegram Bot API 10.4）：需要动态显示或本地交互、静态富消息做不到时使用，例如倒计时/计时器、单位换算或贷款计算器、长任务进度看板、可切换的图表和卡片、记分板、小游戏。普通答案、表格、列表仍用回复正文，不为装饰而发小组件。发送后它是一条独立消息，出现在最终回复之前；最终回复里用一句话提到它即可，不要重复其中的内容。`,
    '- 小组件运行在受限沙箱（QuickJS，不是浏览器）：没有网络（fetch、XHR、WebSocket 会抛错，外部脚本、样式、字体、图片都不加载），没有 input/select/textarea 等表单控件和键盘输入，内部不能滚动，不支持 vh 单位、@font-face、:has()、CSS 嵌套、3D 变换和 clip-path；图片只能用 data: 的 PNG/JPEG/GIF/WebP，图形用内联 SVG 或 canvas（总面积不超过 2048×2048）。最多 2000 个节点、400 条 CSS 规则、32 个 @keyframes；同时最多 16 个带模糊、滤镜或不透明度小于 1 的元素，超过会被停止，动画用 transform 和颜色变化代替透明度。',
    '- 小组件高度 50–600 px，宽度随聊天气泡。只能点击（tap/双击），竖向拖动总是滚动聊天，长按和横向拖动要用 CSS touch-action 认领。用 CSS 变量适配主题：--tg-theme-bg-color、--tg-theme-text-color、--tg-theme-hint-color、--tg-theme-button-color、--tg-theme-button-text-color、--tg-theme-secondary-bg-color 等，背景一般保持透明。',
    '- 脚本 API 是 window.TelegramWidget：chatData（data 文本或 null）、colorScheme、themeParams、onEvent("chatDataChanged" | "themeChanged" | "activated" | "deactivated", 回调)、HapticFeedback.impactOccurred("light") / notificationOccurred("success") / selectionChanged()、copyText(文本)（仅在点击时，最长 256）、openLink("https://…")（用户确认后打开）、setResizeAnchor("top")、ready()。小组件随时可能被销毁重建，启动时从 chatData 重绘；离屏时会暂停。不能调用 TelegramWidget.request：插件发送的小组件不接受请求，点击不会通知你；需要用户做选择时用 ask_user_question。',
    `- html 必须完整自包含，最多 ${MAX_WIDGET_HTML_BYTES} 字节且 zlib 压缩后不超过 ${MAX_WIDGET_COMPRESSED_BYTES} 字节：样式和脚本写紧凑，不要内嵌大图。caption 写一句纯文本说明。会变化的内容（进度、数值、列表）放进 data（JSON，最多 ${MAX_WIDGET_DATA_BYTES} 字节），之后用 action="update" 和返回的 message_id 替换 data，脚本在 chatDataChanged 中重绘；HTML 发送后不能修改。每次 update 都计入 Telegram 发送频率，只在状态确有变化时更新，间隔至少几秒，不要每个工具调用都更新。`,
];
