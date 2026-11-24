# Changelog

## Unreleased

- Harden the topic sync and native Stop after review: the start-up sync no longer empties topics (a first message sent while the bot was offline may still be unread; `/sync` does it); a stale topic keeps its stored binding until Telegram confirms the deletion, so a failed one is retried by the next sync or after a restart, and the outcome counts failures; a sync never unarchives a session archived while it runs and skips sessions bound meanwhile; `/sync` and "同步话题" run in the background, so other topics' messages and Stop taps are not held up, and a failing start-up sync cannot keep the bridge from polling; deleting a topic releases its state even when archiving the session fails, and says so; a Stop on a draft the running turn does not own (a late Stop of an earlier turn) is ignored.
- Topic mode syncs the topics with DSH on every start, and on demand with `/sync` (also "同步话题" on the main chat's panel), which also catches topics whose session was archived or removed while the bridge runs (a running one waits for the next sync) and always reports the outcome: topics of sessions that were archived or removed are deleted (with their bindings), so are empty topics, whose session never had a turn and has nothing on its way in (the session is archived), and every other session with a turn in the last 3 days and no topic gets one named after its title, oldest first (`/sync 7` covers 7 days, any number works, and `/sync all` every session; a wrong argument shows the usage; deletions ignore the span); the main chat gets a one-line summary. Topics are only created when the bot has a single private chat (one allowed user, or the one chat its topics are in). Archiving in a topic ("归档并删除话题" in the menu, or `/archive`) now deletes the topic and archives its session, instead of keeping the topic with a 📦 mark; "取消归档" in topics is gone. A synced topic loads its Agent with its first message.
- Make the "打开话题" button open the topic itself: it now links to the topic's first message (`https://t.me/<bot>/<topic>/<topic>`); the bare topic link only scrolled the main chat's combined view to the topic.
- Fix topic mode answering "访问被拒绝" to the bot's own topic changes and quoting an empty "Telegram 引用消息" to the Agent: topic service messages (created, renamed, closed, reopened) and messages from bots are ignored, and the topic's first message, which Telegram makes every topic message reply to, is no longer passed on as a quote. A refused message is logged with its sender and fields.
- Topic mode keeps parallel tasks apart and covers the rest of a topic's life. Native Stop finds the task by the draft it was tapped on (any draft of the running turn, or of a `/compact`), so it never stops another topic's task. Questions and approvals of a turn started from the Web UI (or another client) are left to DSH instead of appearing in the topic; turns started from Telegram keep asking there. The main chat's panel gains "打开已有会话": a workspace's sessions, paged, open in their own topic (named after the session title, unarchived when needed), or jump to the topic they already have, since a session is bound to at most one topic. In a topic, "归档" archives the session but keeps the topic and its binding with a 📦 mark on its name, "取消归档" takes it back, and "删除话题" (with a confirmation) deletes the topic and archives its session. When Telegram reports a topic gone, its binding is dropped and the main chat offers "为原会话重建话题", which opens a new topic and resends the last result there. When a topic's session no longer exists in DSH, the topic says so and offers a new session in the same workspace and topic; topic bindings now remember their workspace id for this. Drafts of the turns streaming in one chat are spaced by how many are running (0.6 s each), and a 429 on any of them holds all of them.
- Add private-chat topic mode (`privateTopics`, on by default; set it to false for the single-chat layout): each topic of the private chat is one DSH session. On start the bridge turns topics on through `setMySettings` (with the sidebar; only the bot creates topics) and remembers the bot's earlier topic settings next to the bindings; once the option is off again, the next start restores them. In the main chat, `/new`, the panel's "新建会话" and any message open a workspace picker (recently used first): the bridge creates the topic, the session and the binding in that order, undoes the earlier steps when one fails, posts the workspace at the top of the new topic, and answers with an "打开话题" button; a message sent in the main chat becomes the new session's first input and the topic's name, and one message or one picker never starts two sessions. Inside a topic, `/new` and the menu's "在 <工作区> 新建" start a sibling session in the same workspace, "在其他工作区新建" picks another one, and the menu shows the topic's workspace and session without switching them; the running task is left alone. Topics are renamed after the session title once DSH generates it. The main chat binding of single-chat mode is kept for when topic mode is off. Replaces the earlier experiment's raw update log (`debugUpdatesFile`) and the `TELEGRAM_PRIVATE_TOPICS` variable.
- Keep each chat's current session across restarts: the bridge stores which session every chat is bound to in `DSH_HOME/telegram-bindings/<bot>.json` (written atomically) and binds it again on start, so a message after a DSH restart goes straight to that session instead of asking for `/menu`. Bindings of sessions that were archived or removed meanwhile are dropped. Internally, all chat state, replies, drafts and typing indicators are now kept per chat topic (Bot API 10.5 `message_thread_id`), in preparation for private-chat topic mode; chats without topics behave as before.
- Show the Agent the content of expandable quotes when the user replies to or quotes a rich message: Bot API 10.5 replaced the quote's `text` with nested `blocks`, which reached the Agent as an empty quote. Both forms are read.
- Keep `/menu`, questions and approvals working while Telegram refuses widgets: since 2026-11-13 Telegram answers `sendWidget` from general bots with `INPUT_MEDIA_WIDGET_NOT_ALLOWED`, which made every `/menu` fail. Such a panel is now sent as a rich message with inline buttons and works the same way (taps edit it in place). Later panels go straight to buttons. A widget is tried again every 6 hours and whenever the bridge restarts, so panels switch back once Telegram allows widgets again, with no update needed. Each switch is logged once. A new `panelMode` setting (`auto` by default, `keyboard`, or `widget`) forces one form. When the Agent's own `telegram_widget` is refused, the tool tells it to answer in plain text.
- Fix every upload (files delivered with `present`, embedded images, videos and audio): since uploads moved to `undici` in 0.4.0, the form was sent as the text `[object FormData]` and Telegram answered `there is no document in the request`. Uploads now build their form with `undici`'s own `FormData`.

## 0.4.0

- Make panel taps faster (about 0.7 s instead of 1.5–3 s through a distant proxy): Bot API calls share one HTTP/2 session that the long poll keeps open, so no tap waits for a new TLS handshake, and a tap is answered while its new panel state is written instead of after it. The panel keeps its controls locked until that state arrives. Uploads, `NODE_USE_ENV_PROXY` setups and servers without HTTP/2 use `undici` with idle connections kept for a minute. Each tap logs its total and per-call timings at info level.
- Stream replies more evenly: the draft preview updates about every 0.6 s (at least 0.6 s from the start of the previous update, instead of 1.2 s after it finished), and text before an unfinished `<details>` keeps showing with a placeholder after it, instead of the whole preview turning into the placeholder; closed `<details>` blocks show in the preview.
- Answering a question or an approval no longer waits for Telegram to redraw the panel: the Agent (or the next question of a batch) continues at once while the panel turns into its outcome.
- Restyle the built-in panel widgets (`/menu`, questions, approvals): emoji icons are replaced with stroked SVG icons on coloured badges, and cards, rows, the context meter and secondary buttons sit on soft layered fills instead of outlines.
- Add the `telegram_widget` tool for Agents of sessions bound to a Telegram chat: the Agent writes its own self-contained HTML/CSS/JS widget (Bot API 10.4 `sendWidget`, sent without `allow_queries`) for timers, calculators, progress boards, charts and similar dynamic content, or fills a built-in template (`template: "weather"`, a weather card) with JSON data only, and later replaces its chat state with `action: "update"` (`editMessageWidgetData`); it can update only widgets it sent. Arguments are checked against the widget limits (32768 bytes of HTML, 4096 bytes compressed, 1024 bytes of state, 1024-character caption) before sending. The channel prompt describes the widget sandbox and API, and the `/menu` panel and commands the user can be pointed to.
- Redesign `/menu`, questions and approvals as panel widgets (Bot API 10.4 `sendWidget`); inline keyboards and ForceReply prompts are gone, and Telegram apps without widget support are no longer served. One fixed HTML renderer draws whatever panel the bridge writes into the widget's 1024-byte state, so pages change in place and taps arrive as `widget_query` updates. The menu is a dashboard: tiles for workspace, session, model and reasoning effort open their lists, a status line shows a running clock while a task runs, and a meter shows context use; it redraws by itself when a task starts or ends. Lists show 6 entries per page with a dot pager. A question's text stays a rich message and its controls follow in a panel with numbered or checkbox rows and a step bar; choosing a custom answer (or a question without options) makes the panel wait for the user's next message. Finished panels collapse to their outcome.
- Show the Agent what a reply refers to when the replied-to message is a rich message: its blocks are projected to text (without the plugin's own process fold), and when the user selected only a part, that part alone is passed on, including quotes chosen from rich messages (`TextQuote.rich_texts`, Bot API 10.4). Such replies previously reached the Agent as a quote with no extractable text.
- Configure the bot on the DSH Plugins page (Plugins → dsh-telegram): the package ships a browser half whose form on the plugin page edits the bot token (a secret field, never sent back to the browser) and the allowed user ids. Both are volatile settings stored in the profile patch, and the bridge restarts with them on save. Without a token the plugin now stays loaded and idle instead of failing, so the page stays available. The `.env` variables remain a fallback.
- Show a localized title, description and icon on the Plugins page (`locale/*.json`, `icon.svg`). The browser half is TypeScript under `src/client/`, bundled by `tsdown.config.ts` into `lib/browser/client.js` in the DSH client module format.
- One install command: without a profile, `install.sh` installs into every DSH it finds (the Desktop app and the command-line `web` profile), quits a running Desktop on macOS and reopens it afterwards, and `uninstall` also removes the settings the Plugins page saved.
- Read the bot settings from `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` and `TELEGRAM_ALLOW_ALL_USERS`: DeepSeek Harness 0.2.1-rc.2 refuses to start when `~/.dsh/.env` sets any `DSH_`-prefixed name. Rename the entries in `.env`; the old `DSH_TELEGRAM_*` names are still read when exported in the environment.
- Deliver files the Agent declares with DSH's `present` tool: when they number at most 50 and total at most 50 MB, all of them are embedded in the turn's result as `<tg-document>` blocks uploaded through `rich_message.media` (Bot API 10.3); otherwise, or when Telegram still refuses the embedded upload, all of them follow as separate documents. Files that are missing, empty or over the Bot API 50 MB upload limit are listed in one notice instead; the channel prompt tells the Agent when to use `present`, when to place media in the answer, and the 50 MB limit.
- Add `/stats`, which reports the session figures the DSH Web composer shows (turns and steps, model and tool time, TTFT, output speed, token usage with cache hits, and context occupancy with its composition), and `/compact`, which compacts the current idle session through DSH's compaction service: a rich draft shows progress (its Stop button cancels), and the result reports the history and tokens freed with the summary in a collapsed `<details>` block.
- Tell the Agent when to use the channel's advanced formatting, not only its syntax: buttons only for one-tap copying or a single target page, expandable quotes for quoted text and `<details>` for logs and its own working, sparing highlights, spoilers for answers and jokes, footnotes for sources, `<tg-time>` only for exact moments computed with `date`, and maps only with coordinates looked up through a geocoder (WGS-84, with GCJ-02/BD-09 converted). The `<tg-emoji>` syntax is no longer offered, since the Agent has no real custom emoji ids.
- Embed local images, videos and audio the Agent places in its final answer as `![说明](本地路径)`: they upload as photos, videos, animations or audio at their position and take priority over presented files when not everything fits in one message. Drafts and intermediate messages show them as placeholders.

## 0.3.1

- Target DeepSeek Harness 0.2.1-rc.1: DSH peers and development dependencies move to 0.2.1-rc.1 (cordis 4.0.5, schemastery 3.18.5). DSH 0.2.0-rc.2 now refuses to load the plugin; upgrade DSH first.
- Mark the Telegram channel prompt as required, literal runtime context, so its output rules remain when a deployment disables optional runtime context.
- Report saved Telegram images by absolute path, since a DSH 0.2.1 Session's working directory can move away from the workspace root.

## 0.3.0

- Target DeepSeek Harness 0.2.0-rc.2. Install and remove through `dsh plugin --profile <name> add|remove`; the installer cleans up 0.2.x copy installations and no longer creates a dedicated `telegram` profile.
- Create, resume and configure sessions through the Session Controller, exactly like the Web UI: sessions use the DSH default preset and model, model and reasoning choices are stored in the session and become the new default, and Agents stay owned by DSH.
- Register the channel prompt, stream, question and approval listeners once and route them by session, so a replaced Agent keeps its Telegram binding.
- Keep timed `ask_user_question` calls answerable after their wait expires; the late answer is steered in as a reply. Approval prompts show DSH's localized reason.
- Reopening an archived session from `/menu` unarchives it; input to a session archived elsewhere is refused with a hint.
- Notify the chat when final delivery fails (the result stays available through `/resend`); fix menu pages after the first one being sent as new messages instead of editing the panel.
- Add the optional `apiBaseUrl` setting for a self-hosted Bot API server.
- Removed: `/clear` and menu deletion (DSH has no session deletion API; use archive), the `provider`, `model`, `reasoningEffort` and `maxMessageLength` settings, the local Markdown→HTML converter, unused client methods, `probe.mjs` and the copy installer.

## 0.2.x (unreleased changes)

- Route DSH `approval/request` to Telegram through the existing question lifecycle, with explicit one-shot allow/reject buttons, cancellation cleanup and fail-closed delivery errors.

- Cache the latest unsent complete output per bot/chat on disk; delete it on confirmed delivery and add `/resend` to recover it after outages or restarts without a menu entry.

- Add `/menu` with status, paginated workspace/session/model catalogs, reasoning selection, session creation, and confirmed deletion. Bind callback actions to stable IDs and current selections; reject stale or repeated actions.
- Remove `/use`, `/model`, `/stop`, `/reasoning`, and `/status`; retain native Telegram Stop. Localize command descriptions and update fixed prompts/help.
- Send menus, fixed notices, and questions as native Rich Markdown with inline keyboards/ForceReply; eliminate their HTML/plain fallback.

- Match DSH process counts and nested disclosures: intermediate messages at the first level, reasoning and paired tool details at the second. Derive reasoning/tool summaries from content and preserve Rich Markdown inside disclosures.

- Preserve committed DSH reasoning, intermediate replies, tool arguments and textual results in a collapsed final process record. Keep the final answer outside it and retain late results and reasoning-only turns.

- Pass assistant replies and drafts directly as native Rich Markdown, enabling the official task-list, LaTeX, footnote, media, and Rich HTML syntax without a lossy local renderer. Remove rich-to-ordinary fallback and the 24,000-character downgrade; document native limits and integration requirements.

- Render native Rich HTML blocks in final replies and streaming previews: headings, tables, lists, quotations, and dividers. Remove blank-line padding around blocks; replace fixed-width fallback tables with field/value lists and update the injected mobile-formatting guidance.

- Route Telegram native Stop and `/stop` through one current-task cancellation handler, including paused previews and pending user questions, without draft-ID gating.
- Remove legacy preview adapters, per-message cleanup fallback, historical session membership repair, legacy installer-marker migration, and WSL setup/run wrappers. Use `pnpm build` and `bash install.sh` for local updates.

- Include output-format constraints in the existing Telegram channel system context, so Telegram sessions receive them automatically without editing AGENTS.md.

- Bound Telegram API requests, including response-body reads, so a stalled request cannot permanently block subsequent replies. Draft requests time out after 5 seconds; other calls after 15 seconds, with additional time for long polling. Long rate-limit delays are reported instead of silently holding the delivery queue.
- Add consecutive-turn and stalled-response regressions for reply delivery.
- Stream DSH assistant events into native Telegram rich drafts, with thinking, tool preparation, tool execution, elapsed time, and a collapsed recent tool history in rich answers.
- Coalesce preview updates, renew long-running drafts, and fall back to plain drafts or one edited progress message when the server rejects newer methods.
- Connect native Stop controls to the current Agent; reject stale draft controls and stop preview updates during user questions, cancellation, session changes, and shutdown.
- Preserve structured Telegram rate-limit errors, respect retry delays, and avoid automatically resending messages after ambiguous transport failures.
- Draft thinking remains a compact status. Final replies now retain committed reasoning and tool text in the collapsed process record; live terminal streaming is not included.

## 0.2.2

- Target DeepSeek Harness 0.1.5-rc.2 and update the locked development dependencies.
- Read registered sessions through rc2 point observations, release observation leases, and isolate unreadable sessions without changing catalog numbering.
- Replace the retired persistence locator in `/clear`; acquire write ownership and delete all JSONL generations, including compressed logs, while retaining the lock inode.
- Restore staged logs if workspace detachment fails; handle empty sessions that never reached disk.
- Refresh the included build. Change only the DSH version statement in both READMEs.
- Validation: 139 tests, TypeScript checks, build, and copied-plugin import pass on Node.js 24.21.0 / macOS, including real rc2 JSONL backend tests. WSL2 profile startup and live Telegram/LLM requests were not exercised.

## 0.2.1

- Render Markdown headings as bold and standard/escaped inline links as clickable HTML links.
- Recognize backslash-escaped backtick fences and non-breaking-space indentation; decode Markdown escapes inside these compatibility blocks while preserving ordinary code verbatim.
- Support indented backtick, tilde, straight-apostrophe and curly-apostrophe code fences, including CRLF input.
- Render Markdown tables (including escaped leading pipes) as CJK-aligned preformatted tables with wrapped cells; remove inline Markdown markers inside cells.
- Parse before splitting messages; preserve complete HTML tags and link targets in every chunk, with visible-text plain fallbacks.
- Add formatting regressions and refresh the included JavaScript and declarations.
- Validation: 131 automated tests pass in both working and release directories; TypeScript compilation and release import probe pass. Live Telegram delivery was not exercised.

## 0.2.0

- Target DeepSeek Harness 0.1.2-rc.1; raise DSH peer requirements and lock development dependencies to this release.
- Update Cordis to 4.0.2, Schemastery to 3.18.2, and the Cordis loader to 1.0.3.
- Use the official Session Controller types and normalize its reasoning effort IDs for Agent model selection.
- Build against local locked dependencies by default; validate an explicit DSH_ROOT before replacing peer links.
- Repair the dedicated Telegram profile by installing Agent Presets and the subagent model settings required by the standard preset.
- Preserve user configuration during repeat installs and upgrades; reject the reserved node_modules profile name.
- Refresh compiled JavaScript, declarations, installation tests, and bilingual upgrade instructions.

Upgrade DSH first, stop the old profile process, then rerun setup-wsl.sh from this release and restart with run-wsl.sh.

Validation on Node.js 24.19.0 / macOS: 115 automated tests per variant, TypeScript checks, built-plugin import probes, and real rc.1 dedicated/Web profile startup, workspace selection, session creation, and deletion with a mocked Telegram transport. Live Telegram and DeepSeek API requests were not exercised.
