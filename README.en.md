# DSH Telegram

[简体中文](README.md)

A Telegram bot plugin for DeepSeek Harness, primarily for Linux / WSL2, with Desktop support. Chat with agents and send images and files in private Telegram chats, sharing workspaces and sessions with the Web UI.

Developed against **DeepSeek Harness v0.2.1-rc.1** and installed through DSH's own `dsh plugin` command.

## Install

CLI (DSH started with `npx @deepseek-ai/dsh`):

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- install
```

Desktop: quit the app completely, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- install desktop
```

If the dsh command is not found, install it first from the app menu (Manage dsh command…). From this repository you can also run `bash install.sh` or `bash install.sh install desktop`.

Windows Desktop: install the command from the app menu (Manage dsh command…), quit the app completely from the tray, then run in PowerShell:

```powershell
dsh plugin --profile desktop add github:IgnatAi401/dsh-telegram
```

You can also add `github:IgnatAi401/dsh-telegram` on the app's Plugins page. For the CLI on Windows, install inside WSL2 as above.

## Configure and use

Create a bot through @BotFather on Telegram, then add to `~/.dsh/.env` (`%USERPROFILE%\.dsh\.env` on Windows):

```
TELEGRAM_BOT_TOKEN=<your BotFather token>
TELEGRAM_ALLOWED_USER_IDS=<your numeric Telegram user ID>
```

Separate multiple user IDs with commas. Only private chats and allowed users are supported.

Start DSH: run `npx @deepseek-ai/dsh web` for the CLI, or open the Desktop app. Configure model credentials and create a workspace in the Web UI, then open a private chat with the bot:

- `/menu`: select a workspace, create, open or archive sessions, and switch models and reasoning effort.
- `/help`: list available commands.
- Send text, images, or files to start chatting.

Do not run multiple bot processes with the same token. For another profile, append its name to the install and uninstall commands and start it with `npx @deepseek-ai/dsh --profile NAME`; with a custom `DSH_HOME`, put `.env` in that directory.

## Update

Stop DSH (quit Desktop completely), run the install command again, then start DSH. For a local checkout, `git pull` first and then run `bash install.sh`.

## Uninstall

Stop DSH, then run (append `desktop` for Desktop):

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- uninstall
```

From this repository you can also run `bash install.sh uninstall`; on Windows Desktop run `dsh plugin --profile desktop remove dsh-telegram`. DSH, model settings, workspaces, and history are preserved; remove the Telegram settings from `.env` yourself.
