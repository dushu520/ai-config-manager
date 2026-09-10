# AI Config Manager

终端风格 AI 工具配置管理器，通过 `editors.json` 元配置统一管理多系统、多编辑器（Qwen / Codex / Claude Code）的配置文件。

## 功能

- 🖥️ 多系统支持 — Ubuntu / Host（含 WSL 环境自动检测）
- ✏️ 环境变量增删改查
- 📋 模型列表管理（支持 OpenAI / Anthropic 多 Provider）
- 🤖 Claude Code 专用配置页 — 选中 claude-code 自动进入：顶部展示当前环境变量，表单配置
  Base URL / Key 及 Fable / Opus / Sonnet / Haiku / Subagent / 默认 六个模型角色
  （支持从上游获取模型列表后下拉选择），右侧对应模型一键连通性测试
- 🖥️ Claude Desktop 专用配置页 — 顶部展示当前配置，表单编辑源地址（`sourceUrl`）与 API Key、模型列表（Anthropic 路由 · 显示标签自动取上游模型名 · 1M），可勾选「使用 http://127.0.0.1:8318 转发」决定写入配置的地址；右侧逐个模型连通性测试，其余字段原样保留
- 🔄 实时保存，状态反馈
- 🎨 暗色终端风格 UI

## 支持的编辑器

| Host   | 编辑器       | 配置文件                          |
|--------|-------------|----------------------------------|
| ubuntu | qwen        | `~/.qwen/settings.json`          |
| ubuntu | codex       | `~/.codex/auth.json` + `config.toml` |
| ubuntu | claude-code | `~/.claude/settings.json`        |
| host   | qwen        | `~/ .qwen/settings.json`         |
| host   | codex       | `~/ .codex/auth.json` + `config.toml` |
| host   | claude-code | `~/.claude/settings.json`（Windows 侧） |
| host   | claude-desktop | `~\AppData\Local\Claude-3p\configLibrary\<uuid>.json`（Windows 侧） |

> `host` 在 WSL 环境下自动映射到 Windows 用户目录（`/mnt/c/Users/<用户名>/`）。
> Windows 用户名的解析顺序：环境变量 `AICM_WIN_USER` > `cmd.exe` 互通探测 > 扫描 `/mnt/c/Users` 并优先选择**确实存在对应工具目录**的用户（取最近修改者），避免误选系统/沙箱目录。

## 环境要求

- Node.js >= 18
- npm

## 安装与启动

```bash
git clone https://github.com/dushu520/ai-config-manager.git
cd ai-config-manager
npm install

# 开发模式（Vite + 内置 API）
npm run dev

# 生产构建 + 启动
npm run build
npm start
```

应用默认运行在 http://localhost:3101。

## 项目结构

```
├── src/
│   ├── App.jsx            # 主应用组件（环境变量 & 模型管理）
│   ├── ClaudePage.jsx     # Claude Code 专用配置页（env / 模型映射 / 连通性测试）
│   ├── ClaudeDesktopPage.jsx # Claude Desktop 专用配置页（网关 / 模型列表 / 连通性测试）
│   ├── main.jsx           # React 入口
│   └── index.css          # Tailwind 样式
├── editors.json           # 编辑器名称映射（按 host 分组）
├── server.js              # Express 生产服务器
├── vite.config.js         # Vite 配置（含内置 API 插件 & WSL 支持）
├── package.json
└── tailwind.config.js
```

## API

| 方法   | 路径            | 说明                   |
|--------|----------------|------------------------|
| GET    | `/api/editors` | 获取编辑器列表（含路径/类型等完整元数据） |
| GET    | `/api/config`  | 读取配置文件 `?path=...&file=...`      |
| POST   | `/api/config`  | 保存配置文件，Body: `{ path, file, data }` |
| GET    | `/api/models`  | 双协议探测上游 `/v1/models`（OpenAI Bearer / Anthropic x-api-key），返回上游模型与 Claude 别名两组列表 |
| POST   | `/api/test-model` | 代理转发测试请求 Body: `{ url, headers, body }` |

## Claude Desktop：网关地址要求与端口转发

Claude Desktop 对 `inferenceGatewayBaseUrl` 有硬性校验：**必须 https，或 http + 回环地址**（`127.0.0.1` / `localhost`）。网关是「http + 局域网」（如 `http://192.168.3.90:8317`）时直连会被判为 invalid，用 Windows 端口转发映射到回环即可：

```powershell
# 管理员执行一次，规则写入注册表、重启后仍在，无额外进程
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=8318 connectaddress=192.168.3.90 connectport=8317
netsh interface portproxy show v4tov4                                            # 查看
netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=8318   # 删除
```

配置页中填「源地址」= 真实网关地址；勾选「使用 `http://127.0.0.1:8318` 转发」后 `inferenceGatewayBaseUrl` 写回环映射地址，源地址记在自定义字段 `sourceUrl`（Claude Desktop 会忽略该字段）。

> 回环监听无需放行防火墙；只有把 `listenaddress` 改成局域网地址时才需要入站规则。
> 本应用若跑在 WSL 内，访问不到 Windows 回环，页面的「获取模型列表 / 测试」会走源地址（局域网直连）。

模型名（`inferenceModels[].name`）必须是 Anthropic 路由（`claude-*`），真实上游模型写进 `labelOverride`；`supports1m` 为 true 时 Claude Desktop 会额外列出 1M 上下文变体。

## License

MIT
