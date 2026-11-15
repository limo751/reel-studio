// Aufbau des Render-Plans – Port von Engine/CompositionBuilder.swift (ohne AVFoundation).
// Der Plan beschreibt pro Bereich, welches Medium wann mit welchem Quellzeitpunkt zu sehen ist,
// außerdem Titel, Trennlinien und die Ton-Hüllkurven (Musik, Originalton, Ducking).
import { BeatGrid, type BeatAnalysis } from './beats';
import { resolve, visibleEnd, visibleStart } from './planner';
import {
  dividerPixels, layoutRects, renderSize, titleVisible,
  type AreaKind, type Crop, type Look, type Project, type Rect, type RGBA, type TitleSpec, type TransitionKind,
} from '../model/project';

/** Abbildung Zeitachse → Quellzeit eines Videos. */
export type TimeMap =
  | { mode: 'linear'; insertAt: number; srcStart: number; rate: number; srcMax: number }
  | { mode: 'loop'; start: number; srcDur: number }
  | { mode: 'freeze'; start: number; srcDur: number }
  | { mode: 'slow'; start: number; avail: number; duration: number };

export interface SegmentRender {
  assetID: string;
  isPhoto: boolean;
  visibleStart: number;
  visibleEnd: number;
  cutIn: number;
  inTransition: TransitionKind;
  inDuration: number;
  crop: Crop;
  kenBurns: boolean;
  time: TimeMap | null;     // null bei Fotos
  autoAt: number;           // Quellzeit für die Auto-Korrektur
}

export interface AreaRender {
  rect: Rect;               // Bildkoordinaten, Ursprung oben links
  kind: AreaKind;
  fill: RGBA;
  look: Look;
  segments: SegmentRender[];
}

export interface TitleOverlay { spec: TitleSpec; rect: Rect; start: number; end: number }

export interface EnvelopePoint { t: number; v: number }

/** Ein Stück Originalton, das auf der Zeitachse liegt. */
export interface AudioClip {
  assetID: string;
  at: number;        // Start auf der Zeitachse
  srcStart: number;
  srcLen: number;
  length: number;    // Länge auf der Zeitachse (bei Streckung > srcLen)
  loop?: { srcDur: number };
  envelope: EnvelopePoint[];
}

export interface RenderPlan {
  width: number;
  height: number;
  duration: number;
  areas: AreaRender[];
  dividers: { rect: Rect; color: RGBA }[];
  titles: TitleOverlay[];
  audio: AudioClip[];
  music: { songId: string; start: number; envelope: EnvelopePoint[] } | null;
}

/** Quellzeit eines Video-Segments zum Zeitpunkt t (Sekunden auf der Zeitachse). */
export function sourceTime(m: TimeMap, t: number): number {
  switch (m.mode) {
    case 'linear': return Math.min(m.srcMax, m.srcStart + Math.max(0, t - m.insertAt) * m.rate);
    case 'loop': {
      // erster Durchlauf ab `start`, danach von vorn
      const first = m.srcDur - m.start;
      if (t < first) return m.start + t;
      return (t - first) % Math.max(0.05, m.srcDur);
    }
    case 'freeze': return Math.min(m.start + t, Math.max(0, m.srcDur - 0.04));
    case 'slow': return m.start + (t / Math.max(0.01, m.duration)) * m.avail;
  }
}

export interface MediaLookup { duration(assetID: string): number; hasAudio?(assetID: string): boolean }

export function reelDuration(project: Project, analysis: BeatAnalysis | null): number {
  const grid = new BeatGrid(project.music.song ? analysis : null, project.music.start);
  return project.music.song ? grid.snappedDuration(project.targetDuration) : project.targetDuration;
}

