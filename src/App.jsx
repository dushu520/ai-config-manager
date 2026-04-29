import { useState, useEffect } from 'react';
import { Settings2, Save, Check, X, Plus, Trash2, Edit3 } from 'lucide-react';

const API = '/api/config';

function parseQwen(data) {
  const env = { ...(data.env || {}) };
  const models = [];
  for (const [provider, list] of Object.entries(data.modelProviders || {})) {
    for (const model of (list || [])) {
      models.push({ ...model, provider });
    }
  }
  return { env, models, rawData: data };
}

function serializeQwen(config) {
  // 基于原始完整数据保留所有字段
  const data = { ...config.rawData };
  data.env = { ...config.env };
  const modelProviders = {};
  for (const model of config.models) {
    if (!modelProviders[model.provider]) modelProviders[model.provider] = [];
    const { provider, ...m } = model;
    modelProviders[model.provider].push(m);
  }
  data.modelProviders = modelProviders;
  return data;
}

async function parseCodex(editor) {
  const [authRes, tomlRes] = await Promise.all([
    fetch(`${API}?path=${encodeURIComponent(editor.path)}&file=${encodeURIComponent(editor.authFile)}`),
    fetch(`${API}?path=${encodeURIComponent(editor.path)}&file=${encodeURIComponent(editor.file)}`)
  ]);
  const auth = await authRes.json();
  const toml = await tomlRes.json();
  const env = { ...auth };
  const models = [];
  if (toml.model) {
    models.push({
      id: toml.model,
      provider: toml.model_provider || 'openai',
      name: toml.model,
      baseUrl: toml.model_providers?.[toml.model_provider]?.base_url || '',
      envKey: 'OPENAI_API_KEY'
    });
  }
  return { env, models };
}

async function serializeCodex(editor, config) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: editor.path, file: editor.authFile, data: config.env })
  });
  const model = config.models[0] || {};
  const configToml = { model_provider: model.provider || 'openai', model: model.id || 'gpt-4' };
  if (model.baseUrl) {
    configToml.model_providers = {};
    configToml.model_providers[model.provider || 'openai'] = { name: model.provider || 'openai', base_url: model.baseUrl };
  }
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: editor.path, file: editor.file, data: configToml })
  });
}

