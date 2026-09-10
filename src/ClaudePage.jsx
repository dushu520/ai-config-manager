import { useState, useEffect, useCallback } from 'react';
import { Save, Check, X, Play, RefreshCw, Eye, EyeOff, Loader2, ChevronDown, ChevronUp, Globe, KeyRound, ListTree, Pencil } from 'lucide-react';

const API = '/api/config';
const CUSTOM = '__custom__';

// 模型角色 → 环境变量映射（与 Claude Code 官方命名保持一致）
const ROLES = [
  { key: 'fable',    label: 'Fable',    modelVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL',  nameVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME' },
  { key: 'opus',     label: 'Opus',     modelVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',   nameVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
  { key: 'sonnet',   label: 'Sonnet',   modelVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL', nameVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  { key: 'haiku',    label: 'Haiku',    modelVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',  nameVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' },
  { key: 'subagent', label: 'Subagent', modelVar: 'CLAUDE_CODE_SUBAGENT_MODEL',     nameVar: null },
  { key: 'default',  label: '默认',      modelVar: 'ANTHROPIC_MODEL',                nameVar: null },
];

const KEY_VARS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];

function normalizeBase(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

function messagesUrl(baseUrl) {
  const base = normalizeBase(baseUrl);
  return base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages';
}

function authHeaders(key) {
  const h = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (key) { h['x-api-key'] = key; h['Authorization'] = 'Bearer ' + key; }
  return h;
}

// 从 Anthropic 风格响应中提取回复文本
function extractReply(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data && data.content)) {
      return data.content.map(c => c.text || '').join('').trim();
    }
  } catch (e) { /* ignore */ }
  return null;
}

