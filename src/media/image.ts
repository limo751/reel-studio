// Bilder robust dekodieren (JPG, PNG, BMP, HEIC, WebP …).
// Erst createImageBitmap; scheitert das (z. B. bei manchen PNGs/BMPs in Safari),
// wird das Bild über ein <img>-Element geladen und auf eine Leinwand gezeichnet.

/** Dekodiert ein Bild, optional verkleinert auf `maxSide` Pixel (lange Seite). */
export async function decodeImage(blob: Blob, maxSide?: number): Promise<ImageBitmap> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = maxSide ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
    if (s >= 1) return bmp;
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    try {
      const small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      bmp.close();
      return small;
    } catch {
      return scaleViaCanvas(bmp, w, h);
    }
  } catch {
    return decodeViaImg(blob, maxSide);
  }
}

async function scaleViaCanvas(src: CanvasImageSource & { close?: () => void }, w: number, h: number): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  src.close?.();
  return createImageBitmap(c);
}

async function decodeViaImg(blob: Blob, maxSide?: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) throw new Error('Bild ohne Inhalt');
    const s = maxSide ? Math.min(1, maxSide / Math.max(iw, ih)) : 1;
    return await scaleViaCanvas(img, Math.round(iw * s), Math.round(ih * s));
  } catch {
    throw new Error('Dieses Bildformat kann der Browser nicht lesen.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
