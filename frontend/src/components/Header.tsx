import React from 'react';
import { Settings, ExternalLink } from 'lucide-react';
import { ProxySubscriptionsModal } from './ProxySubscriptionsModal';

export const Header: React.FC = () => {
  const [showProxyModal, setShowProxyModal] = React.useState(false);

  return (
    <>
      <header className="h-16 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-6">
        <div className="flex items-center space-x-4">
          <a
            href="https://github.com/MonchiLin/vertex-nano-banana-unlimited"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 group cursor-pointer"
            title="访问 GitHub 仓库"
          >
            <div className="text-2xl">🍌</div>
            <h1 className="text-xl font-semibold text-gray-100 group-hover:text-gray-200 transition-colors">
              Vertex Nano Banana Unlimited
            </h1>
            <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-gray-300 transition-colors" />
          </a>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowProxyModal(true)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-700 hover:bg-gray-850"
          >
            <Settings size={16} />
            订阅配置
          </button>
        </div>
      </header>

      <ProxySubscriptionsModal open={showProxyModal} onClose={() => setShowProxyModal(false)} />
    </>
  );
};
