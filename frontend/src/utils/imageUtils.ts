export function base64ToBlob(base64: string, mimeType: string = 'image/png'): Blob {
  try {
    // 验证base64格式
    if (!base64 || typeof base64 !== 'string') {
      throw new Error('Invalid base64 input');
    }

    // 移除可能的data URL前缀
    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

    if (!cleanBase64) {
      throw new Error('Empty base64 data');
    }

    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (error) {
    console.error('Error converting base64 to blob:', error);
    throw new Error(`Failed to convert base64 to blob: ${error.message}`);
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    // 验证输入
    if (!blob || !(blob instanceof Blob)) {
      reject(new Error('Invalid blob input'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result as string;
        if (!result || !result.includes(',')) {
          reject(new Error('Invalid file reader result'));
          return;
        }
        const base64 = result.split(',')[1];
        resolve(base64);
      } catch (error) {
        reject(new Error(`Failed to process file reader result: ${error.message}`));
      }
    };
    reader.onerror = () => {
      reject(new Error('FileReader failed to read the blob'));
    };
    reader.readAsDataURL(blob);
  });
}

export function createImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

export function resizeImageToFit(
  image: HTMLImageElement, 
  maxWidth: number, 
  maxHeight: number
): { width: number; height: number } {
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  return {
    width: image.width * ratio,
    height: image.height * ratio
  };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function downloadImage(base64: string, filename: string): void {
  const blob = base64ToBlob(base64);
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
}