'use client';

/**
 * Resizes / re-encodes a photo in the browser before upload (Settings →
 * Inventory: largest side and quality). GIFs (animation) are kept as they are;
 * PNGs become WebP (keeps transparency), other photos JPEG. A result that is
 * not smaller than the original is discarded.
 */
export async function compressImage(file: File, maxPx = 1600, quality = 82): Promise<File> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const type = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, Math.min(0.95, Math.max(0.4, quality / 100))));
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/webp' ? '.webp' : '.jpg');
  return new File([blob], name, { type });
}
