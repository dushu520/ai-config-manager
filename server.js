import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3101;

app.use(cors());
app.use(express.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'dist')));

// ============ 编辑器元数据（固定规则） ============

const EDITOR_META = {
  'qwen':        { pathSuffix: '.qwen',   file: 'settings.json',                        type: 'qwen' },
  'codex':       { pathSuffix: '.codex',  authFile: 'auth.json', file: 'config.toml',   type: 'codex' },
  'claude-code': { pathSuffix: '.claude',  file: 'settings.json',                        type: 'qwen' },
};

// WSL 检测
function isWSL() {
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
           fs.existsSync('/run/WSL') ||
           /microsoft|WSL/i.test(fs.readFileSync('/proc/version', 'utf-8'));
  } catch { return false; }
}

// 获取 Windows 用户名（WSL 环境）
async function getWinUsername() {
  try {
    const { execSync } = await import('child_process');
    const name = execSync('cmd.exe /C "echo %USERNAME%"', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (name && !name.includes('%')) return name;
    throw new Error('cmd.exe failed');
  } catch {
    // 回退：扫描 /mnt/c/Users/ 下非系统目录
    try {
      const skip = new Set(['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']);
      const dirs = fs.readdirSync('/mnt/c/Users/', { withFileTypes: true })
        .filter(d => d.isDirectory() && !skip.has(d.name));
      if (dirs.length > 0) return dirs[0].name;
    } catch {}
    return '';
  }
}

// ============ API ============

// 获取编辑器配置列表（动态生成完整元数据）
app.get('/api/editors', async (req, res) => {
  try {
    const editorsPath = path.join(__dirname, 'editors.json');
    const raw = JSON.parse(fs.readFileSync(editorsPath, 'utf-8')); // { host: [name, ...] }

    const home = os.homedir();
    const wsl = isWSL();

    const result = {};
    for (const [host, names] of Object.entries(raw)) {
      let base;
      if (host === 'host' && wsl) {
        const winUser = await getWinUsername();
        base = winUser ? `/mnt/c/Users/${winUser}` : home;
      } else {
        base = home;
      }

      result[host] = names.map(name => {
        const meta = EDITOR_META[name];
        if (!meta) return null;
        return {
          name,
          path: path.join(base, meta.pathSuffix) + '/',
          file: meta.file,
          ...(meta.authFile ? { authFile: meta.authFile } : {}),
          type: meta.type,
        };
      }).filter(Boolean);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 读取配置文件
app.get('/api/config', (req, res) => {
  const { path: configPath, file } = req.query;
  if (!configPath || !file) return res.status(400).json({ error: '缺少参数' });

  const fullPath = path.join(configPath, file);
  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (file.endsWith('.json')) return res.json(JSON.parse(content));
      if (file.endsWith('.toml')) return res.json(parseToml(content));
      return res.json({ content });
    }
    return res.json({});
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 保存配置文件
app.post('/api/config', (req, res) => {
  const { path: configPath, file, data } = req.body;
  if (!configPath || !file) return res.status(400).json({ error: '缺少参数' });

  const fullPath = path.join(configPath, file);
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let content;
    if (file.endsWith('.json')) content = JSON.stringify(data, null, 2);
    else if (file.endsWith('.toml')) content = stringifyToml(data);
    else content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    fs.writeFileSync(fullPath, content, 'utf-8');
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// TOML 解析
function parseToml(content) {
  const result = {};
  const lines = content.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (currentSection.startsWith('model_providers.')) {
        const provider = currentSection.replace('model_providers.', '');
        if (!result.model_providers) result.model_providers = {};
        result.model_providers[provider] = {};
      } else if (currentSection.startsWith('projects.')) {
        if (!result.projects) result.projects = {};
        result.projects[currentSection.replace('projects.', '')] = {};
      }
      continue;
    }

    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (kvMatch) {
      let key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value) && value !== '') value = Number(value);
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);

      if (currentSection?.startsWith('model_providers.')) {
        const provider = currentSection.replace('model_providers.', '');
        result.model_providers[provider][key] = value;
      } else if (currentSection?.startsWith('projects.')) {
        const proj = currentSection.replace('projects.', '');
        if (!result.projects[proj]) result.projects[proj] = {};
        result.projects[proj][key] = value;
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

// TOML 序列化
function stringifyToml(data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'model_providers' || key === 'projects') continue;
    lines.push(`${key} = ${stringifyValue(value)}`);
  }
  if (data.model_providers) {
    for (const [name, props] of Object.entries(data.model_providers)) {
      lines.push(`[model_providers.${name}]`);
      for (const [k, v] of Object.entries(props)) {
        lines.push(`${k} = ${stringifyValue(v)}`);
      }
    }
  }
  if (data.projects) {
    for (const [proj, props] of Object.entries(data.projects)) {
      lines.push(`[projects."${proj}"]`);
      for (const [k, v] of Object.entries(props)) {
        lines.push(`${k} = ${stringifyValue(v)}`);
      }
    }
  }
  return lines.join('\n');
}

function stringifyValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return `"${value}"`;
  return `"${JSON.stringify(value)}"`;
}

// SPA 路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Config Manager: http://localhost:${PORT}`);
});
