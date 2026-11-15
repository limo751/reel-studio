// Mediathek der Web-App: Ordner mit Fotos/Videos, Musik und LUTs.
// Ersetzt PhotoLibrary/MusicLibrary der iOS-App. Dateien werden in IndexedDB kopiert,
// damit Projekte auch später noch bearbeitet werden können.
import { signal } from '@preact/signals';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { dbAll, dbDelete, dbGet, dbPut } from '../model/db';
import { uid } from '../model/project';
import { decodeImage } from './image';
import { readCaptureInfo } from './metadata';

export interface MediaItem {
  id: string;
  folderId: string;
  name: string;
  isPhoto: boolean;
  duration: number;
  width: number;
  height: number;
  size: number;
  created: number | null;
  lat: number | null;
  lon: number | null;
}

export interface Folder { id: string; name: string; created: number; itemIDs: string[] }
export interface Song { id: string; name: string; duration: number; size: number }
export interface LUTFile { id: string; name: string; text: string }

export const folders = signal<Folder[]>([]);
export const media = signal<Record<string, MediaItem>>({});
export const songs = signal<Song[]>([]);
export const luts = signal<LUTFile[]>([]);
export const importState = signal<{ label: string; done: number; total: number } | null>(null);

const VIDEO_EXT = ['mov', 'mp4', 'm4v', '3gp', 'webm', 'mkv'];
const PHOTO_EXT = ['jpg', 'jpeg', 'jpe', 'jfif', 'heic', 'heif', 'png', 'bmp', 'dib', 'webp', 'avif', 'gif', 'tif', 'tiff'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'caf', 'flac', 'ogg'];

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isVideoFile = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.includes(ext(f.name));
export const isPhotoFile = (f: File) => f.type.startsWith('image/') || PHOTO_EXT.includes(ext(f.name));
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.includes(ext(f.name));
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

export async function loadLibrary() {
  const [f, m, s, l] = await Promise.all([
    dbAll<Folder>('folders'), dbAll<MediaItem>('media'), dbAll<Song>('songs'), dbAll<LUTFile>('luts'),
  ]);
  folders.value = f.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  media.value = Object.fromEntries(m.map((x) => [x.id, x]));
  songs.value = s.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  luts.value = l.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// MARK: Dateiinhalte

const blobCache = new Map<string, Blob>();

export async function getBlob(id: string): Promise<Blob> {
  const c = blobCache.get(id);
  if (c) return c;
  const b = await dbGet<Blob>('blobs', id);
  if (!b) throw new Error('Ein Medium fehlt (gelöscht oder nicht verfügbar).');
  blobCache.set(id, b);
  return b;
}

/** Medien eines Ordners, nach Aufnahmezeit sortiert. */
export function folderItems(folderId: string): MediaItem[] {
  const f = folders.value.find((x) => x.id === folderId);
  if (!f) return [];
  return f.itemIDs.map((id) => media.value[id]).filter(Boolean)
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0) || a.name.localeCompare(b.name));
}

// MARK: Ordner

export async function createFolder(name: string): Promise<Folder> {
  const f: Folder = { id: uid(), name: name.trim() || 'Ordner', created: Date.now(), itemIDs: [] };
  await dbPut('folders', f.id, f);
  folders.value = [...folders.value, f].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return f;
}

export async function renameFolder(id: string, name: string) {
  const f = folders.value.find((x) => x.id === id);
  if (!f) return;
  const nf = { ...f, name: name.trim() || f.name };
  await dbPut('folders', id, nf);
  folders.value = folders.value.map((x) => (x.id === id ? nf : x));
}

export async function deleteFolder(id: string) {
  const f = folders.value.find((x) => x.id === id);
  if (!f) return;
  for (const mid of f.itemIDs) await removeMediaData(mid);
  await dbDelete('folders', id);
  folders.value = folders.value.filter((x) => x.id !== id);
  const m = { ...media.value };
  for (const mid of f.itemIDs) delete m[mid];
  media.value = m;
}

