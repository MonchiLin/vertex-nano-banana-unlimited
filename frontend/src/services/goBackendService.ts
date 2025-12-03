// Go后端API服务适配器
// 用于连接前端UI与Go后端API

// Go后端API接口类型定义
export interface GoBackendRunRequest {
  prompt: string;
  image?: File | string;  // File对象（multipart请求）或本地图片路径（JSON请求）
  scenarioCount?: number;
  resolution?: string;
}

export interface GoBackendRunResponse {
  status: string;
  imageUsed?: string;
  imageOrig?: string;
  scenarioCount: number;
  results?: GoBackendScenarioResult[];
  error?: string;
}

export interface GoBackendScenarioResult {
  id: number;
  outcome: 'downloaded' | 'exhausted' | 'none';
  path: string;
  url: string;
  proxyTag?: string;
  outputRes?: string;
  error?: string;
}

export interface GoBackendGalleryResponse {
  dir: string;
  count: number;
  folders: GoBackendGalleryGroup[];
}

export interface GoBackendGalleryGroup {
  name: string;
  count: number;
  latest: string;
  files?: GoBackendGalleryFile[];
}

export interface GoBackendGalleryFile {
  name: string;
  url: string;
  size: number;
  modTime: string;
}

export interface GoBackendHealthResponse {
  status: string;
}

export interface GoBackendCancelResponse {
  status: string;
}

export interface ProxySubscriptionsResponse {
  storedSubscriptions: string[];
  effective: string[];
  subscriptions?: string[]; // fallback key
}

// Go后端服务类
export class GoBackendService {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:8080';
  }

  private async handleRunResponse(response: Response): Promise<GoBackendRunResponse> {
    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new Error(`Go后端生成失败: 无法解析响应 ${response.status} ${response.statusText} - ${raw}`);
    }

    const results = Array.isArray(data.results)
      ? (data.results as GoBackendScenarioResult[]).filter(r => r.outcome === 'downloaded')
      : [];

    if (results.length > 0) {
      return {
        status: data.status || 'ok',
        imageUsed: data.imageUsed,
        imageOrig: data.imageOrig,
        scenarioCount: data.scenarioCount ?? results.length,
        results,
        error: data.error,
      };
    }

    const msg = data.error || raw || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Go后端生成失败: ${msg}`);
  }

  // 健康检查
  async healthCheck(): Promise<GoBackendHealthResponse> {
    const response = await fetch(`${this.baseUrl}/healthz`);
    if (!response.ok) {
      throw new Error(`Go后端健康检查失败: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // 取消当前运行
  async cancelRun(): Promise<GoBackendCancelResponse> {
    const response = await fetch(`${this.baseUrl}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Go后端取消运行失败: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // 生成图片（支持File对象和本地路径）
  async generateImage(request: GoBackendRunRequest): Promise<GoBackendRunResponse> {
    // 如果image是File对象，使用multipart方式
    if (request.image instanceof File) {
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

      // 添加图片文件
      formData.append('image', request.image);

      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        body: formData,
      });

      return this.handleRunResponse(response);
    }
    // 如果image是字符串，使用JSON方式
    else if (typeof request.image === 'string') {
      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: request.image,
          prompt: request.prompt,
          scenarioCount: request.scenarioCount || 1,
          resolution: request.resolution || '4K',
        }),
      });

      return this.handleRunResponse(response);
    }
    // 没有提供image的情况 - 现在支持纯文本生成
    else {
      console.log('ℹ️ No image provided, using text-only generation');

      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.prompt,
          scenarioCount: request.scenarioCount || 1,
          resolution: request.resolution || '4K',
        }),
      });

      return this.handleRunResponse(response);
    }
  }

  // 获取生成历史画廊
  async getGallery(): Promise<GoBackendGalleryResponse> {
    const response = await fetch(`${this.baseUrl}/gallery`);
    if (!response.ok) {
      throw new Error(`Go后端画廊请求失败: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // 获取特定文件夹的文件列表
  async getGalleryFiles(folder: string): Promise<{ folder: string; count: number; files: GoBackendGalleryFile[] }> {
    const url = new URL(`${this.baseUrl}/gallery/files`);
    url.searchParams.append('folder', folder);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Go后端画廊文件请求失败: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // 获取图片文件的完整URL
  getImageUrl(relativePath: string): string {
    return `${this.baseUrl}${relativePath.startsWith('/') ? relativePath : '/' + relativePath}`;
  }

  // 测试Go后端连接
  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.status === 'ok';
    } catch (error) {
      console.error('Go后端连接测试失败:', error);
      return false;
    }
  }

  // 获取代理状态（如果Go后端支持）
  async getProxyStatus(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/proxy/status`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.proxies || [];
    } catch (error) {
      console.error('获取代理状态失败:', error);
      return [];
    }
  }

  // 订阅管理 CRUD
  async getProxySubscriptions(): Promise<ProxySubscriptionsResponse> {
    const res = await fetch(`${this.baseUrl}/proxy/subscriptions`);
    if (!res.ok) {
      throw new Error(`获取订阅失败: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return {
      envSubscriptions: data.envSubscriptions || [],
      storedSubscriptions: data.storedSubscriptions || data.subscriptions || [],
      effective: data.effective || data.storedSubscriptions || data.subscriptions || [],
    };
  }

  async addProxySubscription(url: string): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/proxy/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`添加订阅失败: ${res.status} ${res.statusText} - ${txt}`);
    }
    const data = await res.json();
    return data.subscriptions || data.storedSubscriptions || [];
  }

  async replaceProxySubscriptions(urls: string[]): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/proxy/subscriptions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`更新订阅失败: ${res.status} ${res.statusText} - ${txt}`);
    }
    const data = await res.json();
    return data.subscriptions || data.storedSubscriptions || [];
  }

  async deleteProxySubscription(url: string): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/proxy/subscriptions?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`删除订阅失败: ${res.status} ${res.statusText} - ${txt}`);
    }
    const data = await res.json();
    return data.subscriptions || data.storedSubscriptions || [];
  }
}

// 创建单例实例
export const goBackendService = new GoBackendService();
