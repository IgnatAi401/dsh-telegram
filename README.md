# DSH Telegram

[English](README.en.md)

DeepSeek Harness 的 Telegram 机器人插件，主要用于 Linux / WSL2，也支持桌面版。在 Telegram 私聊中与 Agent 对话、发送图片和文件，并与 Web UI 共享工作区和会话。

基于 **DeepSeek Harness v0.2.1-rc.1** 开发，通过 DSH 自带的 `dsh plugin` 安装。

## 安装

命令行版（`npx @deepseek-ai/dsh` 启动）：

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- install
```

桌面版：先完全退出 App，再运行：

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- install desktop
```

如提示找不到 dsh 命令，先在 App 菜单的“管理 dsh 命令…”中安装。在本仓库目录中也可以运行 `bash install.sh` 或 `bash install.sh install desktop`。

Windows 桌面版：在 App 菜单的“管理 dsh 命令…”中安装命令，从托盘完全退出 App，再在 PowerShell 中运行：

```powershell
dsh plugin --profile desktop add github:IgnatAi401/dsh-telegram
```

也可以在 App 的“插件”页添加 `github:IgnatAi401/dsh-telegram`。Windows 上的命令行版请在 WSL2 中按上文安装。

## 配置与使用

通过 Telegram 的 @BotFather 创建机器人，然后在 `~/.dsh/.env`（Windows 为 `%USERPROFILE%\.dsh\.env`）中写入：

```
DSH_TELEGRAM_TOKEN=<BotFather 提供的 token>
DSH_TELEGRAM_ALLOWED_USER_IDS=<你的 Telegram 数字用户 ID>
```

多个用户 ID 用逗号分隔。仅支持私聊，只有允许的用户可以访问。

启动 DSH：命令行版运行 `npx @deepseek-ai/dsh web`，桌面版直接打开 App。在 Web UI 配置模型凭据并创建工作区后，私聊机器人：

- `/menu`：选择工作区，新建、打开或归档会话，切换模型和推理强度。
- `/help`：查看可用命令。
- 直接发送文字、图片或文件开始对话。

同一个 token 不要同时运行多个机器人进程。使用其他运行配置时，在安装和卸载命令末尾写上配置名，并用 `npx @deepseek-ai/dsh --profile 配置名` 启动；自定义 `DSH_HOME` 时，`.env` 放在该目录下。

## 更新

停止 DSH（桌面版需完全退出），重新执行安装命令，再启动 DSH。使用本地仓库时，先 `git pull` 再运行 `bash install.sh`。

## 卸载

停止 DSH 后运行（桌面版在末尾加 `desktop`）：

```bash
curl -fsSL https://raw.githubusercontent.com/IgnatAi401/dsh-telegram/main/install.sh | bash -s -- uninstall
```

在本仓库目录中也可以运行 `bash install.sh uninstall`；Windows 桌面版运行 `dsh plugin --profile desktop remove dsh-telegram`。卸载保留 DSH、模型配置、工作区和历史记录；`.env` 中的 Telegram 配置需自行删除。
