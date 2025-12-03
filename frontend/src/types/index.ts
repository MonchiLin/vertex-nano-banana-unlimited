export interface Asset {
  id: string;
  type: 'original' | 'mask' | 'output';
  url: string;
  mime: string;
  width: number;
  height: number;
  checksum: string;
  metadata?: {
    scenarioIndex?: number;
    totalScenarios?: number;
    backend?: string;
    referenceIndex?: number;
    totalReferences?: number;
    proxyTag?: string;
  };
}

export interface Generation {
  id: string;
  prompt: string;
  parameters: {
    temperature?: number;
    aspectRatio?: string;
    scenarioCount?: number;
    resolution?: '1K' | '2K' | '4K';
    backendType?: string;
  };
  sourceAssets: Asset[];
  outputAssets: Asset[];
  modelVersion: string;
  timestamp: number;
  costEstimate?: number;
  metadata?: {
    backendUrl?: string;
    generationType?: 'single' | 'concurrent';
    successRate?: string;
    proxyTags?: string[];
  };
}

export interface Edit {
  id: string;
  parentGenerationId: string;
  maskAssetId?: string;
  maskReferenceAsset?: Asset;
  instruction: string;
  outputAssets: Asset[];
  timestamp: number;
}

export interface Project {
  id: string;
  title: string;
  generations: Generation[];
  edits: Edit[];
  createdAt: number;
  updatedAt: number;
}

export interface SegmentationMask {
  id: string;
  imageData: ImageData;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  feather: number;
}

export interface BrushStroke {
  id: string;
  points: number[];
  brushSize: number;
  color: string;
}

export interface PromptHint {
  category: 'subject' | 'scene' | 'action' | 'style' | 'camera';
  text: string;
  example: string;
}