export default function ClaudePage({ editor }) {
  const [raw, setRaw] = useState(null);            // settings.json 原始数据
  const [env, setEnv] = useState({});              // 已保存的 env（用于对比 dirty）
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 表单状态
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVar, setApiKeyVar] = useState('ANTHROPIC_AUTH_TOKEN');
  const [showKey, setShowKey] = useState(false);
  const [roleValues, setRoleValues] = useState({});

  // 模型列表（双协议分组）
  const [modelData, setModelData] = useState({ openai: [], anthropic: [] });
  const [modelsState, setModelsState] = useState({ state: 'idle', msg: '' });
  const [customMode, setCustomMode] = useState({}); // 每个角色是否处于手动输入模式

  // 保存状态
  const [saveStatus, setSaveStatus] = useState('idle');

  // 每个角色的测试状态: { running, result, expanded }
  const [tests, setTests] = useState({});

  const totalModels = modelData.openai.length + modelData.anthropic.length;

  const dirty = (() => {
    if (!raw) return false;
    if ((baseUrl || '') !== (env.ANTHROPIC_BASE_URL || '')) return true;
    if ((apiKey || '') !== (env[apiKeyVar] || '')) return true;
    for (const r of ROLES) {
      if ((roleValues[r.key] || '') !== (env[r.modelVar] || '')) return true;
    }
    return false;
  })();

  // 别名 -> 真实上游模型名（来自网关 Anthropic 协议的 display_name）
  const aliasMap = {};
  for (const m of modelData.anthropic) aliasMap[m.id] = m.name;

  // 显示名 = 上游真实模型名：别名取网关的 display_name，其余（上游 ID / 手填）即其本身
  const upstreamName = (r) => {
    const v = (roleValues[r.key] || '').trim();
    if (!v) return '';
    return aliasMap[v] || v;
  };

  const loadConfig = useCallback(async () => {
    if (!editor) return;
    setLoading(true);
    setLoadError(null);
    setTests({});
    try {
      const res = await fetch(API + '?path=' + encodeURIComponent(editor.path) + '&file=' + encodeURIComponent(editor.file));
      if (!res.ok) throw new Error('加载失败: ' + res.status);
      const data = await res.json();
      const e = data.env || {};
      setRaw(data);
      setEnv(e);
      setBaseUrl(e.ANTHROPIC_BASE_URL || '');
      const kv = KEY_VARS.find(k => e[k] !== undefined) || 'ANTHROPIC_AUTH_TOKEN';
      setApiKeyVar(kv);
      setApiKey(e[kv] || '');
      const rv = {};
      for (const r of ROLES) rv[r.key] = e[r.modelVar] || '';
      setRoleValues(rv);
    } catch (err) {
      setLoadError(err.message);
    }
    setLoading(false);
  }, [editor]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // 获取模型列表（后端分别以 OpenAI / Anthropic 双协议探测，避免 CORS）
  const fetchModels = async () => {
    if (!normalizeBase(baseUrl)) { setModelsState({ state: 'error', msg: '请先填写 Base URL' }); return; }
    setModelsState({ state: 'loading', msg: '' });
    try {
      const res = await fetch('/api/models?baseUrl=' + encodeURIComponent(normalizeBase(baseUrl)) + '&key=' + encodeURIComponent(apiKey || ''));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      const openai = data.openai || [];
      const anthropic = data.anthropic || [];
      setModelData({ openai, anthropic });
      setModelsState({ state: 'ok', msg: '上游模型 ' + openai.length + ' 个 · Claude 别名 ' + anthropic.length + ' 个' });
    } catch (err) {
      setModelData({ openai: [], anthropic: [] }); // 失败时清空，避免残留旧列表误导
      setModelsState({ state: 'error', msg: err.message });
    }
  };

  // 初次加载后自动拉取一次模型列表
  useEffect(() => {
    if (!loading && raw && normalizeBase(baseUrl)) fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, raw]);

  const doSave = async () => {
    if (!raw) return;
    setSaveStatus('saving');
    try {
      const nextEnv = { ...env };
      if (normalizeBase(baseUrl)) nextEnv.ANTHROPIC_BASE_URL = normalizeBase(baseUrl);
      else delete nextEnv.ANTHROPIC_BASE_URL;
      if (apiKey) nextEnv[apiKeyVar] = apiKey;
      else delete nextEnv[apiKeyVar];
      for (const r of ROLES) {
        const v = (roleValues[r.key] || '').trim();
        if (v) nextEnv[r.modelVar] = v;
        else delete nextEnv[r.modelVar];
        if (r.nameVar) {
          const nv = upstreamName(r);
          if (nv) nextEnv[r.nameVar] = nv;
          else delete nextEnv[r.nameVar];
        }
      }
      const next = { ...raw, env: nextEnv };
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editor.path, file: editor.file, data: next })
      });
      if (!res.ok) throw new Error('保存失败: ' + res.status);
      setRaw(next);
      setEnv(nextEnv);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // 测试某个角色的模型
  const runTest = async (roleKey) => {
    const modelId = (roleValues[roleKey] || '').trim();
    if (!modelId) return;
    setTests(p => ({ ...p, [roleKey]: { running: true, result: null, expanded: false } }));
    try {
      const res = await fetch('/api/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: messagesUrl(baseUrl),
          headers: authHeaders(apiKey),
          body: JSON.stringify({ model: modelId, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: pong' }] }),
        }),
      });
      const result = await res.json();
      result.reply = extractReply(result.body);
      setTests(p => ({ ...p, [roleKey]: { running: false, result, expanded: !!(result.error || result.status >= 400) } }));
    } catch (err) {
      setTests(p => ({ ...p, [roleKey]: { running: false, result: { status: 0, statusText: 'Network Error', body: err.message, elapsed: 0, error: true, reply: null }, expanded: true } }));
    }
  };

  const setRoleValue = (key, v) => setRoleValues(p => ({ ...p, [key]: v }));

  // 渲染单个角色的模型选择控件：优先下拉，支持手动输入
  const renderModelPicker = (r) => {
    const cur = (roleValues[r.key] || '').trim();
    const inOpenai = modelData.openai.indexOf(cur) !== -1;
    const inAnth = modelData.anthropic.some(m => m.id === cur);
    const inputCls = 'flex-1 min-w-0 bg-bg-primary border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:border-accent outline-none';

    if (customMode[r.key] || totalModels === 0) {
      return (
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <input type="text" value={cur}
            onChange={e => setRoleValue(r.key, e.target.value)}
            placeholder={r.modelVar}
            className={inputCls} />
          {totalModels > 0 && (
            <button onClick={() => setCustomMode(p => ({ ...p, [r.key]: false }))}
              title="返回下拉选择" className="p-1 text-text-secondary hover:text-accent flex-shrink-0">
              <ListTree className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      );
    }

    return (
      <select value={cur}
        onChange={e => {
          const v = e.target.value;
          if (v === CUSTOM) { setCustomMode(p => ({ ...p, [r.key]: true })); return; }
          setRoleValue(r.key, v);
        }}
        className={inputCls + ' cursor-pointer'}>
        <option value="">-- 未设置 --</option>
        {cur && !inOpenai && !inAnth && <option value={cur}>{cur}（当前）</option>}
        {modelData.openai.length > 0 && (
          <optgroup label="上游模型（OpenAI 协议）">
            {modelData.openai.map(id => <option key={'oa-' + id} value={id}>{id}</option>)}
          </optgroup>
        )}
        {modelData.anthropic.length > 0 && (
          <optgroup label="Claude 别名（Anthropic 协议）">
            {modelData.anthropic.map(m => (
              <option key={'an-' + m.id} value={m.id}>{m.name ? m.id + ' · ' + m.name : m.id}</option>
            ))}
          </optgroup>
        )}
        <option value={CUSTOM}>✎ 手动输入…</option>
      </select>
    );
  };

  const envEntries = Object.entries(env || {});
  const ok = !loading && !loadError && raw;

  return (
    <div className="animate-fade-in">
      {/* ===== 顶部：当前环境变量 ===== */}
      <section className="mb-5">
        <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-medium text-text-primary text-sm">当前环境变量 <span className="text-text-secondary text-xs">({envEntries.length})</span></h2>
            <code className="text-text-secondary/60 font-mono text-xs">{editor && editor.path}{editor && editor.file}</code>
          </div>
          {envEntries.length === 0
            ? <div className="px-4 py-4 text-text-secondary text-sm">settings.json 中暂无 env 配置</div>
            : <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {envEntries.map(([k, v]) => (
                  <div key={k} className="px-4 py-1.5 border-b border-border/40 last:border-0 flex items-center gap-2 min-w-0">
                    <span className={'font-mono text-xs truncate ' + (k.indexOf('ANTHROPIC') === 0 || k.indexOf('CLAUDE') === 0 ? 'text-accent' : 'text-text-secondary')}>{k}</span>
                    <span className="text-text-secondary/50 text-xs">=</span>
                    <span className="font-mono text-xs text-text-primary truncate flex-1" title={String(v)}>{String(v)}</span>
                  </div>
                ))}
              </div>}
        </div>
      </section>

      {loading && <div className="text-text-secondary py-10 text-center">加载中...</div>}
      {loadError && <div className="text-red-400 py-10 text-center">错误: {loadError}</div>}

      {ok && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ===== 左下：配置表单 ===== */}
          <section>
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden h-full">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="font-medium text-text-primary text-sm">配置表单</h2>
                <div className="flex items-center gap-3">
                  {dirty && <span className="text-xs text-warning">● 未保存</span>}
                  <button onClick={doSave} disabled={saveStatus === 'saving'}
                    className={'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ' +
                      (saveStatus === 'success' ? 'bg-success text-bg-primary' : saveStatus === 'error' ? 'bg-red-500 text-white' : 'bg-accent hover:bg-accent/80 text-bg-primary disabled:opacity-50')}>
                    {saveStatus === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" />
                      : saveStatus === 'success' ? <Check className="w-3 h-3" />
                      : saveStatus === 'error' ? <X className="w-3 h-3" />
                      : <Save className="w-3 h-3" />}
                    {saveStatus === 'saving' ? '保存中' : saveStatus === 'success' ? '已保存' : saveStatus === 'error' ? '失败' : '保存配置'}
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Base URL */}
                <div>
                  <label className="flex items-center gap-1 text-xs text-text-secondary mb-1"><Globe className="w-3 h-3" /> Base URL <span className="text-text-secondary/40">（ANTHROPIC_BASE_URL）</span></label>
                  <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com 或代理地址"
                    className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm font-mono text-accent focus:border-accent outline-none" />
                </div>

                {/* Key */}
                <div>
                  <label className="flex items-center gap-1 text-xs text-text-secondary mb-1"><KeyRound className="w-3 h-3" /> API Key <span className="text-text-secondary/40">（{apiKeyVar}）</span></label>
                  <div className="flex gap-2">
                    <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..."
                      className="flex-1 bg-bg-primary border border-border rounded px-2 py-1.5 text-sm font-mono text-text-primary focus:border-accent outline-none" />
                    <button onClick={() => setShowKey(p => !p)} className="px-2 bg-bg-tertiary rounded text-text-secondary hover:text-text-primary">
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* 获取模型列表 */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={fetchModels} disabled={modelsState.state === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary hover:border-accent hover:text-accent disabled:opacity-50 transition-all">
                    {modelsState.state === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 获取模型列表
                  </button>
                  {modelsState.state === 'ok' && <span className="text-xs text-success flex items-center gap-1"><ListTree className="w-3 h-3" /> {modelsState.msg}</span>}
                  {modelsState.state === 'error' && <span className="text-xs text-red-400 truncate max-w-[16rem]" title={modelsState.msg}>获取失败: {modelsState.msg.slice(0, 80)}</span>}
                </div>

                {/* 模型角色映射 */}
                <div className="border-t border-border pt-3">
                  <div className="text-xs text-text-secondary mb-2">
                    模型映射 <span className="text-text-secondary/40">（下拉选择或手动输入；显示名自动取上游模型名）</span>
                  </div>
                  <div className="space-y-2">
                    {ROLES.map(r => (
                      <div key={r.key} className="flex items-center gap-2">
                        <span className="w-20 flex-shrink-0 text-xs text-text-primary">{r.label}</span>
                        {renderModelPicker(r)}
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-text-secondary/50 mt-2 leading-relaxed">
                    Fable/Opus/Sonnet/Haiku → ANTHROPIC_DEFAULT_*_MODEL；Subagent → CLAUDE_CODE_SUBAGENT_MODEL；默认 → ANTHROPIC_MODEL
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===== 右侧：对应模型 + 测试 ===== */}
          <section>
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden h-full">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-medium text-text-primary text-sm">对应模型 · 连通性测试</h2>
              </div>
              <div className="divide-y divide-border/40">
                {ROLES.map(r => {
                  const t = tests[r.key];
                  const modelId = (roleValues[r.key] || '').trim();
                  const res = t && t.result;
                  const real = upstreamName(r);                        // 上游真实模型名（别名 -> display_name，否则即 ID）
                  const savedName = r.nameVar ? (env[r.nameVar] || '') : '';
                  const isAlias = !!real && real !== modelId;
                  const stale = r.nameVar && savedName && real && savedName !== real;
                  return (
                    <div key={r.key} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-20 flex-shrink-0">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-primary">{r.label}</span>
                        </span>
                        <span className={'font-mono text-xs truncate flex-1 ' + (modelId ? 'text-text-primary' : 'text-text-secondary/40')} title={modelId}>
                          {modelId || '未设置'}
                        </span>
                        {res && !t.running && (
                          <button onClick={() => setTests(p => ({ ...p, [r.key]: { ...t, expanded: !t.expanded } }))}
                            className={'flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded ' + (res.error || res.status >= 400 ? 'bg-red-500/20 text-red-400' : 'bg-success/20 text-success')}>
                            {res.status} · {res.elapsed}ms
                            {t.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        <button onClick={() => runTest(r.key)} disabled={!modelId || (t && t.running)}
                          className="flex items-center gap-1 text-xs text-success hover:text-success/80 disabled:opacity-30 flex-shrink-0">
                          {t && t.running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} 测试
                        </button>
                      </div>
                      {(isAlias || stale) && (
                        <div className="mt-0.5 ml-[5.5rem] text-[10px] leading-4 flex items-center gap-2 flex-wrap">
                          {isAlias && <span className="text-text-secondary/70">↳ 上游 {real}</span>}
                          {stale && <span className="text-warning">⚠ 已存显示名 {savedName}，保存后自动改为 {real}</span>}
                        </div>
                      )}
                      {t && t.running && <div className="mt-1 ml-[5.5rem] text-xs text-text-secondary">请求中...</div>}
                      {t && t.expanded && res && (
                        <div className="mt-2 ml-[5.5rem]">
                          {res.reply && <div className="text-xs text-success mb-1 font-mono">↳ {res.reply}</div>}
                          <pre className="bg-bg-primary border border-border rounded p-2 text-[10px] font-mono text-text-primary whitespace-pre-wrap break-all max-h-40 overflow-auto">{res.body}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2 border-t border-border text-[10px] text-text-secondary/50">
                测试请求 POST {normalizeBase(baseUrl) || '(Base URL)'}/v1/messages，使用上方表单中的 Base URL / Key（无需先保存）
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