export function buildPlan(project: Project, analysis: BeatAnalysis | null, media: MediaLookup,
  opts: { includeMusic: boolean; scale?: number }): RenderPlan {
  const hasSong = !!project.music.song;
  const grid = new BeatGrid(hasSong ? analysis : null, project.music.start);
  const duration = reelDuration(project, analysis);
  const size = renderSize(project.format);
  const rects = layoutRects(project.format, project.weights);

  const areas: AreaRender[] = [];
  const titles: TitleOverlay[] = [];
  const audio: AudioClip[] = [];
  const audible: [number, number][] = [];

  project.areas.forEach((area, ai) => {
    const rect = rects[ai];
    const segments: SegmentRender[] = [];
    const audioOn = area.audio.enabled && area.audio.volume > 0;

    if (area.kind === 'photo' && area.photo.assetID) {
      segments.push({
        assetID: area.photo.assetID, isPhoto: true, visibleStart: 0, visibleEnd: duration + 1, cutIn: 0,
        inTransition: 'cut', inDuration: 0, crop: area.photo.crop, kenBurns: area.photo.kenBurns, time: null, autoAt: 0,
      });
    }

    if (area.kind === 'video' && area.video.assetID) {
      const id = area.video.assetID;
      const srcDur = media.duration(id) || area.video.sourceDuration;
      const start = Math.min(Math.max(0, area.video.start), Math.max(0, srcDur - 0.1));
      const avail = srcDur - start;
      let time: TimeMap;
      if (avail >= duration) time = { mode: 'linear', insertAt: 0, srcStart: start, rate: 1, srcMax: srcDur };
      else if (area.video.endBehavior === 'loop') time = { mode: 'loop', start, srcDur };
      else if (area.video.endBehavior === 'freeze') time = { mode: 'freeze', start, srcDur };
      else time = { mode: 'slow', start, avail, duration };
      segments.push({
        assetID: id, isPhoto: false, visibleStart: 0, visibleEnd: duration + 1, cutIn: 0, inTransition: 'cut',
        inDuration: 0, crop: area.video.crop, kenBurns: false, time, autoAt: start + 0.5,
      });
      if (audioOn && media.hasAudio?.(id) !== false) {
        const v = area.audio.volume;
        const env = [{ t: 0, v }, { t: Math.max(0, duration - 0.5), v }, { t: duration, v: 0 }];
        if (time.mode === 'linear') {
          audio.push({ assetID: id, at: 0, srcStart: start, srcLen: duration, length: duration, envelope: env });
        } else if (time.mode === 'loop') {
          audio.push({ assetID: id, at: 0, srcStart: start, srcLen: avail, length: duration, loop: { srcDur }, envelope: env });
        } else if (time.mode === 'freeze') {
          audio.push({ assetID: id, at: 0, srcStart: start, srcLen: avail, length: avail, envelope: env });
        } else {
          audio.push({ assetID: id, at: 0, srcStart: start, srcLen: avail, length: duration, envelope: env });
        }
        audible.push([0, duration]);
      }
    }

    if (area.kind === 'reel') {
      const timeline = resolve(area.reel, grid, duration);
      const trackEnds = [0, 0];
      timeline.forEach((seg, si) => {
        const lane = si % 2;
        const start = Math.max(visibleStart(seg), 0);
        const end = Math.min(visibleEnd(seg), duration);
        if (end - start <= 0.02) return;
        if (seg.isPhoto) {
          segments.push({
            assetID: seg.assetID, isPhoto: true, visibleStart: start, visibleEnd: end, cutIn: seg.cutIn,
            inTransition: seg.inTransition, inDuration: seg.inDuration, crop: seg.crop, kenBurns: true, time: null, autoAt: 0,
          });
          return;
        }
        const srcDur = media.duration(seg.assetID) || area.reel.clips[seg.clipIndex]?.sourceDuration || 0;
        const insertAt = Math.max(start, trackEnds[lane]);
        const wanted = end - insertAt;
        const srcStart = Math.min(seg.sourceStart + (insertAt - start), Math.max(0, srcDur - 0.1));
        const availLen = Math.min(wanted, srcDur - srcStart);
        if (availLen <= 0.02) return;
        const rate = availLen < wanted - 0.02 ? availLen / wanted : 1;
        trackEnds[lane] = insertAt + wanted;
        segments.push({
          assetID: seg.assetID, isPhoto: false, visibleStart: start, visibleEnd: end, cutIn: seg.cutIn,
          inTransition: seg.inTransition, inDuration: seg.inDuration, crop: seg.crop, kenBurns: false,
          time: { mode: 'linear', insertAt, srcStart, rate, srcMax: srcDur }, autoAt: srcStart + availLen / 2,
        });
        if (audioOn && seg.volume > 0 && media.hasAudio?.(seg.assetID) !== false) {
          const v = area.audio.volume * seg.volume;
          const fin = Math.max(0.05, seg.inDuration), fout = Math.max(0.05, seg.outDuration);
          audio.push({
            assetID: seg.assetID, at: insertAt, srcStart, srcLen: availLen, length: wanted,
            envelope: [
              { t: insertAt, v: 0 }, { t: insertAt + fin, v }, { t: insertAt + wanted - fout, v }, { t: insertAt + wanted, v: 0 },
            ],
          });
          audible.push([seg.cutIn, seg.cutOut]);
        }
      });
    }

    areas.push({ rect, kind: area.kind, fill: area.fill, look: area.look, segments });

    if (titleVisible(area.title)) {
      const end = area.title.fullLength ? duration : area.title.start + area.title.duration;
      titles.push({ spec: area.title, rect, start: area.title.fullLength ? 0 : area.title.start, end: Math.min(duration, end) });
    }
  });

  if (titleVisible(project.globalTitle)) {
    const g = project.globalTitle;
    const end = g.fullLength ? duration : g.start + g.duration;
    titles.push({ spec: g, rect: { x: 0, y: 0, ...size }, start: g.fullLength ? 0 : g.start, end: Math.min(duration, end) });
  }

  // Trennlinien
  const dividers: { rect: Rect; color: RGBA }[] = [];
  if (project.divider.enabled && rects.length > 1) {
    const th = dividerPixels(project.divider.thickness);
    for (const r of rects.slice(0, -1)) {
      dividers.push({
        color: project.divider.color,
        rect: project.format === 'portrait'
          ? { x: 0, y: r.y + r.height - th / 2, width: size.width, height: th }
          : { x: r.x + r.width - th / 2, y: 0, width: th, height: size.height },
      });
    }
  }

  // Musik mit Ducking und Ausblenden
  let music: RenderPlan['music'] = null;
  if (opts.includeMusic && hasSong && project.music.song) {
    const m = project.music;
    const v = m.volume;
    const duck = m.ducking ? v * m.duckLevel : v;
    let env: EnvelopePoint[] = [{ t: 0, v: 0 }, { t: 0.08, v }];
    for (const [a, b] of mergeRanges(audible)) {
      if (!m.ducking) break;
      env.push({ t: Math.max(0.08, a - 0.3), v }, { t: Math.max(0.08, a), v: duck },
        { t: Math.min(duration, b), v: duck }, { t: Math.min(duration, b + 0.3), v });
    }
    const fadeStart = Math.max(0.1, duration - m.fadeOut);
    env = env.filter((p) => p.t <= fadeStart);
    env.push({ t: fadeStart, v }, { t: duration, v: 0 });
    music = { songId: m.song!, start: m.start, envelope: env };
  }

  const scale = opts.scale ?? 1;
  const sc = (r: Rect): Rect => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });
  return {
    width: Math.round(size.width * scale), height: Math.round(size.height * scale), duration,
    areas: areas.map((a) => ({ ...a, rect: sc(a.rect) })),
    dividers: dividers.map((d) => ({ ...d, rect: sc(d.rect) })),
    titles: titles.map((t) => ({ ...t, rect: sc(t.rect) })),
    audio, music,
  };
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1] + 0.6) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** Lineare Interpolation einer Hüllkurve (wie AVMutableAudioMixInputParameters-Rampen). */
export function envelopeValue(env: EnvelopePoint[], t: number): number {
  const pts = [...env].sort((a, b) => a.t - b.t);
  if (!pts.length) return 0;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      return b.t - a.t < 1e-6 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return pts[pts.length - 1].v;
}
