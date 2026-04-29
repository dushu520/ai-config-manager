# AI Config Manager

终端风格配置管理器，通过元配置文件统一管理多系统、多编辑器的配置文件。

## 功能特性

- 多系统/编辑器配置统一管理
- 环境变量增删改查
- 模型列表管理 (支持 OpenAI/Anthropic)
- 实时保存与状态反馈

## 支持的编辑器

| 系统 | 编辑器 | 配置文件 |
|------|--------|----------|
| ubuntu | qwen | `~/.qwen/settings.json` |
| ubuntu | codex | `~/.codex/auth.json`, `config.toml` |
| ubuntu | claude-code | `~/.claude/settings.json` |
| host | opencode | `~/.config/opencode/config.yaml` |

## 部署方法

### 环境要求

- Node.js >= 18
- npm/pnpm

### 安装与启动

```bash
# 克隆项目
git clone https://github.com/yufang/ai-config-manager.git
cd ai-config-manager

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版
npm run build

# 启动生产服务器
npm start
```

### Docker 部署

```bash
# 构建镜像
docker build -t ai-config-manager .

# 运行容器
docker run -d -p 3101:3101 --name ai-config-manager ai-config-manager
```

### docker-compose

```bash
docker-compose up -d
```

## 默认端口

- 应用端口: `3101`
- 访问地址: http://localhost:3101

## 项目结构

```
├── src/
│   ├── App.jsx      # 主应用组件
│   ├── main.jsx     # 入口
│   └── index.css    # 样式
├── server.js        # Express 后端
├── package.json
└── vite.config.js   # Vite 配置
```

## API 接口

### GET /api/config
读取配置文件
```
/api/config?path=/home/user/.config/&file=settings.json
```

### POST /api/config
保存配置文件
```json
{
  "path": "/home/user/.config/",
  "file": "settings.json",
  "data": { ... }
}
```

## License

MIT