# DSH Telegram

[简体中文](README.zh.md)

A Telegram bot plugin for DeepSeek Harness, primarily for Linux / WSL2. Chat with agents and send images and files in private Telegram chats, sharing workspaces and sessions with the Web UI.

Developed against **DeepSeek Harness v0.2.0-rc.2**. Installation goes through DSH's own `dsh plugin` command, which checks version compatibility at startup.

## Install

Requires Bash and Node.js 22.19+ (22.x) or 24+ with npm/npx; online installation also requires curl. pnpm is used when present, otherwise fetched through npx. No global DSH installation or DSH source checkout is needed. Upgrading from 0.2.x removes the old copied installation automatically.

Install online:

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- install
```

Or run from this repository:

```bash
bash install.sh
```

## Configure and use

Create a bot through @BotFather on Telegram, then configure it in the terminal that starts DSH:

```bash
export DSH_TELEGRAM_TOKEN='<your BotFather token>'
export DSH_TELEGRAM_ALLOWED_USER_IDS='<your numeric Telegram user ID>'
npx @deepseek-ai/dsh web
```

Separate multiple user IDs with commas. Only private chats and allowed users are supported. Keep tokens out of Git.

Configure model credentials and create a workspace in the Web UI, then open a private chat with the bot:

- `/menu`: select a workspace, create, open or archive sessions, and switch models and reasoning effort.
- `/help`: list available commands.
- Send text, images, or files to start chatting.

Provide the environment variables on every launch. Do not run multiple bot processes with the same token.

Defaults are the `web` profile and the `~/.dsh` data directory. If you customize `DSH_TELEGRAM_PROFILE` or `DSH_HOME`, use matching settings for installation, removal, and startup. Start other profiles with `npx @deepseek-ai/dsh --profile NAME`.

## Update

Stop DSH and run the online installation command again. For a local checkout, get the latest code, run `pnpm install --frozen-lockfile && pnpm build`, then `bash install.sh`. Restart DSH afterward.

## Uninstall

Stop DSH, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- uninstall
```

Or run from this repository:

```bash
bash install.sh uninstall
```

DSH, model settings, workspaces, and history are preserved. Remove manually added Telegram configuration yourself.
