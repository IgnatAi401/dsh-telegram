# DSH Telegram

[English](README.en.md)

DeepSeek Harness 的 Telegram 机器人插件，支持命令行版（Linux / WSL2 / macOS）和桌面版。在 Telegram 私聊中与 Agent 对话、发送图片和文件，并与 Web UI 共享工作区和会话。

基于 **DeepSeek Harness v0.2.1-rc.1** 开发，通过 DSH 自带的 `dsh plugin` 安装。

## 安装

在终端运行（命令行版请先停止正在运行的 DSH）：

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash
```

脚本会自动找到本机的桌面版和命令行版并分别安装；macOS 上桌面版正在运行时会自动退出并在装好后重新打开。命令行版需要 Node.js 22.19+ 或 24+；桌面版如提示找不到 dsh 命令，先在 App 菜单的“管理 dsh 命令…”中安装。

Windows 桌面版：在 App 的“插件”页点“添加插件”，填入 `github:IgnatAi401/dsh-telegram` 安装。Windows 上的命令行版请在 WSL2 中按上文安装。

## 配置与使用

1. 在 Telegram 中私聊 @BotFather 创建机器人，复制它给出的 Bot Token；私聊 @userinfobot 查看你的数字用户 ID。
2. 启动 DSH（桌面版直接打开 App，命令行版运行 `npx @deepseek-ai/dsh web`），打开“插件”→ dsh-telegram，在页面上方填写 Bot Token 和允许的用户 ID（多个用逗号分隔），点“保存”。保存后立即生效，无需重启。
3. 在 Web UI 配置模型凭据并创建工作区后，私聊机器人：

- `/menu`：选择工作区，新建、打开或归档会话，切换模型和推理强度。
- `/help`：查看可用命令。
- 直接发送文字、图片或文件开始对话。

仅支持私聊，只有允许的用户可以访问。同一个 token 不要同时运行多个机器人进程。旧版本写在 `~/.dsh/.env` 中的 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_ALLOWED_USER_IDS` 仍然有效，设置页中填写的值优先。

## 更新

重新运行安装命令即可，设置会保留。使用本地仓库时，先 `git pull` 再运行 `bash install.sh`。

## 卸载

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- uninstall
```

Windows 桌面版在“插件”页卸载。卸载会一并删除插件页中保存的 Telegram 设置，保留 DSH、模型配置、工作区和历史记录。

只想管理某个运行配置时，在命令末尾写上配置名，例如 `bash -s -- install desktop`；本地仓库中可运行 `bash install.sh [install|uninstall] [配置名]`。
