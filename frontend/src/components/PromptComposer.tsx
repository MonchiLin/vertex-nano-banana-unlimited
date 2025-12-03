import React, { useState, useRef } from 'react';
import { Textarea } from './ui/Textarea';
import { Button } from './ui/Button';
import { useAppStore } from '../store/useAppStore';
import { useImageGeneration } from '../hooks/useImageGeneration';
import { Upload, HelpCircle, RotateCcw } from 'lucide-react';
import { PromptHints } from './PromptHints';
import { cn } from '../utils/cn';
import { blobToBase64 } from '../utils/imageUtils';

export const PromptComposer: React.FC = () => {
  const {
    currentPrompt,
    setCurrentPrompt,
    temperature,
    setTemperature,
    resolution,
    setResolution,
    scenarioCount,
    setScenarioCount,
    isGenerating,
    uploadedImages,
    addUploadedImage,
    removeUploadedImage,
    clearUploadedImages,
    currentImage,
    setCurrentImage,
    showPromptPanel,
    setShowPromptPanel,
  } = useAppStore();

  const { generate } = useImageGeneration();
  const [showHintsModal, setShowHintsModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!currentPrompt.trim() || isGenerating) return;

    // 将 blob URL 转换为 base64 字符串
    let referenceImages: string[] | undefined;
    if (uploadedImages.length > 0) {
      try {
        referenceImages = await Promise.all(
          uploadedImages.map(async (imageUrl) => {
            // 如果是 blob URL，转换为 base64
            if (imageUrl.startsWith('blob:')) {
              const response = await fetch(imageUrl);
              const blob = await response.blob();
              return await blobToBase64(blob);
            }
            // 如果已经是 base64 或其他格式，直接返回
            return imageUrl;
          })
        );
      } catch (error) {
        console.error('图片转换失败:', error);
        alert('图片处理失败，请重试');
        return;
      }
    }

    generate({
      prompt: currentPrompt,
      referenceImages,  // ✅ 使用正确的字段名和数据格式
      temperature,
      resolution,
      scenarioCount,
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    // 只处理第一个文件
    const file = files[0];
    if (file && file.type.startsWith('image/')) {
      // 清空之前的图片，只保留新的
      clearUploadedImages();
      // 创建临时 URL，避免大文件转换为 base64
      const imageUrl = URL.createObjectURL(file);
      addUploadedImage(imageUrl);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClearSession = () => {
    setCurrentPrompt('');
    setTemperature(1.0);
    setResolution('4K');
    setScenarioCount(1);
    clearUploadedImages();
    setCurrentImage(null);
  };

  if (!showPromptPanel) {
    return (
      <div className="w-8 bg-gray-950 border-r border-gray-800 flex flex-col items-center justify-center">
        <button
          onClick={() => setShowPromptPanel(true)}
          className="w-6 h-16 bg-gray-800 hover:bg-gray-700 rounded-r-lg border border-l-0 border-gray-700 flex items-center justify-center transition-colors group"
          title="显示提示面板"
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
    <>
      <div className="w-80 lg:w-72 xl:w-80 h-full bg-gray-950 border-r border-gray-800 p-6 flex flex-col space-y-6 overflow-y-auto">
        <div className={"flex flex-row justify-between"}>
            <span>🔮生成图片</span>
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowHintsModal(true)}
              className="h-6 w-6"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearSession}
              className="h-6 w-6"
              title="清除会话"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPromptPanel(false)}
              className="h-6 w-6"
              title="隐藏提示面板"
            >
              ×
            </Button>
          </div>
        </div>

        {/* File Upload */}
        <div>
          <div className="mb-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-gray-400">参考图片</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                                className="text-xs"
              >
                <Upload className="h-3 w-3 mr-1" />
                {uploadedImages.length > 0 ? '替换' : '上传'}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* Image Preview */}
          <div className="space-y-2">
            {uploadedImages.length > 0 ? (
              <div className="relative w-full h-32 rounded-lg overflow-hidden border border-gray-700">
                <img
                  src={uploadedImages[0]}
                  alt="上传的参考图片"
                  className="w-full h-full object-contain bg-gray-900"
                />
                <button
                  onClick={() => removeUploadedImage(0)}
                  className="absolute top-2 right-2 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white text-xs transition-colors"
                  title="删除图片"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 border-2 border-dashed border-gray-700 hover:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-500 hover:text-gray-400 transition-colors"
              >
                <Upload className="h-6 w-6 mb-2" />
                <span className="text-sm">点击上传参考图片</span>
                <span className="text-xs text-gray-600 mt-1">支持 PNG、JPG 等格式</span>
              </button>
            )}
            {uploadedImages.length > 0 && (
              <div className="text-xs text-gray-500">
                已上传 1 张参考图片
              </div>
            )}
          </div>
        </div>

        {/* Prompt Input */}
        <div className="flex-1 flex flex-col">
          <Textarea
            value={currentPrompt}
            onChange={(e) => setCurrentPrompt(e.target.value)}
            placeholder="描述你想要生成的图片..."
            className="flex-1 resize-none text-sm"
            disabled={isGenerating}
          />
          <div className="mt-2 text-xs text-gray-500">
            {currentPrompt.length}/500 字符
          </div>
        </div>

        {/* Parameters */}
        <div className="space-y-4">
          {/* Temperature */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              创意度: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
              disabled={isGenerating}
            />
          </div>

          {/* Resolution */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">分辨率</label>
            <div className="grid grid-cols-3 gap-2">
              {['1K', '2K', '4K'].map((res) => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className={cn(
                    'px-3 py-1 rounded text-xs transition-colors',
                    resolution === res
                      ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/50'
                      : 'bg-gray-900 text-gray-400 border border-gray-700 hover:bg-gray-800'
                  )}
                  disabled={isGenerating}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          {/* Scenario Count */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              并发场景: {scenarioCount}
            </label>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              value={scenarioCount}
              onChange={(e) => setScenarioCount(parseInt(e.target.value))}
              className="w-full"
              disabled={isGenerating}
            />
          </div>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={!currentPrompt.trim() || isGenerating}
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              生成中...
            </>
          ) : (
            <>
              <span className="mr-2">✨</span>
              生成图片
            </>
          )}
        </Button>

        </div>

      {/* Hints Modal */}
      <PromptHints
        open={showHintsModal}
        onOpenChange={(open) => setShowHintsModal(open)}
      />
    </>
  );
};