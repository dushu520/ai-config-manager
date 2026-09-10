import { useState, useEffect, useCallback } from 'react';
import { Save, Check, X, Play, RefreshCw, Loader2, ChevronDown, ChevronUp, Globe, KeyRound, ListTree, Plus, Trash2 } from 'lucide-react';

const API = '/api/config';
const CUSTOM = '__custom__';

// 默认值（配置里没有对应字段时使用）
const DEFAULT_AUTH_SCHEME = 'bearer';
const DEFAULT_PROVIDER = 'gateway';

// 勾选「转发」时写入 inferenceGatewayBaseUrl 的地址（Windows 桌面端只接受 https 或回环地址）
const MAPPED_BASE = 'http://127.0.0.1:8318';
// 源地址写在配置里的自定义 key（Claude Desktop 不使用它，仅本应用记录）
const SOURCE_KEY = 'sourceUrl';

// 源地址预设（输入框可下拉直接选）
const BASE_PRESETS = [
  { value: 'http://192.168.3.90:8317', label: '网关直连（源地址）' },
  { value: 'http://127.0.0.1:8318', label: '本机映射（勾选转发时写入）' },
  { value: 'http://127.0.0.1:15725/claude-desktop', label: '旧的本机代理路径' },
];

let RID = 1;
const nextId = () => 'r' + (RID++);

function normalizeBase(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

function messagesUrl(baseUrl) {
  const base = normalizeBase(baseUrl);
  return base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages';
}

function authHeaders(key, scheme) {
  const h = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (!key) return h;
  if (scheme === 'x-api-key') h['x-api-key'] = key;
  else h['Authorization'] = 'Bearer ' + key;
  return h;
}

function extractReply(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data && data.content)) return data.content.map(c => c.text || '').join('').trim();
  } catch (e) { /* ignore */ }
  return null;
}

// Claude Desktop 校验：name 必须是 Anthropic 模型路由（claude-* / anthropic/claude-*）
const isAnthropicRoute = (n) => /^claude-/i.test((n || '').trim()) || /^anthropic\/claude-/i.test((n || '').trim());

