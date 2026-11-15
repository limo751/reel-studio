// Musik laden und analysieren (mit Zwischenspeicher), entspricht MusicLibrary.analysis(for:).
import { dbGet, dbPut } from '../model/db';
import { getBlob } from '../media/library';
import { SAMPLE_RATE, type BeatAnalysis } from './beats';

const CACHE_VERSION = 'v3';
const memory = new Map<string, BeatAnalysis>();
const pending = new Map<string, Promise<BeatAnalysis>>();
const decoded = new Map<string, AudioBuffer>();

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

/** Dekodiert eine Audiodatei (Song oder Tonspur) in einen AudioBuffer. */
export async function decodeAudio(id: string): Promise<AudioBuffer> {
  const c = decoded.get(id);
  if (c) return c;
  const blob = await getBlob(id);
  const buf = await audioContext().decodeAudioData(await blob.arrayBuffer());
  decoded.set(id, buf);
  return buf;
}

async function monoSamples(buf: AudioBuffer): Promise<Float32Array> {
  const len = Math.ceil(buf.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, Math.max(1, len), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return new Float32Array(out.getChannelData(0)); // Kopie, damit sie an den Worker übergeben werden kann
}

export function analyzeSong(songId: string): Promise<BeatAnalysis> {
  const m = memory.get(songId);
  if (m) return Promise.resolve(m);
  let p = pending.get(songId);
  if (!p) {
    p = (async () => {
      const key = `beats:${songId}-${CACHE_VERSION}`;
      const cached = await dbGet<BeatAnalysis>('cache', key);
      if (cached) return cached;
      const samples = await monoSamples(await decodeAudio(songId));
      const worker = new Worker(new URL('./beats.worker.ts', import.meta.url), { type: 'module' });
      const result = await new Promise<BeatAnalysis>((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage(samples, [samples.buffer]);
      }).finally(() => worker.terminate());
      await dbPut('cache', key, result);
      return result;
    })();
    pending.set(songId, p);
    p.then((r) => memory.set(songId, r)).catch(() => pending.delete(songId));
  }
  return p;
}
