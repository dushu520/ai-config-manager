import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// WSL 检测
function isWSL() {
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
           fs.existsSync('/run/WSL') ||
           /microsoft|WSL/i.test(fs.readFileSync('/proc/version', 'utf-8'));
  } catch { return false; }
}

// 解析 Windows 用户名（WSL 环境）：显式覆盖 > cmd.exe 互通 > 目录扫描兜底
async function getWinUsername() {
  const override = process.env.AICM_WIN_USER;
  if (override) return override;
  const { execSync } = await import('child_process');
  const probes = ['cmd.exe /C "echo %USERNAME%"', '/mnt/c/Windows/System32/cmd.exe /C "echo %USERNAME%"'];
  for (const cmd of probes) {
    try {
      const name = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (name && !name.includes('%') && !name.includes('not found') && !name.includes('No such')) return name;
    } catch (e) { /* 继续下一个探测方式 */ }
  }
  return '';
}

// 解析编辑器实际配置文件名：claude-desktop 的文件名含安装 UUID，
// 默认文件不存在时在该目录里挑最新的 UUID 形 json 兜底（跳过 _meta.json 之类）
function resolveEditorFile(base, meta) {
  if (!meta.pickJson) return meta.file;
  const dir = path.join(base, meta.pathSuffix);
  try {
    if (fs.existsSync(path.join(dir, meta.file))) return meta.file;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]json$/i;
    const cands = fs.readdirSync(dir).filter(f => uuidRe.test(f))
      .map(f => ({ f: f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (cands.length) return cands[0].f;
  } catch (e) { /* 回退默认文件名 */ }
  return meta.file;
}

// /mnt/c/Users 下的候选用户目录（跳过系统目录）
function winUserDirs() {
  const skip = new Set(['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']);
  try {
    return fs.readdirSync('/mnt/c/Users', { withFileTypes: true })
      .filter(d => d.isDirectory() && !skip.has(d.name))
      .map(d => d.name);
  } catch (e) { return []; }
}

// 兜底选择 Windows 用户：优先确实存在该工具目录的用户（取最近修改者），
// 其次存在任一工具目录的用户，最后才取第一个候选目录
function pickWinUser(preferDir) {
  const dirs = winUserDirs();
  if (dirs.length === 0) return '';
  const known = ['.claude', '.codex', '.qwen', 'AppData/Local/Claude-3p'];
  const mtime = (user, dir) => {
    try { return fs.statSync('/mnt/c/Users/' + user + '/' + dir).mtimeMs; } catch (e) { return -1; }
  };
  if (preferDir) {
    const hit = dirs.map(n => ({ n, t: mtime(n, preferDir) })).filter(x => x.t >= 0).sort((a, b) => b.t - a.t);
    if (hit.length) return hit[0].n;
  }
  const any = dirs.map(n => ({ n, t: Math.max.apply(null, known.map(d => mtime(n, d))) }))
    .filter(x => x.t >= 0).sort((a, b) => b.t - a.t);
  if (any.length) return any[0].n;
  return dirs[0];
}

// host（Windows 侧）的实际基础目录
async function resolveHostBase(preferDir) {
  if (!isWSL()) return os.homedir();
  const winUser = await getWinUsername();
  if (winUser) return '/mnt/c/Users/' + winUser;
  const picked = pickWinUser(preferDir);
  return picked ? '/mnt/c/Users/' + picked : os.homedir();
}

// 编辑器元数据（固定规则）
const EDITOR_META = {
  'qwen':        { pathSuffix: '.qwen',   file: 'settings.json',                        type: 'qwen' },
  'codex':       { pathSuffix: '.codex',  authFile: 'auth.json', file: 'config.toml',   type: 'codex' },
  'claude-code': { pathSuffix: '.claude',  file: 'settings.json',                        type: 'claude' },
  'claude-desktop': { pathSuffix: 'AppData/Local/Claude-3p/configLibrary', file: '00000000-0000-4000-8000-000000157210.json', type: 'claude-desktop', pickJson: true },
};

function parseToml(content) {
  const result = {}
  const lines = content.split('\n')
  let currentSection = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      if (currentSection.startsWith('model_providers.')) {
        const provider = currentSection.replace('model_providers.', '')
        if (!result.model_providers) result.model_providers = {}
        result.model_providers[provider] = {}
      } else if (currentSection.startsWith('projects.')) {
        if (!result.projects) result.projects = {}
        result.projects[currentSection.replace('projects.', '')] = {}
      }
      continue
    }
    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/)
    if (kvMatch) {
      let key = kvMatch[1].trim()
      let value = kvMatch[2].trim()
      if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (!isNaN(value) && value !== '') value = Number(value)
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
      if (currentSection?.startsWith('model_providers.')) {
        const provider = currentSection.replace('model_providers.', '')
        result.model_providers[provider][key] = value
      } else if (currentSection?.startsWith('projects.')) {
        const proj = currentSection.replace('projects.', '')
        if (!result.projects[proj]) result.projects[proj] = {}
        result.projects[proj][key] = value
      } else {
        result[key] = value
      }
    }
  }
  return result
}

