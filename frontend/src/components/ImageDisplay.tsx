import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './ui/Button';
import { Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageViewerProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ images, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);

  const currentImage = images[currentIndex];
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setScale(1);
  }, [initialIndex]);

  const goToPrev = () => {
    if (canGoPrev) {
      setCurrentIndex(prev => prev - 1);
      setScale(1);
    }
  };

  const goToNext = () => {
    if (canGoNext) {
      setCurrentIndex(prev => prev + 1);
      setScale(1);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // 简单的固定步长缩放
    const step = 0.1;
    if (e.deltaY < 0) {
      // 向上滚轮 - 放大
      setScale(prev => Math.min(3, prev + step));
    } else {
      // 向下滚轮 - 缩小
      setScale(prev => Math.max(0.5, prev - step));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        goToPrev();
        break;
      case 'ArrowRight':
        goToNext();
        break;
      case '-':
    case '_':
        setScale(prev => Math.max(0.5, prev - 0.1));
        break;
      case '+':
      case '=':
        setScale(prev => Math.min(3, prev + 0.1));
        break;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* 图片计数器和操作提示 */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-4">
        {images.length > 1 && (
          <div className="px-4 py-2 bg-white bg-opacity-10 rounded-full">
            <span className="text-white text-sm">
              {currentIndex + 1} / {images.length}
            </span>
          </div>
        )}
        <div className="px-3 py-1 bg-white bg-opacity-5 rounded text-xs text-white">
          滚轮缩放 • 左右切换 • ESC 退出
        </div>
      </div>

      {/* 主图片区域 */}
      <div
        className="relative max-w-full max-h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={currentImage}
          alt={`Image ${currentIndex + 1}`}
          draggable={false}
          onDragEnd={(e: React.DragEvent) => {
            const threshold = 100;
            const dragEndX = e.clientX;
            const dragStartX = e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2;
            const offset = dragStartX - dragEndX;

            if (Math.abs(offset) > threshold) {
              if (offset > 0) {
                goToNext(); // 向左拖拽，下一张
              } else {
                goToPrev(); // 向右拖拽，上一张
              }
            }
          }}
          style={{
            cursor: scale > 1 ? 'grab' : 'pointer',
            maxWidth: '90vw',
            maxHeight: '90vh',
            transform: `scale(${scale})`,
            transition: scale === 1 ? 'none' : 'transform 0.1s',
          }}
          className="rounded-lg shadow-2xl select-none"
        />
      </div>

      {/* 左右导航按钮 */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goToPrev(); }}
            disabled={!canGoPrev}
            className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all ${
              !canGoPrev ? 'opacity-30 cursor-not-allowed' : ''
            }`}
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goToNext(); }}
            disabled={!canGoNext}
            className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all ${
              !canGoNext ? 'opacity-30 cursor-not-allowed' : ''
            }`}
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        </>
      )}

      {/* 缩放控制 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-white bg-opacity-10 rounded-full px-4 py-2">
        <button
          onClick={(e) => { e.stopPropagation(); setScale(prev => Math.max(0.5, prev - 0.2)); }}
          className="p-1 rounded hover:bg-white hover:bg-opacity-10 transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4 text-white" />
        </button>
        <span className="text-white text-sm min-w-[3rem] text-center font-mono">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setScale(prev => Math.min(3, prev + 0.2)); }}
          className="p-1 rounded hover:bg-white hover:bg-opacity-10 transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4 text-white" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setScale(1); }}
          className="ml-2 px-2 py-1 text-xs text-white bg-white bg-opacity-10 rounded hover:bg-opacity-20 transition-colors"
        >
          100%
        </button>
      </div>

      {/* 缩略图导航 */}
      {images.length > 1 && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex space-x-2">
          {images.map((img, index) => (
            <button
              key={img}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex(index); setScale(1); }}
              className={`w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                index === currentIndex
                  ? 'border-white scale-110'
                  : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={img}
                alt={`Thumbnail ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export const ImageDisplay: React.FC = () => {
  const { currentImage, allImages, isGenerating } = useAppStore();
  const [viewerOpen, setViewerOpen] = useState(false);

  console.log('ImageDisplay组件渲染 - currentImage:', currentImage?.substring(0, 50) + '...' || 'null');
  console.log('ImageDisplay组件渲染 - allImages数量:', allImages.length);

  const currentIndex = currentImage ? allImages.indexOf(currentImage) : 0;

  const downloadImage = () => {
    if (currentImage) {
      const link = document.createElement('a');
      link.href = currentImage;
      link.download = `nano-banana-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const openViewer = () => {
    setViewerOpen(true);
  };

  return (
    <>
      <div className="flex-1 relative bg-gray-900">
        <div className="w-full h-full flex items-center justify-center p-8">
          {currentImage ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              {/* 图片预览 */}
              <motion.img
                src={currentImage}
                alt="Generated Image"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                onClick={openViewer}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="max-w-full max-h-full object-contain rounded-lg border border-gray-700 shadow-lg cursor-pointer"
                style={{ maxHeight: '70vh' }}
              />

              {/* 点击提示 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
                  点击查看大图
                </div>
              </motion.div>

              {/* 图片信息 */}
              <div className="mt-4 text-center text-gray-400 text-sm">
                {allImages.length > 1
                  ? `${currentIndex + 1} / ${allImages.length} • 点击查看大图，支持手势切换`
                  : '点击查看大图'
                }
              </div>

              {/* 缩略图指示器 */}
              {allImages.length > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex space-x-2 mt-4"
                >
                  {allImages.map((url, index) => (
                    <motion.img
                      key={url}
                      src={url}
                      alt={`Thumbnail ${index + 1}`}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{
                        scale: index === currentIndex ? 1.1 : 1,
                        opacity: index === currentIndex ? 1 : 0.6,
                      }}
                      whileHover={{ scale: 1.2 }}
                      onClick={() => {
                        const { setCurrentImage } = useAppStore.getState();
                        setCurrentImage(allImages[index]);
                      }}
                      className="w-12 h-12 object-cover rounded cursor-pointer border-2 transition-all"
                      style={{
                        borderColor: index === currentIndex ? '#3b82f6' : '#4b5563',
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center"
            >
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🖼️</div>
              <div style={{ color: '#9ca3af', fontSize: '1.2rem', marginBottom: '0.5rem' }}>
                暂无图片
              </div>
              <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                点击历史记录中的图片显示在这里
              </div>
            </motion.div>
          )}
        </div>

        {/* 工具栏 */}
        {currentImage && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="absolute bottom-4 left-4 bg-gray-800 border border-gray-700 rounded-lg p-2 flex items-center space-x-2"
          >
            <Button
              onClick={downloadImage}
              disabled={isGenerating}
              size="sm"
              variant="ghost"
              className="h-8 w-8"
              title="下载图片"
            >
              <Download className="h-4 w-4" />
            </Button>
          </motion.div>
        )}

        {/* 生成中的遮罩 */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40"
          >
            <div className="bg-gray-800 p-6 rounded-lg text-center border border-gray-700">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <div className="text-gray-300">正在生成图片...</div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 图片查看器 */}
      <AnimatePresence>
        {viewerOpen && allImages.length > 0 && (
          <ImageViewer
            images={allImages}
            initialIndex={currentIndex}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};