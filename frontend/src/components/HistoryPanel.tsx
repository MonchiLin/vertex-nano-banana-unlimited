import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { History, Download, Image as ImageIcon, Folder, Clock, RotateCcw } from 'lucide-react';
import { cn } from '../utils/cn';

// 后端接口类型定义
interface GalleryFile {
  name: string;
  url: string;
  size: number;
  modTime: string;
}

interface GalleryFolder {
  name: string;
  count: number;
  latest: string;
}

export const HistoryPanel: React.FC = () => {
  const {
    currentProject,
    currentImage,
    selectedGenerationId,
    selectGeneration,
    showHistory,
    setShowHistory,
    setCurrentImage,
    setAllImages
  } = useAppStore();

  // 标签页状态
  const [activeTab, setActiveTab] = React.useState<'session' | 'gallery'>('session');

  // 历史库数据状态
  const [galleryFolders, setGalleryFolders] = React.useState<GalleryFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [galleryFiles, setGalleryFiles] = React.useState<GalleryFile[]>([]);
  const [loadingGallery, setLoadingGallery] = React.useState(false);

  
  const generations = currentProject?.generations || [];

  // 收集所有图片URL用于轮播 - 包含历史库文件夹中的所有图片
  React.useEffect(() => {
    const images: string[] = [];

    // 收集当前会话的生成图片
    generations.forEach(gen => {
      gen.outputAssets.forEach(asset => {
        if (asset.url) images.push(asset.url);
      });
    });

    // 收集历史库文件夹中的所有图片
    // 通过 currentImage 的路径推断文件夹，然后收集该文件夹的所有图片
    if (currentImage) {
      // 从 currentImage 中提取文件夹路径
      const urlMatch = currentImage.match(/\/tmp\/([^\/]+)\//);
      if (urlMatch) {
        const folderPath = urlMatch[0]; // 例如: /tmp/text-only-1764760975/

        // 收集所有来自同一文件夹的图片
        generations.forEach(gen => {
          gen.outputAssets.forEach(asset => {
            if (asset.url && asset.url.includes(folderPath)) {
              if (!images.includes(asset.url)) {
                images.push(asset.url);
              }
            }
          });
        });

        // 同时收集 galleryFiles 中同一文件夹的图片
        galleryFiles.forEach(file => {
          const fileUrl = `http://localhost:8080${file.url}`;
          if (fileUrl.includes(folderPath) && !images.includes(fileUrl)) {
            images.push(fileUrl);
          }
        });
      } else {
        // 如果无法提取文件夹，至少添加当前图片
        if (!images.includes(currentImage)) {
          images.push(currentImage);
        }
      }
    }

    setAllImages(images);
    console.log('收集到的所有图片数量:', images.length);
    console.log('收集到的图片URLs:', images.map(url => url.split('/').pop())); // 只显示文件名
  }, [generations.length, currentImage, galleryFiles.length]); // 添加 galleryFiles 依赖

  // 获取历史库文件夹列表
  const fetchGalleryFolders = React.useCallback(async () => {
    setLoadingGallery(true);
    try {
      const response = await fetch('http://localhost:8080/gallery');
      const data = await response.json();
      setGalleryFolders(data.folders || []);
    } catch (error) {
      console.error('获取历史库失败:', error);
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  // 导出刷新函数供外部调用
  React.useEffect(() => {
    // 将刷新函数暴露到全局，供其他组件调用
    (window as any).refreshGallery = fetchGalleryFolders;
    return () => {
      delete (window as any).refreshGallery;
    };
  }, [fetchGalleryFolders]);

  // 获取指定文件夹的文件列表
  const fetchGalleryFiles = React.useCallback(async (folderName: string) => {
    setLoadingGallery(true);
    try {
      const response = await fetch(`http://localhost:8080/gallery/files?folder=${encodeURIComponent(folderName)}`);
      const data = await response.json();
      setGalleryFiles(data.files || []);
    } catch (error) {
      console.error('获取文件列表失败:', error);
      setGalleryFiles([]);
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  // 切换到历史库标签页时自动加载数据
  React.useEffect(() => {
    if (activeTab === 'gallery' && galleryFolders.length === 0) {
      fetchGalleryFolders();
    }
  }, [activeTab, galleryFolders.length, fetchGalleryFolders]);

  // Get current image dimensions
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    if (currentImage) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
      };
      img.src = currentImage;
    } else {
      setImageDimensions(null);
    }
  }, [currentImage]);

  if (!showHistory) {
    return (
      <div className="w-8 bg-gray-950 border-l border-gray-800 flex flex-col items-center justify-center">
        <button
          onClick={() => setShowHistory(true)}
          className="w-6 h-16 bg-gray-800 hover:bg-gray-700 rounded-l-lg border border-r-0 border-gray-700 flex items-center justify-center transition-colors group"
          title="显示历史面板"
        >
          <div className="flex flex-col space-y-1">
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-gray-950 border-l border-gray-800 p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="h-5 w-5 text-gray-400" />
            <h3 className="text-sm font-medium text-gray-300">历史记录与变体</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowHistory(!showHistory)}
            className="h-6 w-6"
            title="隐藏历史面板"
          >
            ×
          </Button>
        </div>

        {/* 标签页切换 */}
        <div className="flex bg-gray-900 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('session')}
            className={cn(
              'flex-1 flex items-center justify-center space-x-2 px-3 py-2 rounded-md text-xs font-medium transition-colors',
              activeTab === 'session'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <Clock className="h-3 w-3" />
            <span>当前会话</span>
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={cn(
              'flex-1 flex items-center justify-center space-x-2 px-3 py-2 rounded-md text-xs font-medium transition-colors',
              activeTab === 'gallery'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <Folder className="h-3 w-3" />
            <span>历史库</span>
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      {activeTab === 'session' ? (
        /* 当前会话内容 */
        <div className="mb-6 flex-shrink-0">
          <h4 className="text-xs font-medium text-gray-400 mb-3">当前变体</h4>
          {generations.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🖼️</div>
              <p className="text-sm text-gray-500">还没有生成图片</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {generations.slice(-2).map((generation, genIndex) => (
                <div
                  key={generation.id}
                  className={cn(
                    'relative rounded-lg border-2 cursor-pointer transition-all duration-200 overflow-hidden',
                    selectedGenerationId === generation.id
                      ? 'border-yellow-400'
                      : 'border-gray-700 hover:border-gray-600'
                  )}
                  onClick={() => {
                    selectGeneration(generation.id);
                    if (generation.outputAssets[0]) {
                      setCurrentImage(generation.outputAssets[0].url);
                    }
                  }}
                >
                  <div className="aspect-square relative">
                    {generation.outputAssets.length > 0 ? (
                      <>
                        {/* 主图片 */}
                        <img
                          src={generation.outputAssets[0].url}
                          alt="生成的变体"
                          className="w-full h-full object-cover"
                        />

                        {/* 多图片指示器 */}
                        {generation.outputAssets.length > 1 && (
                          <div className="absolute top-2 right-2 bg-yellow-400/90 text-gray-900 text-xs font-bold px-2 py-1 rounded-full">
                            +{generation.outputAssets.length - 1}
                          </div>
                        )}

                        {/* 小缩略图网格（如果有多个） */}
                        {generation.outputAssets.length > 1 && (
                          <div className="absolute bottom-2 right-2 flex gap-1">
                            {generation.outputAssets.slice(1, 3).map((asset, idx) => (
                              <img
                                key={asset.id}
                                src={asset.url}
                                alt={`变体${idx + 2}`}
                                className="w-8 h-8 object-cover rounded border border-gray-300"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCurrentImage(asset.url);
                                }}
                              />
                            ))}
                            {generation.outputAssets.length > 3 && (
                              <div className="w-8 h-8 bg-gray-800/90 rounded border border-gray-300 flex items-center justify-center text-xs text-gray-300">
                                +{generation.outputAssets.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400" />
                      </div>
                    )}
                  </div>

                  {/* Variant Number and Image Count */}
                  <div className="p-2 bg-gray-900/90">
                    <div className="text-xs text-gray-300">
                      #{genIndex + 1} 生成
                      {generation.outputAssets.length > 1 && (
                        <span className="ml-1 text-yellow-400">
                          ({generation.outputAssets.length}张)
                        </span>
                      )}
                    </div>
                    {generation.metadata?.proxyTags && generation.metadata.proxyTags.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {generation.metadata.proxyTags.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 历史库内容 */
        <div className="mb-6 flex-shrink-0">
          {!selectedFolder ? (
            /* 显示文件夹列表 */
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-gray-400">
                  历史文件夹 {galleryFolders.length > 0 && `(${galleryFolders.length})`}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchGalleryFolders}
                  disabled={loadingGallery}
                  className="text-xs text-gray-400 hover:text-gray-300 h-6 w-6 p-0"
                  title="刷新历史库"
                >
                  <RotateCcw className={`h-3 w-3 ${loadingGallery ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              {loadingGallery ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400 mx-auto mb-2"></div>
                  <p className="text-sm text-gray-500">加载中...</p>
                </div>
              ) : galleryFolders.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📁</div>
                  <p className="text-sm text-gray-500">还没有历史记录</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {galleryFolders.map((folder) => (
                    <button
                      key={folder.name}
                      onClick={() => {
                        setSelectedFolder(folder.name);
                        fetchGalleryFiles(folder.name);
                      }}
                      className="w-full bg-gray-900 hover:bg-gray-800 rounded-lg p-3 text-left transition-colors border border-gray-700 hover:border-gray-600"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Folder className="h-4 w-4 text-gray-400" />
                          <div>
                            <div className="text-sm text-gray-300 font-medium truncate max-w-[180px]">
                              {folder.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {folder.count} 个文件
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(folder.latest).toLocaleDateString()}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 显示文件列表 */
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-gray-400">
                  {selectedFolder} ({galleryFiles.length} 张图片)
                </h4>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectedFolder && fetchGalleryFiles(selectedFolder)}
                    disabled={loadingGallery}
                    className="text-xs text-gray-400 hover:text-gray-300 h-6 w-6 p-0"
                    title="刷新文件列表"
                  >
                    <RotateCcw className={`h-3 w-3 ${loadingGallery ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedFolder(null);
                      setGalleryFiles([]);
                    }}
                    className="text-xs"
                  >
                    ← 返回
                  </Button>
                </div>
              </div>

              {loadingGallery ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400 mx-auto mb-2"></div>
                  <p className="text-sm text-gray-500">加载中...</p>
                </div>
              ) : galleryFiles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">该文件夹为空</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {galleryFiles.map((file, index) => (
                    <button
                      key={file.name}
                      onClick={() => {
                        const imageUrl = `http://localhost:8080${file.url}`;
                        setCurrentImage(imageUrl);
                      }}
                      className="relative aspect-square rounded border border-gray-700 hover:border-gray-600 transition-colors overflow-hidden group"
                    >
                      <img
                        src={`http://localhost:8080${file.url}`}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gray-900/80 text-xs px-1 py-0.5 text-gray-300 truncate">
                        {file.name}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Current Image Info */}
      {(currentImage || imageDimensions) && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
          <h4 className="text-xs font-medium text-gray-400 mb-2">当前图片</h4>
          <div className="space-y-1 text-xs text-gray-500">
            {imageDimensions && (
              <div className="flex justify-between">
                <span>尺寸：</span>
                <span className="text-gray-300">{imageDimensions.width} × {imageDimensions.height}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generation Details */}
      <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700 flex-1 overflow-y-auto min-h-0">
        <h4 className="text-xs font-medium text-gray-400 mb-2">生成详情</h4>
        {(() => {
          const gen = generations.find(g => g.id === selectedGenerationId);

          if (gen) {
            return (
              <div className="space-y-3">
                <div className="space-y-2 text-xs text-gray-500">
                  <div>
                    <span className="text-gray-400">提示词：</span>
                    <p className="text-gray-300 mt-1">{gen.prompt}</p>
                  </div>
                  <div className="flex justify-between">
                    <span>模型：</span>
                    <span>{gen.modelVersion}</span>
                  </div>
                </div>

                {/* Generated Images Gallery */}
                {gen.outputAssets.length > 1 && (
                  <div>
                    <h5 className="text-xs font-medium text-gray-400 mb-2">
                      生成结果 ({gen.outputAssets.length}张)
                    </h5>
                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                      {gen.outputAssets.map((asset, index) => (
                        <button
                          key={asset.id}
                          onClick={() => {
                            setCanvasImage(asset.url);
                          }}
                          className={cn(
                            'relative aspect-square rounded border transition-colors overflow-hidden group',
                            currentImage === asset.url
                              ? 'border-yellow-400 ring-2 ring-yellow-400/50'
                              : 'border-gray-700 hover:border-gray-600'
                          )}
                        >
                          <img
                            src={asset.url}
                            alt={`生成图片 ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ImageIcon className="h-3 w-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-gray-900/80 text-xs px-1 py-0.5 text-gray-300 flex justify-between items-center">
                            <span>#{asset.metadata?.scenarioIndex ? asset.metadata.scenarioIndex + 1 : index + 1}</span>
                            {asset.metadata?.proxyTag && (
                              <span className="text-blue-400 truncate max-w-[60%]" title={asset.metadata.proxyTag}>
                                {asset.metadata.proxyTag}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reference Images */}
                {gen.sourceAssets.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-gray-400 mb-2">参考图片</h5>
                    <div className="grid grid-cols-2 gap-2">
                      {gen.sourceAssets.map((asset, index) => (
                        <button
                          key={asset.id}
                          onClick={() => setCanvasImage(asset.url)}
                          className="relative aspect-square rounded border border-gray-700 hover:border-gray-600 transition-colors overflow-hidden group"
                        >
                          <img
                            src={asset.url}
                            alt={`参考 ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="absolute bottom-1 left-1 bg-gray-900/80 text-xs px-1 py-0.5 rounded text-gray-300">
                            参考 {index + 1}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          } else {
            return (
              <div className="space-y-2 text-xs text-gray-500">
                <p className="text-gray-400">选择一个生成记录查看详情</p>
              </div>
            );
          }
        })()}
      </div>

      {/* Actions */}
      <div className="space-y-3 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            let imageUrl: string | null = null;

            if (selectedGenerationId) {
              const gen = generations.find(g => g.id === selectedGenerationId);
              imageUrl = gen?.outputAssets[0]?.url || null;
            } else {
              const { currentImage } = useAppStore.getState();
              imageUrl = currentImage;
            }

            if (imageUrl) {
              if (imageUrl.startsWith('data:')) {
                const link = document.createElement('a');
                link.href = imageUrl;
                link.download = `nano-banana-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              } else {
                fetch(imageUrl)
                  .then(response => response.blob())
                  .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `nano-banana-${Date.now()}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  });
              }
            }
          }}
          disabled={!selectedGenerationId && !useAppStore.getState().currentImage}
        >
          <Download className="h-4 w-4 mr-2" />
          下载
        </Button>
      </div>

    </div>
  );
};