// Claude Desktop 校验：Base URL 必须 https，或 http 仅限回环地址
function baseUrlProblem(url) {
  const b = normalizeBase(url);
  if (!b) return '';
  if (/^https:\/\//i.test(b)) return '';
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(b)) return '';
  if (/^http:\/\//i.test(b)) return 'Claude Desktop 要求 https，或 http 仅限回环地址（127.0.0.1 / localhost）；当前是 http + 局域网地址，会被判为 invalid。';
  return '地址需以 http:// 或 https:// 开头。';
}

const INPUT_CLS = 'flex-1 min-w-0 bg-bg-primary border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:border-accent outline-none';

export default function ClaudeDesktopPage({ editor }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 源地址（真实网关）+ 是否改用回环映射；认证方式 / Provider 沿用配置原值（缺省用默认值）
  const [sourceUrl, setSourceUrl] = useState('');
  const [useMapped, setUseMapped] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [rows, setRows] = useState([]);            // [{ id, name, supports1m, extra }]

  const [modelData, setModelData] = useState({ openai: [], anthropic: [] });
  const [modelsState, setModelsState] = useState({ state: 'idle', msg: '' });
  const [manualRows, setManualRows] = useState({});

  const [saveStatus, setSaveStatus] = useState('idle');
  const [tests, setTests] = useState({});

  const totalModels = modelData.openai.length + modelData.anthropic.length;

  // 别名 -> 真实上游模型名（网关 Anthropic 协议的 display_name）
  const aliasMap = {};
  for (const m of modelData.anthropic) aliasMap[m.id] = m.name;

  // 显示标签 = 上游真实模型名（别名取 display_name，否则即其本身）
  const upstreamName = (name) => {
    const v = (name || '').trim();
    if (!v) return '';
    return aliasMap[v] || v;
  };

  const authScheme = (raw && raw.inferenceGatewayAuthScheme) || DEFAULT_AUTH_SCHEME;
  const provider = (raw && raw.inferenceProvider) || DEFAULT_PROVIDER;
  // 写入配置的地址：勾选转发用映射地址，否则用源地址
  const effectiveBase = () => (useMapped ? MAPPED_BASE : normalizeBase(sourceUrl));
  // 测试/拉取走源地址（更贴近真实网关；未填则退回写入配置的地址）
  const probeBase = () => normalizeBase(sourceUrl) || effectiveBase();
  const baseProblem = baseUrlProblem(effectiveBase());

  const rowKey = (r) => (r.name || '').trim() + '|' + (!!r.supports1m);
  const savedRowKeys = () => ((raw && raw.inferenceModels) || []).map(m => (m.name || '').trim() + '|' + (!!m.supports1m));

  const dirty = (() => {
    if (!raw) return false;
    const savedSource = (raw && raw[SOURCE_KEY]) || '';
    if ((useMapped ? normalizeBase(sourceUrl) : '') !== savedSource) return true;
    if ((useMapped ? MAPPED_BASE : normalizeBase(sourceUrl)) !== (raw.inferenceGatewayBaseUrl || '')) return true;
    if ((apiKey || '') !== (raw.inferenceGatewayApiKey || '')) return true;
    const now = rows.filter(r => (r.name || '').trim()).map(rowKey);
    const before = savedRowKeys();
    if (now.length !== before.length) return true;
    for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) return true;
    return false;
  })();

  const loadConfig = useCallback(async () => {
    if (!editor) return;
    setLoading(true);
    setLoadError(null);
    setTests({});
    setManualRows({});
    try {
      const res = await fetch(API + '?path=' + encodeURIComponent(editor.path) + '&file=' + encodeURIComponent(editor.file));
      if (!res.ok) throw new Error('加载失败: ' + res.status);
      const data = await res.json();
      setRaw(data);
      const savedBase = normalizeBase(data.inferenceGatewayBaseUrl || '');
      setUseMapped(savedBase === MAPPED_BASE);
      setSourceUrl(data[SOURCE_KEY] || (savedBase === MAPPED_BASE ? '' : savedBase));
      setApiKey(data.inferenceGatewayApiKey || '');
      setRows(((data.inferenceModels) || []).map(m => {
        const extra = {};
        for (const k of Object.keys(m)) {
          if (k !== 'name' && k !== 'labelOverride' && k !== 'supports1m') extra[k] = m[k];
        }
        return { id: nextId(), name: m.name || '', supports1m: !!m.supports1m, extra };
      }));
    } catch (err) {
      setLoadError(err.message);
    }
    setLoading(false);
  }, [editor]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const fetchModels = async () => {
    if (!probeBase()) { setModelsState({ state: 'error', msg: '请先填写源地址' }); return; }
    setModelsState({ state: 'loading', msg: '' });
    try {
      const res = await fetch('/api/models?baseUrl=' + encodeURIComponent(probeBase()) + '&key=' + encodeURIComponent(apiKey || ''));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      const openai = data.openai || [];
      const anthropic = data.anthropic || [];
      setModelData({ openai, anthropic });
      setModelsState({ state: 'ok', msg: 'Anthropic 路由 ' + anthropic.length + ' 个 · 上游模型 ' + openai.length + ' 个' });
    } catch (err) {
      setModelData({ openai: [], anthropic: [] });
      setModelsState({ state: 'error', msg: err.message });
    }
  };

  useEffect(() => {
    if (!loading && raw && probeBase()) fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, raw]);

  const doSave = async () => {
    if (!raw) return;
    setSaveStatus('saving');
    try {
      const next = { ...raw };
      if (effectiveBase()) next.inferenceGatewayBaseUrl = effectiveBase(); else delete next.inferenceGatewayBaseUrl;
      if (useMapped && normalizeBase(sourceUrl)) next[SOURCE_KEY] = normalizeBase(sourceUrl); else delete next[SOURCE_KEY];
      if (apiKey) next.inferenceGatewayApiKey = apiKey; else delete next.inferenceGatewayApiKey;
      next.inferenceGatewayAuthScheme = authScheme;
      next.inferenceProvider = provider;
      next.inferenceModels = rows.filter(r => (r.name || '').trim()).map(r => {
        const name = r.name.trim();
        return { ...(r.extra || {}), name, labelOverride: upstreamName(name), supports1m: !!r.supports1m };
      });
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editor.path, file: editor.file, data: next })
      });
      if (!res.ok) throw new Error('保存失败: ' + res.status);
      setRaw(next);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const runTest = async (row) => {
    const modelId = (row.name || '').trim();
    if (!modelId) return;
    setTests(p => ({ ...p, [row.id]: { running: true, result: null, expanded: false } }));
    try {
      const res = await fetch('/api/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: messagesUrl(probeBase()),
          headers: authHeaders(apiKey, authScheme),
          body: JSON.stringify({ model: modelId, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with exactly: pong' }] }),
        }),
      });
      const result = await res.json();
      result.reply = extractReply(result.body);
      setTests(p => ({ ...p, [row.id]: { running: false, result, expanded: !!(result.error || result.status >= 400) } }));
    } catch (err) {
      setTests(p => ({ ...p, [row.id]: { running: false, result: { status: 0, statusText: 'Network Error', body: err.message, elapsed: 0, error: true, reply: null }, expanded: true } }));
    }
  };

  const updateRow = (id, patch) => setRows(p => p.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows(p => p.filter(r => r.id !== id));
  const addRow = () => setRows(p => p.concat([{ id: nextId(), name: '', supports1m: true, extra: {} }]));

  // 模型名：Anthropic 路由优先（Claude Desktop 只认 claude-*），保留手动输入兜底
  const renderPicker = (row) => {
    const cur = (row.name || '').trim();
    const inOa = modelData.openai.indexOf(cur) !== -1;
    const inAn = modelData.anthropic.some(m => m.id === cur);
    if (manualRows[row.id] || totalModels === 0) {
      return (
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <input type="text" value={cur} onChange={e => updateRow(row.id, { name: e.target.value })}
            placeholder="Anthropic 路由，如 claude-sonnet-4-5" className={INPUT_CLS} />
          {totalModels > 0 && (
            <button onClick={() => setManualRows(p => ({ ...p, [row.id]: false }))} title="返回下拉选择"
              className="p-1 text-text-secondary hover:text-accent flex-shrink-0"><ListTree className="w-3.5 h-3.5" /></button>
          )}
        </div>
      );
    }
    return (
      <select value={cur}
        onChange={e => {
          const v = e.target.value;
          if (v === CUSTOM) { setManualRows(p => ({ ...p, [row.id]: true })); return; }
          updateRow(row.id, { name: v });
        }}
        className={INPUT_CLS + ' cursor-pointer'}>
        <option value="">-- 选择模型路由 --</option>
        {cur && !inOa && !inAn && <option value={cur}>{cur}（当前）</option>}
        {modelData.anthropic.length > 0 && (
          <optgroup label="Anthropic 路由（Claude Desktop 只认这组）">
            {modelData.anthropic.map(m => (
              <option key={'an-' + m.id} value={m.id}>{m.name ? m.id + ' · ' + m.name : m.id}</option>
            ))}
          </optgroup>
        )}
        {modelData.openai.length > 0 && (
          <optgroup label="上游模型名（会被 Claude Desktop 丢弃，仅供查看）">
            {modelData.openai.map(id => <option key={'oa-' + id} value={id}>{id}</option>)}
          </optgroup>
        )}
        <option value={CUSTOM}>✎ 手动输入…</option>
      </select>
    );
  };

  const cfgEntries = raw ? Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]) : [];
  const ok = !loading && !loadError && raw;

  return (
    <div className="animate-fade-in">
      {/* ===== 顶部：当前配置内容 ===== */}
      <section className="mb-5">
        <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-medium text-text-primary text-sm">当前配置 <span className="text-text-secondary text-xs">({cfgEntries.length} 项)</span></h2>
            <code className="text-text-secondary/60 font-mono text-xs">{editor && editor.path}{editor && editor.file}</code>
          </div>
          {cfgEntries.length === 0
            ? <div className="px-4 py-4 text-text-secondary text-sm">配置文件为空</div>
            : <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {cfgEntries.map(([k, v]) => (
                  <div key={k} className="px-4 py-1.5 border-b border-border/40 last:border-0 flex items-center gap-2 min-w-0">
                    <span className={'font-mono text-xs truncate ' + (k.indexOf('inference') === 0 ? 'text-accent' : 'text-text-secondary')}>{k}</span>
                    <span className="text-text-secondary/50 text-xs">=</span>
                    <span className="font-mono text-xs text-text-primary truncate flex-1" title={v}>{v}</span>
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
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="flex items-center gap-1 text-xs text-text-secondary"><Globe className="w-3 h-3" /> 源地址 <span className="text-text-secondary/40">（{SOURCE_KEY}）</span></label>
                    <label className="ml-auto flex items-center gap-1 text-[11px] text-text-primary cursor-pointer select-none">
                      <input type="checkbox" checked={useMapped} onChange={e => setUseMapped(e.target.checked)} className="accent-accent" />
                      使用 http://127.0.0.1:8318 转发
                    </label>
                  </div>
                  <input type="text" list="desktop-base-presets" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="http://192.168.3.90:8317"
                    className={'w-full bg-bg-primary border rounded px-2 py-1.5 text-sm font-mono text-accent outline-none ' + (baseProblem ? 'border-warning' : 'border-border focus:border-accent')} />
                  <datalist id="desktop-base-presets">
                    {BASE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </datalist>
                  <div className="text-[10px] mt-1 leading-relaxed">
                    <span className="text-text-secondary/50">写入 inferenceGatewayBaseUrl：</span>
                    <span className={'font-mono ' + (baseProblem ? 'text-warning' : 'text-success')}>{effectiveBase() || '(空)'}</span>
                    {baseProblem
                      ? <span className="text-warning"> ⚠ {baseProblem}</span>
                      : <span className="text-text-secondary/40">{useMapped ? '（经 127.0.0.1:8318 转发）' : '（未勾选转发，直接写源地址）'}</span>}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-1 text-xs text-text-secondary mb-1"><KeyRound className="w-3 h-3" /> API Key <span className="text-text-secondary/40">（inferenceGatewayApiKey）</span></label>
                  <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="ccs-..."
                    className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm font-mono text-text-primary focus:border-accent outline-none" />
                </div>

                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-xs text-text-secondary">模型列表 <span className="text-text-secondary/40">（inferenceModels · 显示标签自动取上游模型名）</span></span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={fetchModels} disabled={modelsState.state === 'loading'}
                        className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary border border-border rounded text-[11px] text-text-primary hover:border-accent hover:text-accent disabled:opacity-50">
                        {modelsState.state === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 获取模型列表
                      </button>
                      <button onClick={addRow} className="flex items-center gap-1 px-2 py-1 text-[11px] text-accent hover:text-accent/80"><Plus className="w-3 h-3" /> 添加</button>
                    </div>
                  </div>
                  {modelsState.state === 'ok' && <div className="text-[10px] text-success mb-1">{modelsState.msg}</div>}
                  {modelsState.state === 'error' && <div className="text-[10px] text-red-400 mb-1 truncate" title={modelsState.msg}>获取失败: {modelsState.msg.slice(0, 90)}</div>}

                  <div className="space-y-1.5">
                    {rows.length === 0 && <div className="text-xs text-text-secondary/50 py-2">暂无模型，点「添加」新增一行</div>}
                    {rows.map(row => {
                      const name = (row.name || '').trim();
                      const label = upstreamName(name);
                      const bad = name && !isAnthropicRoute(name);
                      return (
                        <div key={row.id}>
                          <div className="flex items-center gap-2">
                            {renderPicker(row)}
                            <span className="text-[10px] text-success/80 flex-shrink-0 max-w-[7rem] truncate" title={label}>
                              {label || '—'}
                            </span>
                            <label className="flex items-center gap-1 text-[10px] text-text-secondary flex-shrink-0 cursor-pointer">
                              <input type="checkbox" checked={!!row.supports1m} onChange={e => updateRow(row.id, { supports1m: e.target.checked })} className="accent-accent" /> 1M
                            </label>
                            <button onClick={() => removeRow(row.id)} className="p-1 text-text-secondary hover:text-red-400 flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                          {bad && (
                            <div className="text-[10px] text-warning mt-0.5 leading-relaxed">
                              ⚠ 不是 Anthropic 路由，Claude Desktop 会丢弃该条（需 claude-* 形式，如 claude-sonnet-4-5）
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                {rows.length === 0 && <div className="px-4 py-6 text-center text-text-secondary text-xs">暂无模型</div>}
                {rows.map(row => {
                  const t = tests[row.id];
                  const res = t && t.result;
                  const name = (row.name || '').trim();
                  const label = upstreamName(name);
                  return (
                    <div key={row.id} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={'font-mono text-xs truncate flex-1 ' + (name ? 'text-text-primary' : 'text-text-secondary/40')} title={name}>
                          {name || '未填写'}
                        </span>
                        {label && label !== name && <span className="text-[10px] text-text-secondary/70 flex-shrink-0">↳ 上游 {label}</span>}
                        {res && !t.running && (
                          <button onClick={() => setTests(p => ({ ...p, [row.id]: { ...t, expanded: !t.expanded } }))}
                            className={'flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded ' + (res.error || res.status >= 400 ? 'bg-red-500/20 text-red-400' : 'bg-success/20 text-success')}>
                            {res.status} · {res.elapsed}ms
                            {t.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        <button onClick={() => runTest(row)} disabled={!name || (t && t.running)}
                          className="flex items-center gap-1 text-xs text-success hover:text-success/80 disabled:opacity-30 flex-shrink-0">
                          {t && t.running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} 测试
                        </button>
                      </div>
                      {t && t.expanded && res && (
                        <div className="mt-2">
                          {res.reply && <div className="text-xs text-success mb-1 font-mono">↳ {res.reply}</div>}
                          <pre className="bg-bg-primary border border-border rounded p-2 text-[10px] font-mono text-text-primary whitespace-pre-wrap break-all max-h-40 overflow-auto">{res.body}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2 border-t border-border text-[10px] text-text-secondary/50 leading-relaxed">
                测试/拉取走「源地址」，认证方式 {authScheme}（无需先保存）：POST {messagesUrl(probeBase()) || '(源地址)'}。
                <br />配置里写入的是 {effectiveBase() || '(空)'}（勾选转发则为回环映射，Windows 桌面端才认）。
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
