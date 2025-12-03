// Gemini服务适配器 - 连接前端UI与Go后端
// 保持原有接口不变，底层调用Go后端API

import {
  goBackendService,
  GoBackendRunRequest,
  GoBackendRunResponse
} from './goBackendService';

// 保持原有的接口定义不变，确保UI组件无需修改
export interface GenerationRequest {
  prompt: string;
  referenceImages?: string[];
  temperature?: number;
  resolution?: '1K' | '2K' | '4K';
  scenarioCount?: number;
}

export interface EditRequest {
  instruction: string;
  originalImage?: string;
  referenceImages?: string[];
  maskImage?: string;
  temperature?: number;
}

export interface ConcurrentGenerationRequest extends GenerationRequest {
  scenarioId: number;
}

// Gemini服务适配器类
export class GeminiServiceAdapter {
  // 将base64图片转换为File对象
  private base64ToFile(base64: string, filename: string = 'image.png'): File {
    try {
      // 验证输入
      if (!base64 || typeof base64 !== 'string') {
        throw new Error('Invalid base64 input');
      }

      // 处理data URL格式
      let cleanBase64 = base64;
      let mimeType = 'image/png';

      if (base64.includes(',')) {
        const parts = base64.split(',');
        if (parts.length !== 2) {
          throw new Error('Invalid data URL format');
        }

        const mimeMatch = parts[0].match(/:(.*?);/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }

        cleanBase64 = parts[1];
      }

      if (!cleanBase64) {
        throw new Error('Empty base64 data');
      }

      // 转换为二进制数据
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return new File([bytes], filename, { type: mimeType });
    } catch (error) {
      console.error('Error converting base64 to file:', error);
      throw new Error(`Failed to convert base64 to file: ${error.message}`);
    }
  }

  // 将前端GenerationRequest转换为Go后端请求格式
  private convertToGoBackendRequest(request: GenerationRequest): GoBackendRunRequest {
    const goRequest: GoBackendRunRequest = {
      prompt: request.prompt,
      scenarioCount: request.scenarioCount || 1,
      resolution: request.resolution || '4K',
    };

    // 如果有参考图片，使用第一张作为主要图片
    if (request.referenceImages && request.referenceImages.length > 0) {
      const imageFile = this.base64ToFile(request.referenceImages[0], 'reference.png');
      goRequest.image = imageFile;
    }

    return goRequest;
  }

  // 将Go后端响应转换为前端期望的格式
  private convertFromGoBackendResponse(response: GoBackendRunResponse): string[] {
    console.log('🔄 转换Go后端响应:', response);

    // 检查响应状态
    if (response.status !== 'ok') {
      console.error('❌ Go后端返回非OK状态:', response.status, response.error);
      throw new Error(response.error || `Go后端生成失败，状态: ${response.status}`);
    }

    // 检查是否有结果数据
    if (!response.results || !Array.isArray(response.results)) {
      console.error('❌ Go后端未返回有效的结果数据');
      throw new Error('Go后端未返回结果数据');
    }

    // 过滤并转换成功的图片
    const successResults = response.results.filter(result =>
      result.outcome === 'downloaded' && (result.url || result.path)
    );

    console.log(`📊 成功/总数: ${successResults.length}/${response.results.length}`);

    if (successResults.length === 0) {
      // 如果没有成功的结果，检查是否有错误信息
      const errors = response.results.filter(r => r.error).map(r => r.error);
      if (errors.length > 0) {
        console.error('❌ 所有场景都失败了:', errors);
        throw new Error(`所有场景生成失败: ${errors.join('; ')}`);
      } else {
        console.warn('⚠️ 没有成功的图片生成');
        return [];
      }
    }

    const imageUrls = successResults.map(result => {
      if (result.url) {
        // Go后端返回的URL已经是完整路径（以/开头），直接构建完整URL
        const fullUrl = result.url.startsWith('/') ?
          `http://localhost:8080${result.url}` :
          result.url;
        console.log(`🔗 场景${result.id} URL:`, fullUrl);
        return fullUrl;
      } else if (result.path) {
        // 如果path存在但url为空，构建完整URL
        const fullUrl = goBackendService.getImageUrl(result.path);
        console.log(`🔗 场景${result.id} 从path构建URL:`, fullUrl);
        return fullUrl;
      }
      console.warn(`⚠️ 场景${result.id} 无有效URL或path`);
      return '';
    }).filter(url => url !== '');

    console.log(`✅ 转换得到 ${imageUrls.length} 个图片URL:`, imageUrls);
    return imageUrls;
  }

