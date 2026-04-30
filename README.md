# AI Config Manager

终端风格 AI 工具配置管理器，通过 `editors.json` 元配置统一管理多系统、多编辑器（Qwen / Codex / Claude Code）的配置文件。

## 功能

- 🖥️ 多系统支持 — Ubuntu / Host（含 WSL 环境自动检测）
- ✏️ 环境变量增删改查
- 📋 模型列表管理（支持 OpenAI / Anthropic 多 Provider）
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

> `host` 在 WSL 环境下自动映射到 Windows 用户目录（`/mnt/c/Users/<用户名>/`）。

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

## License

MIT
