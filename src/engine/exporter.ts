// Export als MP4 (H.264 1080p, 30 fps, AAC) – entspricht Exporter.swift + VideoWriter.swift.
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo,
  type AudioCodec, type VideoCodec,
} from 'mediabunny';
import { luts as lutFiles, media } from '../media/library';
import type { Project } from '../model/project';
import type { BeatAnalysis } from './beats';
import { renderMix } from './audio';
import { ExportFrames } from './frames';
import { Renderer } from './gl/renderer';
import { parseCube, type LUTData } from './gl/looks';
import { buildPlan, type RenderPlan } from './timeline';

export const FPS = 30;
export const VIDEO_BITRATE = 11_000_000;
export const AUDIO_BITRATE = 256_000;

export function lutMap(): Record<string, LUTData> {
  const out: Record<string, LUTData> = {};
  for (const l of lutFiles.value) {
    const d = parseCube(l.text);
    if (d) out[l.name] = d;
  }
  return out;
}

export const mediaLookup = {
  duration: (id: string) => media.value[id]?.duration ?? 0,
};

export function makePlan(project: Project, analysis: BeatAnalysis | null, includeMusic: boolean, scale = 1): RenderPlan {
  return buildPlan(project, analysis, mediaLookup, { includeMusic, scale });
}

export interface ExportOptions {
  includeMusic: boolean;
  scale?: number;               // 0.5 = schnelle Vorschau
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
}

async function pickVideoCodec(w: number, h: number): Promise<VideoCodec> {
  for (const c of ['avc', 'hevc'] as VideoCodec[]) {
    if (await canEncodeVideo(c, { width: w, height: h, bitrate: VIDEO_BITRATE })) return c;
  }
  throw new Error('Dieser Browser kann kein H.264-Video erzeugen. Bitte Safari ab iOS 17 verwenden.');
}

async function pickAudioCodec(): Promise<AudioCodec | null> {
  for (const c of ['aac', 'opus'] as AudioCodec[]) {
    if (await canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BITRATE })) return c;
  }
  return null;
}

/** Rendert das Reel und gibt die fertige MP4-Datei zurück. */
export async function exportReel(project: Project, analysis: BeatAnalysis | null, opts: ExportOptions): Promise<{ blob: Blob; duration: number; warning?: string }> {
  const plan = makePlan(project, analysis, opts.includeMusic, opts.scale ?? 1);
  const total = Math.round(plan.duration * FPS);
  const report = (p: number) => opts.onProgress?.(Math.min(1, Math.max(0, p)));
  const check = () => { if (opts.signal?.aborted) throw new DOMException('Export abgebrochen.', 'AbortError'); };

  report(0);
  const mix = await renderMix(plan, opts.signal);
  check();
  report(0.03);

  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const renderer = new Renderer(canvas);
  renderer.setPlan(plan, lutMap());
  const frames = new ExportFrames(plan, FPS);

  const vCodec = await pickVideoCodec(plan.width, plan.height);
  const aCodec = mix ? await pickAudioCodec() : null;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new CanvasSource(canvas, { codec: vCodec, bitrate: (opts.scale ?? 1) < 1 ? Math.round(VIDEO_BITRATE / 3) : VIDEO_BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = aCodec ? new AudioBufferSource({ codec: aCodec, bitrate: AUDIO_BITRATE }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  // Ton in 1-Sekunden-Stücken passend zum Bild einspeisen (gleichmäßig verschachtelt)
  let audioSec = 0;
  const feedAudio = async (upTo: number) => {
    if (!audio || !mix) return;
    while (audioSec < upTo && audioSec * mix.sampleRate < mix.length) {
      const from = audioSec * mix.sampleRate;
      const len = Math.min(mix.sampleRate, mix.length - from);
      const chunk = new AudioBuffer({ length: len, numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate });
      for (let c = 0; c < mix.numberOfChannels; c++) chunk.copyToChannel(mix.getChannelData(c).subarray(from, from + len), c);
      await audio.add(chunk);
      audioSec++;
    }
  };

  try {
    for (let i = 0; i < total; i++) {
      check();
      const t = i / FPS;
      const get = await frames.prepare(i, total);
      renderer.render(t, get);
      await video.add(t, 1 / FPS);
      await feedAudio(t + 1);
      report(0.03 + 0.95 * ((i + 1) / total));
    }
    await feedAudio(Infinity);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    frames.dispose();
    renderer.dispose();
  }
  report(1);
  const warning = mix && !aCodec ? 'Der Browser kann keinen Ton kodieren – das Video ist ohne Ton.' : undefined;
  return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), duration: plan.duration, warning };
}

export function exportFileName(title: string): string {
  const name = title.replace(/[/\\:*?"<>|]/g, '').trim() || 'Reel';
  return name.slice(0, 80) + '.mp4';
}