async function removeMediaData(id: string) {
  await dbDelete('media', id);
  await dbDelete('blobs', id);
  await dbDelete('cache', 'thumb:' + id);
  blobCache.delete(id);
}

export async function removeFromFolder(folderId: string, itemID: string) {
  const f = folders.value.find((x) => x.id === folderId);
  if (!f) return;
  const nf = { ...f, itemIDs: f.itemIDs.filter((x) => x !== itemID) };
  await dbPut('folders', f.id, nf);
  await removeMediaData(itemID);
  folders.value = folders.value.map((x) => (x.id === f.id ? nf : x));
  const m = { ...media.value };
  delete m[itemID];
  media.value = m;
}

/** Kopiert Fotos/Videos in einen Ordner der App. Dateien mit gleichem Namen und gleicher Größe werden übersprungen. */
export async function importIntoFolder(folderId: string, files: File[]): Promise<{ added: number; skipped: number; failed: string[] }> {
  const list = files.filter((f) => isVideoFile(f) || isPhotoFile(f));
  const result = { added: 0, skipped: files.length - list.length, failed: [] as string[] };
  let folder = folders.value.find((x) => x.id === folderId);
  if (!folder) return result;
  const existing = new Set(folder.itemIDs.map((id) => media.value[id]).filter(Boolean).map((m) => m.name + '|' + m.size));
  importState.value = { label: 'Importiere', done: 0, total: list.length };
  for (const [i, file] of list.entries()) {
    importState.value = { label: 'Importiere', done: i, total: list.length };
    if (existing.has(file.name + '|' + file.size)) { result.skipped++; continue; }
    try {
      const item = await probeMedia(file, folderId);
      await dbPut('blobs', item.id, file);
      await dbPut('media', item.id, item);
      folder = { ...folder!, itemIDs: [...folder!.itemIDs, item.id] };
      await dbPut('folders', folder.id, folder);
      media.value = { ...media.value, [item.id]: item };
      folders.value = folders.value.map((x) => (x.id === folder!.id ? folder! : x));
      result.added++;
    } catch (e) {
      console.warn('Import fehlgeschlagen', file.name, e);
      result.failed.push(file.name);
    }
  }
  importState.value = null;
  return result;
}

async function probeMedia(file: File, folderId: string): Promise<MediaItem> {
  const isPhoto = !isVideoFile(file);
  const cap = await readCaptureInfo(file, isPhoto).catch(() => ({ date: null, lat: null, lon: null }));
  const item: MediaItem = {
    id: uid(), folderId, name: file.name, isPhoto, duration: 0, width: 0, height: 0, size: file.size,
    created: cap.date ?? (file.lastModified || null), lat: cap.lat, lon: cap.lon,
  };
  if (isPhoto) {
    const bmp = await decodeImage(file);
    item.width = bmp.width;
    item.height = bmp.height;
    bmp.close();
  } else {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('Keine Videospur');
      item.width = await track.getDisplayWidth();
      item.height = await track.getDisplayHeight();
      item.duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
      if (!cap.date) {
        const tags = await input.getMetadataTags().catch(() => null);
        if (tags?.date && tags.date.getFullYear() > 2000) item.created = tags.date.getTime();
      }
    } finally {
      input.dispose();
    }
  }
  return item;
}

// MARK: Vorschaubilder

const thumbMem = new Map<string, string>();
const thumbPending = new Map<string, Promise<string | null>>();

/** Liefert eine Objekt-URL für ein kleines Vorschaubild (wird erzeugt und zwischengespeichert). */
export function thumbnailURL(id: string): Promise<string | null> {
  const m = thumbMem.get(id);
  if (m) return Promise.resolve(m);
  let p = thumbPending.get(id);
  if (!p) {
    p = (async () => {
      let blob = await dbGet<Blob>('cache', 'thumb:' + id);
      if (!blob) {
        const item = media.value[id];
        if (!item) return null;
        blob = await makeThumbnail(item).catch(() => undefined);
        if (!blob) return null;
        await dbPut('cache', 'thumb:' + id, blob);
      }
      const url = URL.createObjectURL(blob);
      thumbMem.set(id, url);
      return url;
    })();
    thumbPending.set(id, p);
  }
  return p;
}

