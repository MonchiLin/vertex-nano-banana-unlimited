import React from 'react';
import { X, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { goBackendService, ProxySubscriptionsResponse } from '../services/goBackendService';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const ProxySubscriptionsModal: React.FC<Props> = ({ open, onClose }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [storedText, setStoredText] = React.useState('');
  const [effective, setEffective] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const data: ProxySubscriptionsResponse = await goBackendService.getProxySubscriptions();
      const stored = data.storedSubscriptions || data.subscriptions || [];
      setStoredText(stored.join('\n'));
      setEffective(data.effective || stored);
    } catch (e: any) {
      setError(e?.message || '加载订阅失败');
    } finally {
      setLoading(false);
    }
  }, [open]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleAddLine = () => {
    setStoredText(prev => (prev.trim() ? prev + '\n' : '') + 'https://');
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const urls = Array.from(
        new Set(
          storedText
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean),
        ),
      );
      const saved = await goBackendService.replaceProxySubscriptions(urls);
      setStoredText(saved.join('\n'));
      const data = await goBackendService.getProxySubscriptions();
      setEffective(data.effective || saved);
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLine = (idx: number) => {
    const lines = storedText.split('\n');
    lines.splice(idx, 1);
    setStoredText(lines.filter(Boolean).join('\n'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-gray-950 border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">代理订阅</h2>
            <p className="text-sm text-gray-400">增删改查存储订阅链接（环境变量订阅不回显）</p>
          </div>
          <button
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-300"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500"
              onClick={handleSave}
              disabled={loading}
            >
              <Save size={16} />
              保存
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700"
              onClick={handleAddLine}
              disabled={loading}
            >
              <Plus size={16} />
              新增一行
            </button>
            {loading && <span className="text-sm text-gray-400">处理中…</span>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium text-gray-200">
              <span>存储订阅（可编辑）</span>
              <span className="text-gray-500 text-xs">一行一条</span>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-800">
                {storedText.split('\n').filter((_, i) => true).map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2">
                    <input
                      className="flex-1 bg-transparent text-sm text-gray-100 outline-none"
                      value={line}
                      onChange={e => {
                        const lines = storedText.split('\n');
                        lines[idx] = e.target.value;
                        setStoredText(lines.join('\n'));
                      }}
                      placeholder="https://example.com/sub"
                    />
                    <button
                      className="p-1 text-gray-400 hover:text-red-400"
                      onClick={() => handleDeleteLine(idx)}
                      aria-label="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {storedText.trim() === '' && (
                  <div className="px-3 py-2 text-sm text-gray-500">暂无订阅，点击“新增一行”开始添加。</div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-200">生效列表</div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm text-gray-200 space-y-1">
              {effective.length === 0 && <div className="text-gray-500">暂无订阅</div>}
              {effective.map((u, idx) => (
                <div key={idx} className="break-all">{u}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
