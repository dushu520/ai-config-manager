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

// ============ API ============

// 获取编辑器配置列表
app.get('/api/editors', (req, res) => {
  try {
    const editorsPath = path.join(__dirname, 'editors.json');
    const content = fs.readFileSync(editorsPath, 'utf-8');
    const home = os.homedir();
    const resolved = JSON.parse(content);
    // 递归替换路径中的 ${HOME}
    function resolveHome(obj) {
      if (typeof obj === 'string') return obj.replace(/\$\{HOME\}/g, home);
      if (Array.isArray(obj)) return obj.map(resolveHome);
      if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = resolveHome(value);
        }
        return result;
      }
      return obj;
    }
    return res.json(resolveHome(resolved));
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
