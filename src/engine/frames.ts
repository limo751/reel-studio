// Liefert für den Export Bild für Bild die passenden Video-/Fotoframes (frame-genau über WebCodecs).
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny';
import { decodeImage } from '../media/image';
import { getBlob } from '../media/library';
import type { FrameSource } from './gl/renderer';
import { sourceTime, type RenderPlan, type SegmentRender } from './timeline';

const MAX_SIDE = 2160;

/** Foto laden (verkleinert auf max. 2400 px, Ausrichtung aus EXIF). */
export async function loadPhoto(assetID: string): Promise<ImageBitmap> {
  return decodeImage(await getBlob(assetID), 2400);
}

export const isActive = (s: SegmentRender, t: number) => t >= s.visibleStart - 0.0001 && t < s.visibleEnd;

interface Feeder {
  frames: number[];        // Ausgabe-Frames, in denen das Segment sichtbar ist
  pos: number;
  iter: AsyncGenerator<VideoSample | null, void, unknown> | null;
  canvas: OffscreenCanvas;
  current: FrameSource | null;
  version: number;
}

/** Stellt pro Ausgabe-Frame die Bilder aller sichtbaren Segmente bereit. */
export class ExportFrames {
  private inputs = new Map<string, Promise<{ input: Input; track: InputVideoTrack }>>();
  private photos = new Map<string, Promise<FrameSource>>();
  private feeders = new Map<string, Feeder>();

  constructor(private plan: RenderPlan, private fps: number) {}

  private openVideo(assetID: string) {
    let p = this.inputs.get(assetID);
    if (!p) {
      p = (async () => {
        const input = new Input({ source: new BlobSource(await getBlob(assetID)), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('Ein Video hat keine Bildspur.');
        if (!(await track.canDecode())) throw new Error('Dieses Videoformat kann der Browser nicht dekodieren.');
        return { input, track };
      })();
      this.inputs.set(assetID, p);
    }
    return p;
  }

  private photo(assetID: string) {
    let p = this.photos.get(assetID);
    if (!p) {
      p = loadPhoto(assetID).then((bmp) => ({ source: bmp, width: bmp.width, height: bmp.height, rotation: 0 as const, version: 1 }));
      this.photos.set(assetID, p);
    }
    return p;
  }

  private async feeder(ai: number, si: number, seg: SegmentRender, total: number): Promise<Feeder> {
    const key = `${ai}:${si}`;
    let f = this.feeders.get(key);
    if (f) return f;
    const frames: number[] = [];
    const first = Math.max(0, Math.floor(seg.visibleStart * this.fps) - 1);
    for (let i = first; i < total && i / this.fps < seg.visibleEnd + 0.001; i++) if (isActive(seg, i / this.fps)) frames.push(i);
    const { track } = await this.openVideo(seg.assetID);
    const sink = new VideoSampleSink(track);
    const times = frames.map((i) => sourceTime(seg.time!, i / this.fps));
    const dw = await track.getDisplayWidth(), dh = await track.getDisplayHeight();
    // Nur so groß dekodieren/zeichnen wie nötig (Bereich × Zoom), maximal 2160 px
    const area = this.plan.areas[ai].rect;
    const need = Math.max(area.width, area.height) * Math.max(1, seg.crop.scale) * 1.15;
    const s = Math.min(1, Math.max(need, 720) / Math.max(dw, dh), MAX_SIDE / Math.max(dw, dh));
    const canvas = new OffscreenCanvas(Math.max(2, Math.round(dw * s)), Math.max(2, Math.round(dh * s)));
    f = { frames, pos: 0, iter: sink.samplesAtTimestamps(times), canvas, current: null, version: 0 };
    this.feeders.set(key, f);
    return f;
  }

  /** Bilder für Ausgabe-Frame `index` vorbereiten. Muss für jeden Frame genau einmal und in Reihenfolge aufgerufen werden. */
  async prepare(index: number, total: number): Promise<(ai: number, si: number) => FrameSource | null> {
    const t = index / this.fps;
    const result = new Map<string, FrameSource>();
    const jobs: Promise<void>[] = [];
    this.plan.areas.forEach((area, ai) => {
      area.segments.forEach((seg, si) => {
        if (!isActive(seg, t)) return;
        const key = `${ai}:${si}`;
        if (seg.isPhoto) {
          jobs.push(this.photo(seg.assetID).then((p) => { result.set(key, p); }));
          return;
        }
        jobs.push((async () => {
          const f = await this.feeder(ai, si, seg, total);
          while (f.pos < f.frames.length && f.frames[f.pos] < index) { await f.iter!.next().then((r) => r.value?.close()); f.pos++; }
          if (f.frames[f.pos] === index) {
            f.pos++;
            const r = await f.iter!.next();
            const sample = r.value;
            if (sample) {
              const ctx = f.canvas.getContext('2d')!;
              sample.drawWithFit(ctx, { fit: 'fill' });
              sample.close();
              f.current = { source: f.canvas, width: f.canvas.width, height: f.canvas.height, rotation: 0, version: ++f.version };
            }
          }
          if (f.current) result.set(key, f.current);
        })());
      });
    });
    await Promise.all(jobs);
    this.cleanup(t);
    return (ai, si) => result.get(`${ai}:${si}`) ?? null;
  }

  /** Beendete Segmente schließen (Decoder freigeben). */
  private cleanup(t: number) {
    for (const [key, f] of this.feeders) {
      const [ai, si] = key.split(':').map(Number);
      if (t >= this.plan.areas[ai].segments[si].visibleEnd && f.iter) {
        void f.iter.return(undefined);
        f.iter = null;
        this.feeders.set(key, { ...f, current: null });
      }
    }
  }

  dispose() {
    for (const f of this.feeders.values()) void f.iter?.return(undefined);
    for (const p of this.inputs.values()) p.then((v) => v.input.dispose()).catch(() => {});
    for (const p of this.photos.values()) p.then((v) => (v.source as ImageBitmap).close()).catch(() => {});
  }
}
