// Tonmischung: Musik + Originalton mit Hüllkurven (Ducking, Ausblenden).
// Wird für Export und Vorschau gleichermaßen offline vorab berechnet.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { getBlob } from '../media/library';
import { decodeAudio } from './music';
import type { AudioClip, EnvelopePoint, RenderPlan } from './timeline';

export const MIX_RATE = 48000;

/** Holt nur den benötigten Ausschnitt der Tonspur eines Videos (spart Speicher bei großen Dateien). */
async function extractAudio(assetID: string, srcStart: number, srcLen: number): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(await getBlob(assetID)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioBufferSink(track);
    const parts: { buffer: AudioBuffer; timestamp: number }[] = [];
    for await (const w of sink.buffers(srcStart, srcStart + srcLen + 0.05)) parts.push(w);
    if (!parts.length) return null;
    const rate = parts[0].buffer.sampleRate;
    const channels = Math.min(2, parts[0].buffer.numberOfChannels);
    const length = Math.max(1, Math.ceil(srcLen * rate));
    const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
    for (const p of parts) {
      const offset = Math.round((p.timestamp - srcStart) * rate);
      for (let c = 0; c < channels; c++) {
        const src = p.buffer.getChannelData(Math.min(c, p.buffer.numberOfChannels - 1));
        const dst = out.getChannelData(c);
        const from = Math.max(0, -offset);
        const n = Math.min(src.length - from, length - (offset + from));
        if (n > 0) dst.set(src.subarray(from, from + n), offset + from);
      }
    }
    return out;
  } catch (e) {
    console.warn('Originalton nicht lesbar', e);
    return null;
  } finally {
    input.dispose();
  }
}

function applyEnvelope(param: AudioParam, env: EnvelopePoint[], duration: number) {
  const pts = [...env].sort((a, b) => a.t - b.t);
  if (!pts.length) { param.setValueAtTime(0, 0); return; }
  param.setValueAtTime(pts[0].v, 0);
  let prevT = 0;
  for (const p of pts) {
    const t = Math.min(Math.max(p.t, prevT), duration);
    if (t - prevT > 0.001) param.linearRampToValueAtTime(p.v, t);
    else param.setValueAtTime(p.v, t);
    prevT = t;
  }
}

/** Mischt den kompletten Ton des Reels. Gibt null zurück, wenn es keinen Ton gibt. */
export async function renderMix(plan: RenderPlan, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (!plan.music && !plan.audio.length) return null;
  const length = Math.ceil(plan.duration * MIX_RATE);
  const ctx = new OfflineAudioContext(2, length, MIX_RATE);
  // Begrenzer gegen Übersteuern, wenn Musik und Originalton zusammenkommen
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  const out = limiter;
  let any = false;

  if (plan.music) {
    try {
      const song = await decodeAudio(plan.music.songId);
      const src = ctx.createBufferSource();
      src.buffer = song;
      // Song wiederholen, falls er kürzer als das Reel ist (wie in der App)
      src.loop = song.duration - plan.music.start < plan.duration;
      if (src.loop) { src.loopStart = 0; src.loopEnd = song.duration; }
      const gain = ctx.createGain();
      applyEnvelope(gain.gain, plan.music.envelope, plan.duration);
      src.connect(gain).connect(out);
      src.start(0, Math.min(plan.music.start, Math.max(0, song.duration - 1)));
      any = true;
    } catch (e) {
      console.warn('Musik nicht lesbar', e);
    }
  }

  for (const clip of plan.audio) {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const buf = await extractAudio(clip.assetID, clip.srcStart, clip.loop ? clip.loop.srcDur - clip.srcStart : clip.srcLen);
    if (!buf) continue;
    const whole = clip.loop && clip.length > buf.duration + 0.05 ? await extractAudio(clip.assetID, 0, clip.loop.srcDur) : null;
    scheduleClip(ctx, out, clip, buf, plan.duration, whole);
    any = true;
  }
  if (!any) return null;
  return ctx.startRendering();
}

function scheduleClip(ctx: OfflineAudioContext, out: AudioNode, clip: AudioClip, buf: AudioBuffer, duration: number, whole: AudioBuffer | null) {
  const gain = ctx.createGain();
  applyEnvelope(gain.gain, clip.envelope, duration);
  gain.connect(out);
  if (clip.loop) {
    // erster Durchlauf ab Startpunkt, danach das ganze Video in Schleife – wie die Bildspur
    const first = ctx.createBufferSource();
    first.buffer = buf;
    first.connect(gain);
    first.start(clip.at);
    if (!whole) return;
    for (let t = clip.at + buf.duration; t < clip.at + clip.length - 0.05; t += whole.duration) {
      const s = ctx.createBufferSource();
      s.buffer = whole;
      s.connect(gain);
      s.start(t);
    }
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = clip.srcLen > 0 ? clip.srcLen / clip.length : 1;
  src.connect(gain);
  src.start(clip.at, 0);
  src.stop(clip.at + clip.length);
}