export default function App() {
  const [editors, setEditors] = useState({});
  const [host, setHost] = useState('');
  const [editorName, setEditorName] = useState('');
  const [config, setConfig] = useState({ env: {}, models: [] });
  const [saveStatus, setSaveStatus] = useState('idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingEnv, setEditingEnv] = useState(null);
  const [newEnv, setNewEnv] = useState({ key: '', value: '' });
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [editingModel, setEditingModel] = useState(null);
  const [modelFilter, setModelFilter] = useState('all');
  const [envFilter, setEnvFilter] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // 加载编辑器配置
  const loadEditors = async () => {
    try {
      const res = await fetch('/api/editors');
      const data = await res.json();
      setEditors(data);
      // 设置默认选择项
      const hosts = Object.keys(data);
      if (hosts.length > 0 && !host) {
        setHost(hosts[0]);
        const firstEditor = data[hosts[0]]?.[0];
        if (firstEditor) setEditorName(firstEditor.name);
      }
    } catch (err) {
      setError('加载编辑器配置失败: ' + err.message);
    }
  };

  useEffect(() => { loadEditors(); }, []);

  const editor = editors[host]?.find(e => e.name === editorName);

  const loadConfig = async () => {
    if (!editor) return;
    setLoading(true);
    setError(null);
    setSelectedModel(null);
    setEditingModel(null);
    try {
      if (editor.type === 'codex') {
        setConfig(await parseCodex(editor));
      } else {
        const res = await fetch(`${API}?path=${encodeURIComponent(editor.path)}&file=${encodeURIComponent(editor.file)}`);
        if (!res.ok) throw new Error('加载失败');
        const data = await res.json();
        setConfig(editor.type === 'qwen' ? parseQwen(data) : { env: data.env || {}, models: [] });
      }
    } catch (err) {
      setError(err.message);
      setConfig({ env: {}, models: [] });
    }
    setLoading(false);
  };

  useEffect(() => { loadConfig(); }, [host, editorName, editors]);

  const doSave = async (cfg) => {
    if (!editor) return;
    setSaveStatus('saving');
    try {
      if (editor.type === 'codex') {
        await serializeCodex(editor, cfg);
      } else if (editor.type === 'qwen') {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: editor.path, file: editor.file, data: serializeQwen(cfg) })
        });
        if (!res.ok) throw new Error(`保存失败: ${res.status}`);
      }
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('保存失败:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleSave = () => doSave(config);

  const handleSaveEnv = (cfg) => {
    if (!editingEnv) return;
    const { oldKey, key, value } = editingEnv;
    if (!key.trim()) return;
    let newEnv = { ...cfg.env };
    if (oldKey !== key) delete newEnv[oldKey];
    newEnv[key.trim()] = value;
    return { ...cfg, env: newEnv };
  };

  const envApplyAndSave = (updater) => {
    setConfig(prev => {
      const next = updater(prev);
      doSave(next);
      return next;
    });
  };

  const handleApplySaveEnv = () => {
    const next = handleSaveEnv(config);
    if (next) {
      setConfig(next);
      setEditingEnv(null);
      doSave(next);
    }
  };

  const handleDeleteEnv = (key) => envApplyAndSave(prev => { const env = { ...prev.env }; delete env[key]; return { ...prev, env }; });
  const handleAddEnv = () => {
    if (!newEnv.key.trim()) return;
    const next = { ...config, env: { ...config.env, [newEnv.key.trim()]: newEnv.value } };
    setConfig(next);
    setNewEnv({ key: '', value: '' });
    setShowAddEnv(false);
    doSave(next);
  };

  const getModelKey = (m) => `${m.provider}::${m.id}::${m.envKey || ''}::${m.name || ''}`;

  const getModelList = () => {
    let models = [...config.models];
    if (modelFilter !== 'all') models = models.filter(m => m.provider === modelFilter);
    if (envFilter) models = models.filter(m => m.envKey === envFilter);
    return models;
  };

  const handleDeleteModel = (id) => {
    const next = { ...config, models: config.models.filter(m => m.id !== id) };
    if (selectedModel?.id === id) setSelectedModel(null);
    setConfig(next);
    doSave(next);
  };

  const handleSaveModel = () => {
    if (!editingModel) return;
    const { originalId, id, baseUrl } = editingModel;

    // 检查 id + baseUrl 是否已存在（排除自身）
    const duplicate = config.models.find(m =>
      m.id === id &&
      m.baseUrl === baseUrl &&
      (originalId === undefined || m.id !== originalId)
    );
    if (duplicate) {
      alert(`模型已存在：${id}\n${baseUrl}`);
      return;
    }

    const { originalId: _oid, ...updates } = editingModel;
    const next = {
      ...config,
      models: originalId !== undefined
        ? [...config.models.filter(m => m.id !== originalId), updates]
        : [...config.models, updates]
    };
    setConfig(next);
    setEditingModel(null);
    setSelectedModel(updates);
    doSave(next);
  };

  const handleAddModel = () => {
    if (selectedModel) {
      setEditingModel({ ...selectedModel });
    } else {
      setEditingModel({ id: '', name: '', provider: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: '' });
    }
  };

  // 复制模型时，如果用户修改了 id，name 同步更新
  const handleEditingModelIdChange = (e) => {
    const newId = e.target.value;
    setEditingModel(p => ({
      ...p,
      id: newId,
      name: (p.name === '' || p.name === p.id) ? newId : p.name
    }));
  };

  const envEntries = Object.entries(config.env || {});
  const modelList = getModelList();

  return (
    <div className="min-h-screen bg-bg-primary p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center">
              <Settings2 className="w-4 h-4 text-accent" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary">AI Config</h1>
          </div>
          <button onClick={handleSave} disabled={saveStatus === 'saving'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all
              ${saveStatus === 'success' ? 'bg-success text-bg-primary' : saveStatus === 'error' ? 'bg-red-500 text-white' : 'bg-accent hover:bg-accent/80 text-bg-primary'}`}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'success' ? '✓ 已保存' : '💾 保存'}
          </button>
        </header>

        <div className="mb-6 text-sm text-text-secondary flex items-center gap-2 flex-wrap">
          <span>配置:</span>
          <select value={host} onChange={e => { setHost(e.target.value); setEditorName(editors[e.target.value]?.[0]?.name || ''); }}
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-text-primary">
            {Object.keys(editors).map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          <span>/</span>
          <select value={editorName} onChange={e => setEditorName(e.target.value)}
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-text-primary">
            {(editors[host] || []).map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
          </select>
          <span className="text-text-secondary/50">→</span>
          <code className="text-accent font-mono text-xs">{editor?.path}{editor?.file}</code>
        </div>

        {loading ? <div className="text-text-secondary py-8 text-center">加载中...</div>
         : error ? <div className="text-red-400 py-8 text-center">错误: {error}</div>
         : <>
          <section className="mb-6">
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-text-primary">环境变量 ({envEntries.length})</h2>
                  {envFilter && <button onClick={() => setEnvFilter(null)} className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded">筛选: {envFilter} ×</button>}
                </div>
                <button onClick={() => { setShowAddEnv(true); setNewEnv({ key: '', value: '' }); }} className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"><Plus className="w-3 h-3" /> 添加</button>
              </div>
              {showAddEnv && (
                <div className="px-4 py-3 bg-bg-tertiary/50 border-b border-border">
                  <div className="flex gap-2 items-center">
                    <input type="text" placeholder="变量名" value={newEnv.key} onChange={e => setNewEnv(p => ({ ...p, key: e.target.value.toUpperCase() }))} className="w-48 bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-accent" autoFocus />
                    <span className="text-text-secondary">=</span>
                    <input type="text" placeholder="值" value={newEnv.value} onChange={e => setNewEnv(p => ({ ...p, value: e.target.value }))} className="flex-1 bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-text-primary" onKeyDown={e => e.key === 'Enter' && handleAddEnv()} />
                    <button onClick={handleAddEnv} className="px-3 py-1 bg-accent text-bg-primary rounded text-sm">添加</button>
                    <button onClick={() => setShowAddEnv(false)} className="px-2 py-1 text-text-secondary text-sm">取消</button>
                  </div>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto">
                {envEntries.length === 0 ? <div className="px-4 py-6 text-center text-text-secondary text-sm">暂无环境变量</div>
                 : envEntries.map(([key, value]) => (
                  <div key={key} className="px-4 py-2 border-b border-border/50 last:border-0 group hover:bg-bg-tertiary/30">
                    {editingEnv?.oldKey === key ? (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={editingEnv.key} onChange={e => setEditingEnv(p => ({ ...p, key: e.target.value.toUpperCase() }))} className="w-48 bg-bg-primary border border-accent rounded px-2 py-1 text-sm font-mono text-accent" autoFocus />
                        <span className="text-text-secondary">=</span>
                        <input type="text" value={editingEnv.value} onChange={e => setEditingEnv(p => ({ ...p, value: e.target.value }))} className="flex-1 bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-text-primary" onKeyDown={e => e.key === 'Enter' && handleApplySaveEnv()} />
                        <button onClick={handleApplySaveEnv} className="text-success"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditingEnv(null)} className="text-text-secondary"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <button onClick={() => setEnvFilter(envFilter === key ? null : key)} className={`font-mono text-sm w-48 truncate text-left ${envFilter === key ? 'text-warning' : 'text-accent hover:text-warning'}`}>{key}</button>
                        <span className="text-text-secondary">=</span>
                        <span className="font-mono text-text-primary text-sm truncate flex-1">{value}</span>
                        <button onClick={() => setEditingEnv({ oldKey: key, key, value })} className="p-1 text-text-secondary hover:text-accent opacity-0 group-hover:opacity-100"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteConfirm({ type: 'env', key })} className="p-1 text-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden flex" style={{ minHeight: '300px' }}>
              <div className="w-2/5 border-r border-border flex flex-col">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <h2 className="font-medium text-text-primary">模型 ({modelList.length})</h2>
                    <div className="flex gap-1 text-xs">
                      <button onClick={() => setModelFilter('all')} className={`px-2 py-0.5 rounded ${modelFilter === 'all' ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:text-text-primary'}`}>全部</button>
                      <button onClick={() => setModelFilter('openai')} className={`px-2 py-0.5 rounded ${modelFilter === 'openai' ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:text-text-primary'}`}>openai</button>
                      <button onClick={() => setModelFilter('anthropic')} className={`px-2 py-0.5 rounded ${modelFilter === 'anthropic' ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:text-text-primary'}`}>anthropic</button>
                    </div>
                  </div>
                  <button onClick={handleAddModel} className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"><Plus className="w-3 h-3" /> 添加</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {modelList.length === 0 ? <div className="px-4 py-6 text-center text-text-secondary text-sm">暂无模型</div>
                   : modelList.map(model => (
                    <div key={getModelKey(model)} onClick={() => setSelectedModel(model)}
                      className={`px-4 py-2 border-b border-border/50 last:border-0 cursor-pointer hover:bg-bg-tertiary/30 group flex items-center justify-between ${selectedModel?.id === model.id ? 'bg-accent/10' : ''}`}>
                      <div className="flex flex-col truncate">
                        <div className="flex items-center gap-1">
                          <span className="text-xs bg-bg-tertiary px-1 rounded text-text-secondary">{model.provider}</span>
                          <span className="font-mono text-sm truncate">{model.id}</span>
                        </div>
                        {model.name && model.name !== model.id && <span className="text-xs text-text-secondary truncate">{model.name}</span>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirm({ type: 'model', id: model.id }); }} className="p-1 text-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 flex flex-col">
                {editingModel ? (
                  <>
                    <div className="px-4 py-3 bg-bg-tertiary/50 border-b border-border flex-shrink-0"><h3 className="font-medium text-text-primary text-sm">编辑模型</h3></div>
                    <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs text-text-secondary mb-1">Provider</label>
                          <select
                            value={editingModel.provider || ''}
                            onChange={e => {
                              const prov = e.target.value;
                              setEditingModel(p => {
                                let baseUrl = p.baseUrl || '';
                                if (prov === 'openai') {
                                  if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
                                } else if (prov === 'anthropic') {
                                  baseUrl = baseUrl.replace(/\/v1\/?$/, '');
                                }
                                return { ...p, provider: prov, baseUrl };
                              });
                            }}
                            className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-text-primary">
                            <option value="">-- 选择 --</option>
                            <option value="openai">openai</option>
                            <option value="anthropic">anthropic</option>
                          </select>
                        </div>
                        <div><label className="block text-xs text-text-secondary mb-1">Model ID</label>
                          <input type="text" value={editingModel.id || ''}
                            onChange={handleEditingModelIdChange}
                            className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-text-primary" />
                        </div>
                      </div>
                      <div><label className="block text-xs text-text-secondary mb-1">名称</label><input type="text" value={editingModel.name || ''} onChange={e => setEditingModel(p => ({ ...p, name: e.target.value }))} className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-text-primary" /></div>
                      <div><label className="block text-xs text-text-secondary mb-1">Base URL</label><input type="text" value={editingModel.baseUrl || ''} onChange={e => setEditingModel(p => ({ ...p, baseUrl: e.target.value }))} className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-accent" /></div>
                      <div><label className="block text-xs text-text-secondary mb-1">环境变量 Key</label>
                        <select value={editingModel.envKey || ''} onChange={e => setEditingModel(p => ({ ...p, envKey: e.target.value }))} className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm font-mono text-warning">
                          <option value="">-- 选择环境变量 --</option>
                          {envEntries.map(([key]) => <option key={key} value={key}>{key}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button onClick={handleSaveModel} className="px-4 py-1.5 bg-accent text-bg-primary rounded text-sm font-medium">保存</button>
                        <button onClick={() => setEditingModel(null)} className="px-4 py-1.5 bg-bg-tertiary text-text-secondary rounded text-sm">取消</button>
                      </div>
                    </div>
                  </>
                ) : selectedModel ? (
                  <>
                    <div className="px-4 py-3 bg-bg-tertiary/50 border-b border-border flex items-center justify-between flex-shrink-0">
                      <h3 className="font-medium text-text-primary text-sm">模型详情</h3>
                      <button onClick={() => setEditingModel({ ...selectedModel, originalId: selectedModel.id })} className="text-xs text-accent hover:text-accent/80">编辑</button>
                    </div>
                    <div className="p-4 space-y-2 flex-1 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-text-secondary">Provider:</span> <span className="font-mono text-text-primary">{selectedModel.provider}</span></div>
                        <div><span className="text-text-secondary">ID:</span> <span className="font-mono text-text-primary">{selectedModel.id}</span></div>
                        <div className="col-span-2"><span className="text-text-secondary">名称:</span> <span className="font-mono text-text-primary">{selectedModel.name}</span></div>
                        <div className="col-span-2"><span className="text-text-secondary">API:</span> <span className="font-mono text-accent text-xs">{selectedModel.baseUrl}</span></div>
                        <div><span className="text-text-secondary">密钥:</span> <span className="font-mono text-warning">{selectedModel.envKey}</span></div>
                      </div>
                    </div>
                  </>
                ) : <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">点击左侧模型查看详情</div>}
              </div>
            </div>
          </section>
        </>}

        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-bg-secondary border border-border rounded-lg p-6 max-w-sm w-full mx-4">
              <h3 className="text-lg font-medium text-text-primary mb-2">确认删除</h3>
              <p className="text-text-secondary text-sm mb-4">{deleteConfirm.type === 'env' ? `确定要删除环境变量 "${deleteConfirm.key}" 吗？` : `确定要删除模型 "${deleteConfirm.id}" 吗？`}</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-bg-tertiary text-text-secondary rounded text-sm hover:bg-border">取消</button>
                <button onClick={() => { if (deleteConfirm.type === 'env') handleDeleteEnv(deleteConfirm.key); else handleDeleteModel(deleteConfirm.id); setDeleteConfirm(null); }} className="px-4 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600">删除</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
