import { get, set, del, keys } from 'idb-keyval';
import { Project, Generation, Asset } from '../types';

const CACHE_PREFIX = 'nano-banana';
const CACHE_VERSION = '1.0';

export class CacheService {
  private static getKey(type: string, id: string): string {
    return `${CACHE_PREFIX}-${CACHE_VERSION}-${type}-${id}`;
  }

  // Project caching
  static async saveProject(project: Project): Promise<void> {
    await set(this.getKey('project', project.id), project);
  }

  static async getProject(id: string): Promise<Project | null> {
    return (await get(this.getKey('project', id))) || null;
  }

  static async getAllProjects(): Promise<Project[]> {
    const allKeys = await keys();
    const projectKeys = allKeys.filter(key => 
      typeof key === 'string' && key.includes(`${CACHE_PREFIX}-${CACHE_VERSION}-project-`)
    );
    
    const projects = await Promise.all(
      projectKeys.map(key => get(key as string))
    );
    
    return projects.filter(Boolean) as Project[];
  }

  // Asset caching (for offline access)
  static async cacheAsset(asset: Asset, data: Blob): Promise<void> {
    await set(this.getKey('asset', asset.id), {
      asset,
      data,
      cachedAt: Date.now()
    });
  }

  static async getCachedAsset(assetId: string): Promise<{ asset: Asset; data: Blob } | null> {
    const cached = await get(this.getKey('asset', assetId));
    return cached || null;
  }

  // Generation metadata caching
  static async cacheGeneration(generation: Generation): Promise<void> {
    await set(this.getKey('generation', generation.id), generation);
  }

  static async getGeneration(id: string): Promise<Generation | null> {
    return (await get(this.getKey('generation', id))) || null;
  }

  // Clear old cache entries
  static async clearOldCache(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const allKeys = await keys();
    const now = Date.now();
    
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith(CACHE_PREFIX)) {
        const cached = await get(key);
        if (cached?.cachedAt && (now - cached.cachedAt) > maxAge) {
          await del(key);
        }
      }
    }
  }
}