const previewMem = new Map<string, Promise<string | null>>();

/** Größeres Vorschaubild (Seitenverhältnis bleibt erhalten), z. B. für den Bildausschnitt. */
export function previewURL(id: string): Promise<string | null> {
  let p = previewMem.get(id);
  if (!p) {
    p = (async () => {
      const item = media.value[id];
      if (!item) return null;
      const s = Math.min(1, 900 / Math.max(item.width || 900, item.height || 900));
      const w = Math.max(2, Math.round((item.width || 900) * s)), h = Math.max(2, Math.round((item.height || 900) * s));
      const blob = await makeThumbnail(item, w, h).catch(() => null);
      return blob ? URL.createObjectURL(blob) : null;
    })();
    previewMem.set(id, p);
  }
  return p;
}

async function makeThumbnail(item: MediaItem, size = 240, height = size): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, height);
  const ctx = canvas.getContext('2d')!;
  const src = await getBlob(item.id);
  if (item.isPhoto) {
    const bmp = await decodeImage(src, 1200);
    drawCover(ctx, bmp, bmp.width, bmp.height, size, height);
    bmp.close();
  } else {
    const input = new Input({ source: new BlobSource(src), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('Keine Videospur');
      const sink = new VideoSampleSink(track);
      const sample = await sink.getSample(Math.min(1, item.duration / 2));
      if (!sample) throw new Error('Kein Bild');
      sample.drawWithFit(ctx, { fit: 'cover' });
      sample.close();
    } finally {
      input.dispose();
    }
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

function drawCover(ctx: OffscreenCanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, cw: number, ch: number) {
  const s = Math.max(cw / w, ch / h);
  ctx.drawImage(img, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
}

// MARK: Musik

export async function importSongs(files: File[]): Promise<{ added: number; failed: string[] }> {
  const list = files.filter(isAudioFile);
  const res = { added: 0, failed: [] as string[] };
  importState.value = { label: 'Importiere Musik', done: 0, total: list.length };
  for (const [i, file] of list.entries()) {
    importState.value = { label: 'Importiere Musik', done: i, total: list.length };
    const existing = songs.value.find((s) => s.name === baseName(file.name) && s.size === file.size);
    if (existing) continue;
    try {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      let duration = 0;
      try {
        duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
      } finally {
        input.dispose();
      }
      const song: Song = { id: uid(), name: baseName(file.name), duration, size: file.size };
      await dbPut('blobs', song.id, file);
      await dbPut('songs', song.id, song);
      songs.value = [...songs.value, song].sort((a, b) => a.name.localeCompare(b.name, 'de'));
      res.added++;
    } catch (e) {
      console.warn('Musik-Import fehlgeschlagen', file.name, e);
      res.failed.push(file.name);
    }
  }
  importState.value = null;
  return res;
}

export async function deleteSong(id: string) {
  await dbDelete('songs', id);
  await dbDelete('blobs', id);
  await dbDelete('cache', 'beats:' + id);
  blobCache.delete(id);
  songs.value = songs.value.filter((s) => s.id !== id);
}

// MARK: LUTs

export async function importLUT(file: File, parse: (t: string) => unknown): Promise<string> {
  const text = await file.text();
  if (!parse(text)) throw new Error('Die Datei ist keine gültige 3D-LUT (.cube).');
  const existing = luts.value.find((l) => l.name === file.name);
  const lut: LUTFile = { id: existing?.id ?? uid(), name: file.name, text };
  await dbPut('luts', lut.id, lut);
  luts.value = [...luts.value.filter((l) => l.id !== lut.id), lut].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return lut.name;
}

export async function deleteLUT(id: string) {
  await dbDelete('luts', id);
  luts.value = luts.value.filter((l) => l.id !== id);
}
