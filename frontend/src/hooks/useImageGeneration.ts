import { useMutation } from '@tanstack/react-query';
import { geminiService, GenerationRequest, EditRequest } from '../services/geminiService';
import { useAppStore } from '../store/useAppStore';
import { generateId } from '../utils/imageUtils';
import { Generation, Edit, Asset } from '../types';

export const useImageGeneration = () => {
  const {
    addGeneration,
    setIsGenerating,
    setCanvasImage,
    setCurrentProject,
    currentProject,
    setProxyStatus  // 假设这个状态已添加到store中
  } = useAppStore();

  const generateMutation = useMutation({
    mutationFn: async (request: GenerationRequest) => {
      // 验证请求参数
      if (!request.prompt?.trim()) {
        throw new Error('Prompt cannot be empty');
      }

      try {
        const images = await geminiService.generateImage(request);
        return { images, request };
      } catch (error) {
        // 重新抛出错误以便上层处理
        throw error;
      }
    },
    onMutate: () => {
      setIsGenerating(true);
    },
    onSuccess: ({ images, request }) => {
      console.log('🎨 处理Go后端返回的图片数据:', { imageCount: images?.length, request });

      // 检查是否有有效的图片数据
      if (!images || !Array.isArray(images)) {
        console.warn('⚠️ Go后端未返回有效的图片数据');
        setIsGenerating(false);
        return;
      }

      if (images.length === 0) {
        console.warn('⚠️ 没有成功生成的图片（可能是网络问题）');
        setIsGenerating(false);
        // 显示用户友好的错误提示
        alert('图片生成失败，可能是网络连接问题。请检查代理设置或稍后重试。');
        return;
      }

      // 验证并过滤有效图片数据
      const validImages = images.filter(imgData =>
        imgData &&
        (typeof imgData === 'string') &&
        imgData.length > 0
      );

      if (validImages.length === 0) {
        console.warn('⚠️ 未找到有效的图片数据');
        return;
      }

      console.log(`✅ 找到 ${validImages.length} 张有效图片`);

      const outputAssets: Asset[] = validImages.map((imageData, index) => {
        try {
          // 处理Go后端返回的不同格式数据
          let url: string;
          let checksum: string;
          const width = 1024;
          const height = 1024;

          if (imageData.startsWith('http')) {
            // 完整的URL（来自Go后端）
            url = imageData;
            checksum = imageData.slice(0, 32);
          } else if (imageData.startsWith('data:')) {
            // Base64数据
            url = imageData;
            const base64Data = imageData.split(',')[1];
            checksum = base64Data ? base64Data.slice(0, 32) : imageData.slice(0, 32);
          } else if (imageData.startsWith('/')) {
            // 相对路径（Go后端本地文件）
            url = imageData;
            checksum = imageData.slice(0, 32);
          } else {
            // 其他格式，直接使用
            url = imageData;
            checksum = imageData.slice(0, 32);
          }

          return {
            id: generateId(),
            type: 'output',
            url,
            mime: 'image/png',
            width,
            height,
            checksum,
            metadata: {
              scenarioIndex: index,
              totalScenarios: validImages.length,
              backend: 'go-playwright'
            }
          };
        } catch (error) {
          console.error(`❌ 处理图片 ${index} 时出错:`, error);
          return null;
        }
      }).filter(asset => asset !== null);

      // 检查是否有有效的输出资源
      if (outputAssets.length === 0) {
        console.warn('⚠️ 未创建有效的输出资源');
        setIsGenerating(false);
        return;
      }

      // 增强的Generation对象，支持Go后端特性
      const generation: Generation = {
        id: generateId(),
        prompt: request.prompt,
        parameters: {
          aspectRatio: '1:1',
          temperature: request.temperature,
          scenarioCount: request.scenarioCount, // Go后端并发场景数
          resolution: request.resolution,       // Go后端分辨率设置
          backendType: 'go-playwright'          // 标识后端类型
        },
        sourceAssets: request.referenceImages && request.referenceImages.length > 0 ? request.referenceImages.map((img, index) => ({
          id: generateId(),
          type: 'original' as const,
          url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
          mime: 'image/png',
          width: 1024,
          height: 1024,
          checksum: img.slice(0, 32),
          metadata: {
            referenceIndex: index,
            totalReferences: request.referenceImages.length
          }
        })) : [],
        outputAssets,
        modelVersion: 'go-vertex-ai-playwright',  // 标识Go后端模型
        timestamp: Date.now(),
        metadata: {
          backendUrl: 'http://localhost:8080',
          generationType: request.scenarioCount && request.scenarioCount > 1 ? 'concurrent' : 'single',
          successRate: `${outputAssets.length}/${request.scenarioCount || 1}`
        }
      };

      console.log('📝 创建Generation记录:', generation);

      addGeneration(generation);
      setCanvasImage(outputAssets[0].url);

      // 更新代理状态（如果Go后端提供）
      if (setProxyStatus) {
        // 尝试获取代理状态
        geminiService.getProxyStatus().then(proxyStatus => {
          if (proxyStatus.length > 0) {
            console.log('🌐 更新代理状态:', proxyStatus);
            setProxyStatus(proxyStatus);
          }
        }).catch(error => {
          console.warn('⚠️ 获取代理状态失败:', error);
        });
      }

      // Create project if none exists
      if (!currentProject) {
        const newProject = {
          id: generateId(),
          title: 'Untitled Project',
          generations: [generation],
          edits: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        setCurrentProject(newProject);
        console.log('📁 创建新项目:', newProject.title);
      }

      setIsGenerating(false);
      console.log('✅ 图片生成流程完成');

      // 自动刷新历史库
      setTimeout(() => {
        if ((window as any).refreshGallery) {
          (window as any).refreshGallery();
        }
      }, 1000); // 延迟1秒刷新，确保后端文件已保存
    },
    onError: (error) => {
      console.error('Generation failed:', error);
      setIsGenerating(false);
    }
  });

  return {
    generate: generateMutation.mutate,
    isGenerating: generateMutation.isPending,
    error: generateMutation.error
  };
};

export const useImageEditing = () => {
  const {
    addEdit,
    setIsGenerating,
    setCanvasImage,
    canvasImage,
    uploadedImages,
    editReferenceImages,
    brushStrokes,
    selectedGenerationId,
    currentProject,
    temperature
  } = useAppStore();

  const editMutation = useMutation({
    mutationFn: async (instruction: string) => {
      // Always use canvas image as primary target if available, otherwise use first uploaded image
      const sourceImage = canvasImage || uploadedImages[0];
      if (!sourceImage) throw new Error('No image to edit');
      
      // Convert canvas image to base64
      const base64Image = sourceImage.includes('base64,') 
        ? sourceImage.split('base64,')[1] 
        : sourceImage;
      
      // Get reference images for style guidance
      let referenceImages = editReferenceImages
        .filter(img => img.includes('base64,'))
        .map(img => img.split('base64,')[1]);
      
      let maskImage: string | undefined;
      let maskedReferenceImage: string | undefined;
      
      // Create mask from brush strokes if any exist
      if (brushStrokes.length > 0) {
        // Create a temporary image to get actual dimensions
        const tempImg = new Image();
        tempImg.src = sourceImage;
        await new Promise<void>((resolve) => {
          tempImg.onload = () => resolve();
        });
        
        // Create mask canvas with exact image dimensions
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = tempImg.width;
        canvas.height = tempImg.height;
        
        // Fill with black (unmasked areas)
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw white strokes (masked areas)
        ctx.strokeStyle = 'white';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        brushStrokes.forEach(stroke => {
          if (stroke.points.length >= 4) {
            ctx.lineWidth = stroke.brushSize;
            ctx.beginPath();
            ctx.moveTo(stroke.points[0], stroke.points[1]);
            
            for (let i = 2; i < stroke.points.length; i += 2) {
              ctx.lineTo(stroke.points[i], stroke.points[i + 1]);
            }
            ctx.stroke();
          }
        });
        
        // Convert mask to base64
        const maskDataUrl = canvas.toDataURL('image/png');
        maskImage = maskDataUrl.split('base64,')[1];
        
        // Create masked reference image (original image with mask overlay)
        const maskedCanvas = document.createElement('canvas');
        const maskedCtx = maskedCanvas.getContext('2d')!;
        maskedCanvas.width = tempImg.width;
        maskedCanvas.height = tempImg.height;
        
        // Draw original image
        maskedCtx.drawImage(tempImg, 0, 0);
        
        // Draw mask overlay with transparency
        maskedCtx.globalCompositeOperation = 'source-over';
        maskedCtx.globalAlpha = 0.4;
       maskedCtx.fillStyle = '#A855F7';
        
        brushStrokes.forEach(stroke => {
          if (stroke.points.length >= 4) {
            maskedCtx.lineWidth = stroke.brushSize;
           maskedCtx.strokeStyle = '#A855F7';
            maskedCtx.lineCap = 'round';
            maskedCtx.lineJoin = 'round';
            maskedCtx.beginPath();
            maskedCtx.moveTo(stroke.points[0], stroke.points[1]);
            
            for (let i = 2; i < stroke.points.length; i += 2) {
              maskedCtx.lineTo(stroke.points[i], stroke.points[i + 1]);
            }
            maskedCtx.stroke();
          }
        });
        
        maskedCtx.globalAlpha = 1;
        maskedCtx.globalCompositeOperation = 'source-over';
        
        const maskedDataUrl = maskedCanvas.toDataURL('image/png');
        maskedReferenceImage = maskedDataUrl.split('base64,')[1];
        
        // Add the masked image as a reference for the model
        referenceImages = [maskedReferenceImage, ...referenceImages];
      }
      
      const request: EditRequest = {
        instruction,
        originalImage: base64Image,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        maskImage,
        temperature
      };
      
      const images = await geminiService.editImage(request);
      return { images, maskedReferenceImage };
    },
    onMutate: () => {
      setIsGenerating(true);
    },
    onSuccess: ({ images, maskedReferenceImage }, instruction) => {
      if (images.length > 0) {
        const outputAssets: Asset[] = images.map((base64, index) => ({
          id: generateId(),
          type: 'output',
          url: `data:image/png;base64,${base64}`,
          mime: 'image/png',
          width: 1024,
          height: 1024,
          checksum: base64.slice(0, 32)
        }));

        // Create mask reference asset if we have one
        const maskReferenceAsset: Asset | undefined = maskedReferenceImage ? {
          id: generateId(),
          type: 'mask',
          url: `data:image/png;base64,${maskedReferenceImage}`,
          mime: 'image/png',
          width: 1024,
          height: 1024,
          checksum: maskedReferenceImage.slice(0, 32)
        } : undefined;

        const edit: Edit = {
          id: generateId(),
          parentGenerationId: selectedGenerationId || (currentProject?.generations[currentProject.generations.length - 1]?.id || ''),
          maskAssetId: brushStrokes.length > 0 ? generateId() : undefined,
          maskReferenceAsset,
          instruction,
          outputAssets,
          timestamp: Date.now()
        };

        addEdit(edit);
        
        // Automatically load the edited image in the canvas
        const { selectEdit, selectGeneration } = useAppStore.getState();
        setCanvasImage(outputAssets[0].url);
        selectEdit(edit.id);
        selectGeneration(null);
      }
      setIsGenerating(false);
    },
    onError: (error) => {
      console.error('Edit failed:', error);
      setIsGenerating(false);
    }
  });

  return {
    edit: editMutation.mutate,
    isEditing: editMutation.isPending,
    error: editMutation.error
  };
};