  // 生成单个图片
  async generateImage(request: GenerationRequest): Promise<string[]> {
    try {
      console.log('🚀 开始调用Go后端生成图片:', request);

      // 转换请求格式
      const goRequest = this.convertToGoBackendRequest(request);

      // 调用Go后端
      const response = await goBackendService.generateImage(goRequest);

      console.log('✅ Go后端响应:', response);

      // 转换响应格式
      const images = this.convertFromGoBackendResponse(response);

      console.log('🎯 转换后的图片URL数量:', images.length);
      return images;
    } catch (error) {
      console.error('Go后端生成失败:', error);

      // 处理Go后端特有的错误
      if (error.message.includes('quota')) {
        throw new Error('API配额已用完，请稍后重试或更换代理');
      } else if (error.message.includes('timeout')) {
        throw new Error('请求超时，请重试');
      } else if (error.message.includes('network')) {
        throw new Error('网络连接失败，请检查后端服务');
      }

      throw error;
    }
  }

  // 并发生成多个场景
  async generateConcurrentImages(request: GenerationRequest): Promise<Array<{scenarioId: number, images: string[], error?: string}>> {
    try {
      console.log('🚀 开始调用Go后端并发生成图片:', request);

      const scenarioCount = request.scenarioCount || 1;
      const goRequest = this.convertToGoBackendRequest(request);
      goRequest.scenarioCount = scenarioCount;

      // 调用Go后端并发生成
      const response = await goBackendService.generateImage(goRequest);

      console.log('✅ Go后端并发响应:', response);

      if (response.status === 'ok' && response.results) {
        return response.results.map(result => ({
          scenarioId: result.id,
          images: result.url ? [result.url] : (result.path ? [goBackendService.getImageUrl(result.path)] : []),
          proxyTag: result.proxyTag,
          outcome: result.outcome,
          error: result.error,
        }));
      } else {
        throw new Error(response.error || 'Go后端并发生成失败');
      }
    } catch (error) {
      console.error('Go后端并发生成失败:', error);
      throw error;
    }
  }

  // 编辑图片（暂时返回空实现，因为Go后端可能不支持编辑功能）
  async editImage(_request: EditRequest): Promise<string[]> {
    console.warn('⚠️ 图片编辑功能尚未在Go后端中实现');
    // TODO: 如果Go后端支持编辑功能，可以在这里实现
    return [];
  }

  // 测试Go后端连接
  async testConnection(): Promise<boolean> {
    try {
      return await goBackendService.testConnection();
    } catch (error) {
      console.error('Go后端连接测试失败:', error);
      return false;
    }
  }

  // 获取代理状态（Go后端特有功能）
  async getProxyStatus(): Promise<string[]> {
    try {
      return await goBackendService.getProxyStatus();
    } catch (error) {
      console.error('获取代理状态失败:', error);
      return [];
    }
  }

  // 获取画廊（Go后端特有功能）
  async getGallery() {
    try {
      return await goBackendService.getGallery();
    } catch (error) {
      console.error('获取画廊失败:', error);
      return null;
    }
  }

  // 取消当前运行（Go后端特有功能）
  async cancelRun() {
    try {
      return await goBackendService.cancelRun();
    } catch (error) {
      console.error('取消运行失败:', error);
      throw error;
    }
  }
}

// 导出适配器实例
export const geminiService = new GeminiServiceAdapter();

// 从Go后端服务重新导出类型，保持类型安全
export type {
  GoBackendRunRequest,
  GoBackendRunResponse
} from './goBackendService';