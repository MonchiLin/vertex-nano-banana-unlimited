// 类型定义 - 移到本文件避免循环导入

export interface BackendRunRequest {
  prompt: string;
  image?: File;
  imagePath?: string;
  scenarioCount?: number;
  resolution?: string;
}

export interface BackendRunResponse {
  status: string;
  imagePathUsed?: string;
  imagePathOrig?: string;
  scenarioCount: number;
  results?: ScenarioResult[];
  error?: string;
}

export interface ScenarioResult {
  id: number;
  outcome: 'downloaded' | 'exhausted' | 'none';
  path: string;
  url: string;
  proxyTag?: string;
  outputRes?: string;
  error?: string;
}

export interface GalleryResponse {
  dir: string;
  count: number;
  folders: GalleryGroup[];
}

export interface GalleryGroup {
  name: string;
  count: number;
  latest: string;
  files?: GalleryFile[];
}

export interface GalleryFile {
  name: string;
  url: string;
  size: number;
  modTime: string;
}

export interface HealthResponse {
  status: string;
}

export interface CancelResponse {
  status: string;
}

// 后端API基础URL - 开发环境配置
const BACKEND_BASE_URL = 'http://localhost:8080';

class BackendService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BACKEND_BASE_URL;
  }

  private async handleRunResponse(response: Response): Promise<BackendRunResponse> {
    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new Error(`Generation failed: cannot parse response ${response.status} ${response.statusText} - ${raw}`);
    }

    const results = Array.isArray(data.results)
      ? (data.results as ScenarioResult[]).filter(r => r.outcome === 'downloaded')
      : [];

    if (results.length > 0) {
      return {
        status: data.status || 'ok',
        imagePathUsed: data.imageUsed,
        imagePathOrig: data.imageOrig,
        scenarioCount: data.scenarioCount ?? results.length,
        results,
        error: data.error,
      };
    }

    const msg = data.error || raw || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Generation failed: ${msg}`);
  }

  // 健康检查
  async healthCheck(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/healthz`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    return response.json();
  }

  // 取消当前运行
  async cancelRun(): Promise<CancelResponse> {
    const response = await fetch(`${this.baseUrl}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Cancel failed: ${response.status}`);
    }
    return response.json();
  }

  // 生成图片（multipart方式）
  async generateImage(request: BackendRunRequest): Promise<BackendRunResponse> {
    const formData = new FormData();

    // 添加必填字段
    formData.append('prompt', request.prompt);

    // 添加可选字段
    if (request.scenarioCount && request.scenarioCount > 1) {
      formData.append('scenarioCount', request.scenarioCount.toString());
    }

    if (request.resolution) {
      formData.append('resolution', request.resolution);
    }

    // 添加图片文件（如果有）
    if (request.image) {
      formData.append('image', request.image);
    }

    const response = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      body: formData,
    });

    return this.handleRunResponse(response);
  }

  // 生成图片（JSON方式 - 使用本地图片路径）
  async generateImageFromPath(request: BackendRunRequest): Promise<BackendRunResponse> {
    if (!request.imagePath) {
      throw new Error('imagePath is required for JSON request');
    }

    const response = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imagePath: request.imagePath,
        prompt: request.prompt,
        scenarioCount: request.scenarioCount || 1,
        resolution: request.resolution || '4K',
      }),
    });

    return this.handleRunResponse(response);
  }

  // 获取生成历史画廊
  async getGallery(): Promise<GalleryResponse> {
    const response = await fetch(`${this.baseUrl}/gallery`);
    if (!response.ok) {
      throw new Error(`Gallery request failed: ${response.status}`);
    }
    return response.json();
  }

  // 获取特定文件夹的文件列表
  async getGalleryFiles(folder: string): Promise<{ folder: string; count: number; files: GalleryFile[] }> {
    const url = new URL(`${this.baseUrl}/gallery/files`);
    url.searchParams.append('folder', folder);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Gallery files request failed: ${response.status}`);
    }
    return response.json();
  }

  // 获取图片文件的完整URL
  getImageUrl(relativePath: string): string {
    return `${this.baseUrl}${relativePath.startsWith('/') ? relativePath : '/' + relativePath}`;
  }

  // 测试后端连接
  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.status === 'ok';
    } catch (error) {
      console.error('Backend connection test failed:', error);
      return false;
    }
  }
}

// 创建单例实例
export const backendService = new BackendService();

// 兼容现有代码的接口
export interface GenerationRequest {
  prompt: string;
  referenceImages?: string[];
  temperature?: number;
  resolution?: '1K' | '2K' | '4K';
  scenarioCount?: number;
}

export interface EditRequest {
  instruction: string;
  originalImage: string;
  referenceImages?: string[];
  maskImage?: string;
  temperature?: number;
}

export interface ConcurrentGenerationRequest extends GenerationRequest {
  scenarioId: number;
}

// 兼容接口适配器
export class GeminiServiceAdapter {
  private backend: BackendService;

  constructor() {
    this.backend = backendService;
  }

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

  // 生成单个图片
  async generateImage(request: GenerationRequest): Promise<string[]> {
    try {
      const backendRequest: BackendRunRequest = {
        prompt: request.prompt,
        scenarioCount: 1,
        resolution: request.resolution,
      };

      // 如果有参考图片，使用第一张作为主要图片
      if (request.referenceImages && request.referenceImages.length > 0) {
        const imageFile = this.base64ToFile(request.referenceImages[0], 'reference.png');
        backendRequest.image = imageFile;
      }

      const response = await this.backend.generateImage(backendRequest);

      if (response.status === 'ok' && response.results) {
        // 将后端的URL转换为前端可用的URL
        return response.results.map(result => {
          if (result.url) {
            // 使用后端返回的完整URL
            return result.url;
          } else if (result.path) {
            // 如果path存在但url为空，构建完整URL
            return this.getImageUrl(result.path);
          }
          return '';
        }).filter(url => url !== '');
      } else {
        throw new Error(response.error || 'Generation failed');
      }
    } catch (error) {
      console.error('Backend generation failed:', error);
      throw error;
    }
  }

  // 并发生成多个场景
  async generateConcurrentImages(request: GenerationRequest): Promise<Array<{scenarioId: number, images: string[], error?: string}>> {
    try {
      const scenarioCount = request.scenarioCount || 1;
      const backendRequest: BackendRunRequest = {
        prompt: request.prompt,
        scenarioCount,
        resolution: request.resolution,
      };

      // 如果有参考图片，使用第一张作为主要图片
      if (request.referenceImages && request.referenceImages.length > 0) {
        const imageFile = this.base64ToFile(request.referenceImages[0], 'reference.png');
        backendRequest.image = imageFile;
      }

      const response = await this.backend.generateImage(backendRequest);

      if (response.status === 'ok' && response.results) {
        return response.results.map(result => ({
          scenarioId: result.id,
          images: result.url ? [result.url] : (result.path ? [this.getImageUrl(result.path)] : []),
          error: result.error,
        }));
      } else {
        throw new Error(response.error || 'Concurrent generation failed');
      }
    } catch (error) {
      console.error('Backend concurrent generation failed:', error);
      throw error;
    }
  }

  // 编辑图片（暂时返回空实现，因为后端可能不支持编辑功能）
  async editImage(request: EditRequest): Promise<string[]> {
    console.warn('Image editing not implemented in backend service');
    return [];
  }
}

// 导出适配器实例
export const geminiService = new GeminiServiceAdapter();

// 确保导出所有必需的接口和类型
export {
  GenerationRequest,
  EditRequest,
  ConcurrentGenerationRequest
};

export type {
  BackendRunRequest,
  BackendRunResponse,
  ScenarioResult,
  GalleryResponse,
  GalleryGroup,
  GalleryFile,
  HealthResponse,
  CancelResponse
};
