# DSH Telegram

[简体中文](README.md)

A Telegram bot plugin for DeepSeek Harness, for both the command-line version (Linux / WSL2 / macOS) and Desktop. Chat with agents and send images and files in private Telegram chats, sharing workspaces and sessions with the Web UI.

Developed against **DeepSeek Harness v0.2.1-rc.1** and installed through DSH's own `dsh plugin` command.

## Install

Run in a terminal (stop a running command-line DSH first):

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash
```

The script finds Desktop and the command-line version on this machine and installs into each; on macOS a running Desktop is quit and reopened once the plugin is in place. The command-line version needs Node.js 22.19+ or 24+; if Desktop's dsh command is not found, install it first from the app menu (Manage dsh command…).

Windows Desktop: on the app's Plugins page choose Add plugin and enter `github:IgnatAi401/dsh-telegram`. For the command-line version on Windows, install inside WSL2 as above.

## Configure and use

1. In Telegram, message @BotFather to create a bot and copy its token; message @userinfobot to see your numeric user ID.
2. Start DSH (open the Desktop app, or run `npx @deepseek-ai/dsh web`), open Plugins → dsh-telegram, fill in the bot token and the allowed user IDs (comma-separated), and Save. The settings apply at once, without a restart.
3. Configure model credentials and create a workspace in the Web UI, then open a private chat with the bot:

- `/menu`: select a workspace, create, open or archive sessions, and switch models and reasoning effort.
- `/help`: list available commands.
- Send text, images, or files to start chatting.

Only private chats and allowed users are supported. Do not run multiple bot processes with the same token. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` in `~/.dsh/.env` from earlier releases still work; values saved on the Plugins page take precedence.

## Update

Run the install command again; your settings are kept. For a local checkout, `git pull` first and then run `bash install.sh`.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- uninstall
```

On Windows Desktop, uninstall from the Plugins page. Uninstalling also removes the Telegram settings saved on the Plugins page; DSH, model settings, workspaces, and history are preserved.

To manage a single profile, append its name, for example `bash -s -- install desktop`; from a checkout run `bash install.sh [install|uninstall] [profile]`.
