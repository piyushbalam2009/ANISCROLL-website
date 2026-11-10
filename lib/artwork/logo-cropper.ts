export interface ProcessedLogoCanvasResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  trimmedPixels: number;
  hasTransparency: boolean;
}

const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateCustomLogoFile(file: File): string | null {
  if (!file) return 'No file selected.';
  if (file.type !== 'image/png' && file.type !== 'image/webp') {
    return 'Only transparent PNG or WebP files are supported.';
  }
  if (file.size <= 0) {
    return 'Selected file is empty.';
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return 'File size exceeds the 5MB maximum limit.';
  }
  return null;
}

export async function cropTransparentBounds(
  file: File,
  options?: {
    autoTrim?: boolean;
    paddingPx?: number;
    outputType?: 'image/png' | 'image/webp';
  }
): Promise<ProcessedLogoCanvasResult> {
  const autoTrim = options?.autoTrim ?? true;
  const paddingPx = Math.max(0, options?.paddingPx ?? 6);
  const outputType = options?.outputType ?? 'image/png';

  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image file.'));
      image.src = objectUrl;
    });

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    if (originalWidth <= 0 || originalHeight <= 0) {
      throw new Error('Invalid image dimensions.');
    }

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = originalWidth;
    srcCanvas.height = originalHeight;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) {
      throw new Error('Unable to initialize 2D canvas context.');
    }

    srcCtx.drawImage(img, 0, 0);
    const imageData = srcCtx.getImageData(0, 0, originalWidth, originalHeight);
    const { data } = imageData;

    let minX = originalWidth;
    let minY = originalHeight;
    let maxX = -1;
    let maxY = -1;
    let transparentPixelCount = 0;

    for (let y = 0; y < originalHeight; y++) {
      for (let x = 0; x < originalWidth; x++) {
        const alpha = data[(y * originalWidth + x) * 4 + 3];
        if (alpha < 10) {
          transparentPixelCount++;
        } else {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const hasTransparency = transparentPixelCount > 0;

    if (!autoTrim || maxX < minX || maxY < minY) {
      const dataUrl = srcCanvas.toDataURL(outputType, 0.95);
      const blob = await new Promise<Blob>((resolve, reject) => {
        srcCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to encode logo blob.'))),
          outputType,
          0.95
        );
      });

      return {
        blob,
        dataUrl,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        trimmedPixels: 0,
        hasTransparency,
      };
    }

    const cropX = Math.max(0, minX - paddingPx);
    const cropY = Math.max(0, minY - paddingPx);
    const cropMaxX = Math.min(originalWidth - 1, maxX + paddingPx);
    const cropMaxY = Math.min(originalHeight - 1, maxY + paddingPx);

    const outWidth = Math.max(1, cropMaxX - cropX + 1);
    const outHeight = Math.max(1, cropMaxY - cropY + 1);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      throw new Error('Unable to initialize output canvas context.');
    }

    outCtx.drawImage(
      srcCanvas,
      cropX,
      cropY,
      outWidth,
      outHeight,
      0,
      0,
      outWidth,
      outHeight
    );

    const dataUrl = outCanvas.toDataURL(outputType, 0.95);
    const blob = await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode cropped logo blob.'))),
        outputType,
        0.95
      );
    });

    const trimmedPixels =
      originalWidth * originalHeight - outWidth * outHeight;

    return {
      blob,
      dataUrl,
      width: outWidth,
      height: outHeight,
      originalWidth,
      originalHeight,
      trimmedPixels: Math.max(0, trimmedPixels),
      hasTransparency,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