function stringifyToml(data) {
  const lines = []
  for (const [key, value] of Object.entries(data)) {
    if (key === 'model_providers' || key === 'projects') continue
    lines.push(`${key} = ${stringifyValue(value)}`)
  }
  if (data.model_providers) {
    for (const [name, props] of Object.entries(data.model_providers)) {
      lines.push(`[model_providers.${name}]`)
      for (const [k, v] of Object.entries(props)) {
        lines.push(`${k} = ${stringifyValue(v)}`)
      }
    }
  }
  if (data.projects) {
    for (const [proj, props] of Object.entries(data.projects)) {
      lines.push(`[projects."${proj}"]`)
      for (const [k, v] of Object.entries(props)) {
        lines.push(`${k} = ${stringifyValue(v)}`)
      }
    }
  }
  return lines.join('\n')
}

function stringifyValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value
  if (typeof value === 'string') return `"${value}"`
  return `"${JSON.stringify(value)}"`
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-server',
      configureServer(server) {
        const api = express()
        api.use(cors())
        api.use(express.json())

        // 获取编辑器配置列表（动态生成完整元数据）
        api.get('/api/editors', async (req, res) => {
          try {
            const editorsPath = path.join(__dirname, 'editors.json');
            const raw = JSON.parse(fs.readFileSync(editorsPath, 'utf-8')); // { host: [name, ...] }

            const home = os.homedir();
            const wsl = isWSL();

            const result = {};
            for (const [host, names] of Object.entries(raw)) {
              const list = [];
              for (const name of names) {
                const meta = EDITOR_META[name];
                if (!meta) continue;
                const base = host === 'host' && wsl ? await resolveHostBase(meta.pathSuffix) : home;
                list.push({
                  name,
                  path: path.join(base, meta.pathSuffix) + '/',
                  file: resolveEditorFile(base, meta),
                  ...(meta.authFile ? { authFile: meta.authFile } : {}),
                  type: meta.type,
                });
              }
              result[host] = list;
            }

            return res.json(result);
          } catch (error) {
            return res.status(500).json({ error: error.message });
          }
        })


                // 获取模型列表（双协议探测：OpenAI Bearer / Anthropic x-api-key，避免浏览器 CORS）
        api.get('/api/models', async (req, res) => {
          const { baseUrl, key } = req.query;
          if (!baseUrl) return res.status(400).json({ error: '缺少 baseUrl' });
          const base = String(baseUrl).replace(/\/+$/, '');
          const url = base.endsWith('/v1') ? base + '/models' : base + '/v1/models';
          const keyStr = key ? String(key) : '';
          // 单协议尝试，解析 OpenAI / Anthropic / 纯数组等多种响应格式
          const attempt = async (headers) => {
            try {
              const response = await fetch(url, { headers: Object.assign({ 'Content-Type': 'application/json' }, headers) });
              const text = await response.text();
              if (!response.ok) return { error: 'HTTP ' + response.status + ': ' + text.slice(0, 200) };
              let data;
              try { data = JSON.parse(text); } catch (e) { return { error: '响应非 JSON: ' + text.slice(0, 120) }; }
              let items = [];
              if (Array.isArray(data && data.data)) items = data.data;
              else if (Array.isArray(data)) items = data;
              else if (data && Array.isArray(data.models)) items = data.models;
              const list = items
                .map(m => typeof m === 'string' ? { id: m, name: '' } : { id: (m && (m.id || m.name)) || '', name: (m && (m.display_name || m.name)) || '' })
                .filter(m => m.id);
              return { items: list };
            } catch (err) {
              return { error: err.message };
            }
          };
          // 分别以两种协议请求：Bearer 走 OpenAI 分支，x-api-key 走 Anthropic 分支
          const [oa, an] = await Promise.all([
            attempt(keyStr ? { 'Authorization': 'Bearer ' + keyStr } : {}),
            attempt(keyStr ? { 'x-api-key': keyStr, 'anthropic-version': '2023-06-01' } : {}),
          ]);
          const openai = (oa && oa.items) || [];
          const seen = new Set(openai.map(m => m.id));
          const anthropic = ((an && an.items) || []).filter(m => !seen.has(m.id));
          const merged = openai.concat(anthropic);
          if (merged.length === 0) {
            const parts = [];
            if (oa && oa.error) parts.push('OpenAI协议: ' + oa.error);
            if (an && an.error) parts.push('Anthropic协议: ' + an.error);
            return res.status(502).json({ error: parts.join('；') || '上游未返回任何模型' });
          }
          return res.json({
            models: merged.map(m => m.id),
            openai: openai.map(m => m.id),
            anthropic: anthropic.map(m => ({ id: m.id, name: m.name })),
          });
        });

        api.get('/api/config', (req, res) => {
          const { path: configPath, file } = req.query
          if (!configPath || !file) return res.status(400).json({ error: '缺少参数' })
          const fullPath = path.join(configPath, file)
          try {
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (file.endsWith('.json')) return res.json(JSON.parse(content))
              if (file.endsWith('.toml')) return res.json(parseToml(content))
              return res.json({ content })
            }
            return res.json({})
          } catch (error) {
            return res.status(500).json({ error: error.message })
          }
        })

        api.post('/api/config', (req, res) => {
          const { path: configPath, file, data } = req.body
          if (!configPath || !file) return res.status(400).json({ error: '缺少参数' })
          const fullPath = path.join(configPath, file)
          try {
            const dir = path.dirname(fullPath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            let content
            if (file.endsWith('.json')) content = JSON.stringify(data, null, 2)
            else if (file.endsWith('.toml')) content = stringifyToml(data)
            else content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
            fs.writeFileSync(fullPath, content, 'utf-8')
            return res.json({ success: true })
          } catch (error) {
            return res.status(500).json({ error: error.message })
          }
        })

        // 代理测试请求（避免浏览器 CORS 限制）
        api.post('/api/test-model', async (req, res) => {
          const { url, headers, body } = req.body;
          if (!url) return res.status(400).json({ error: '缺少 url' });

          const startTime = Date.now();
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: headers || {},
              body: body || '',
            });
            const elapsed = Date.now() - startTime;

            let resBody = await response.text();
            // 尝试格式化 JSON
            try {
              resBody = JSON.stringify(JSON.parse(resBody), null, 2);
            } catch {}

            return res.json({
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: resBody,
              elapsed,
              error: false,
            });
          } catch (err) {
            const elapsed = Date.now() - startTime;
            return res.json({
              status: 0,
              statusText: 'Network Error',
              headers: {},
              body: err.message,
              elapsed,
              error: true,
            });
          }
        })

        server.middlewares.use(api)
      }
    }
  ],
  base: './',
  server: {
    port: 3101,
    strictPort: false
  }
})
