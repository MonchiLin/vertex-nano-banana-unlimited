import { SegmentationMask } from '../types';
import { generateId } from '../utils/imageUtils';

export class ImageProcessor {
  // Interactive segmentation using click point
  static async createMaskFromClick(
    image: HTMLImageElement, 
    x: number, 
    y: number
  ): Promise<SegmentationMask> {
    // Simulate mask creation - in production this would use MediaPipe
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = image.width;
    canvas.height = image.height;

    // Draw the image
    ctx.drawImage(image, 0, 0);
    
    // Create a simple circular mask for demo
    const radius = 50;
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCanvas.width = image.width;
    maskCanvas.height = image.height;
    
    // Fill with black (background)
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    
    // Draw white circle (selected region)
    maskCtx.fillStyle = 'white';
    maskCtx.beginPath();
    maskCtx.arc(x, y, radius, 0, 2 * Math.PI);
    maskCtx.fill();

    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

    return {
      id: generateId(),
      imageData,
      bounds: {
        x: Math.max(0, x - radius),
        y: Math.max(0, y - radius),
        width: radius * 2,
        height: radius * 2
      },
      feather: 5
    };
  }

  // Apply feathering to mask
  static applyFeathering(mask: SegmentationMask, featherRadius: number): ImageData {
    const { imageData } = mask;
    const data = new Uint8ClampedArray(imageData.data);
    
    // Simple box blur for feathering
    for (let i = 0; i < featherRadius; i++) {
      this.boxBlur(data, imageData.width, imageData.height);
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  private static boxBlur(data: Uint8ClampedArray, width: number, height: number) {
    const temp = new Uint8ClampedArray(data);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        // Average the alpha channel (mask channel)
        const sum = 
          temp[idx - 4 + 3] + temp[idx + 3] + temp[idx + 4 + 3] +
          temp[idx - width * 4 + 3] + temp[idx + 3] + temp[idx + width * 4 + 3] +
          temp[idx - width * 4 - 4 + 3] + temp[idx - width * 4 + 4 + 3] + temp[idx + width * 4 - 4 + 3];
        
        data[idx + 3] = sum / 9;
      }
    }
  }

  // Convert ImageData to base64 for API
  static imageDataToBase64(imageData: ImageData): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    ctx.putImageData(imageData, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1]; // Remove data:image/png;base64, prefix
  }
}