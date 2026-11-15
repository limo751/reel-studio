// Schnittplanung – Port von Engine/Planner.swift.
import type { BeatGrid } from './beats';
import { clipRamp, rampSource } from './ramp';
import { defaultCrop, uid, type Crop, type ReelClip, type ReelSlot, type TransitionKind, type TransitionSpec } from '../model/project';

/** Minimalinfo zu einem Medium. */
export interface MediaInfo { id: string; isPhoto: boolean; duration: number; created: number | null }

/** Ein aufgelöster Abschnitt eines Bereichs auf der Zeitachse. */
export interface TimelineSegment {
  clipIndex: number;
  assetID: string;
  isPhoto: boolean;
  cutIn: number;          // Schnittzeitpunkt (Beat) zu Beginn
  cutOut: number;         // Schnittzeitpunkt (Beat) am Ende
  inTransition: TransitionKind;
  inDuration: number;     // effektive Übergangsdauer (mittig auf cutIn)
  outTransition: TransitionKind;
  outDuration: number;
  sourceStart: number;    // Quellzeit am Beginn des sichtbaren Fensters
  sourceDuration: number;
  volume: number;
  crop: Crop;
}

export const visibleStart = (s: TimelineSegment) => s.cutIn - s.inDuration / 2;
export const visibleEnd = (s: TimelineSegment) => s.cutOut + s.outDuration / 2;

/** Erstellt einen Schnittplan für einen Reel-Bereich aus den Medien eines Ordners. */
export function planReel(media: MediaInfo[], grid: BeatGrid, duration: number,
  rhythm: number, offsetBeats: number, transition: TransitionSpec): ReelClip[] {
  const usable = media.filter((m) => m.isPhoto || m.duration >= 0.6)
    .sort((a, b) => (a.created ?? -Infinity) - (b.created ?? -Infinity));
  if (!usable.length) return [];
  const n = rhythm > 0 ? rhythm : grid.autoBeatsPerClip;
  const totalBeats = grid.beatIndex(duration) + offsetBeats;
  const needed = Math.max(1, Math.ceil(totalBeats / n));

  let chosen: [MediaInfo, number][] = [];
  if (usable.length >= needed) {
    const step = usable.length / needed;
    chosen = Array.from({ length: needed }, (_, i) => [usable[Math.floor(i * step)], 0]);
  } else {
    let occ = 0;
    while (chosen.length < needed) {
      for (const m of usable) if (chosen.length < needed) chosen.push([m, occ]);
      occ++;
    }
  }

  const segLen = n * grid.period;
  return chosen.map(([m, occ]) => {
    let start = 0;
    if (!m.isPhoto) {
      const slack = Math.max(0, m.duration - segLen - transition.duration);
      const pos = [0.5, 0.15, 0.85, 0.35][occ % 4];
      start = transition.duration / 2 + slack * pos;
      start = Math.min(start, Math.max(0, m.duration - 0.5));
    }
    return newClip(m, start, n, transition);
  });
}

export function newClip(m: MediaInfo, sourceStart: number, beats: number, transition: TransitionSpec): ReelClip {
  return {
    id: uid(), assetID: m.id, isPhoto: m.isPhoto, sourceDuration: m.duration, sourceStart, beats,
    transition: { ...transition }, volume: 1, crop: defaultCrop(),
  };
}

/** Wandelt die Clip-Liste eines Reel-Bereichs in Zeitachsen-Segmente um. */
export function resolve(reel: ReelSlot, grid: BeatGrid, duration: number): TimelineSegment[] {
  const clips = reel.clips;
  if (!clips.length || duration <= 0) return [];

  // 1. Schnittzeitpunkte bestimmen (Clips wiederholen sich, falls die Liste nicht reicht)
  const raw: { index: number; cutIn: number; cutOut: number }[] = [];
  let beat = 0;
  let first = true;
  for (let i = 0; ; i++) {
    const clip = clips[i % clips.length];
    const beats = Math.max(1, clip.beats) + (first ? Math.max(0, reel.offsetBeats) : 0);
    first = false;
    const cutIn = grid.time(beat);
    beat += beats;
    let cutOut = grid.time(beat);
    const isLast = cutOut >= duration - 0.05;
    if (isLast) cutOut = duration;
    raw.push({ index: i % clips.length, cutIn, cutOut });
    if (isLast || raw.length > 2000) break;
  }

  // 2. Übergänge (mittig auf dem Schnitt) mit begrenzter Dauer
  const trans: [TransitionKind, number][] = [];
  for (let k = 0; k < raw.length - 1; k++) {
    const spec = clips[raw[k].index].transition;
    if (spec.kind === 'cut') {
      trans.push(['cut', 0]);
    } else {
      const lenA = raw[k].cutOut - raw[k].cutIn;
      const lenB = raw[k + 1].cutOut - raw[k + 1].cutIn;
      trans.push([spec.kind, Math.max(0.1, Math.min(spec.duration, 0.8 * Math.min(lenA, lenB)))]);
    }
  }

  // 3. Quellbereiche berechnen
  return raw.map((r, k) => {
    const clip = clips[r.index];
    const inT = k > 0 ? trans[k - 1] : (['cut', 0] as [TransitionKind, number]);
    const outT = k < trans.length ? trans[k] : (['cut', 0] as [TransitionKind, number]);
    const seg: TimelineSegment = {
      clipIndex: r.index, assetID: clip.assetID, isPhoto: clip.isPhoto, cutIn: r.cutIn, cutOut: r.cutOut,
      inTransition: inT[0], inDuration: inT[1], outTransition: outT[0], outDuration: outT[1],
      sourceStart: 0, sourceDuration: 0, volume: clip.volume, crop: clip.crop,
    };
    if (!clip.isPhoto) {
      // Mit Tempo-Rampe wird mehr Material verbraucht als Zeit vergeht
      const len = visibleEnd(seg) - visibleStart(seg);
      const ramp = clipRamp(clip, len);
      const need = ramp ? rampSource(ramp, len) : len;
      let s = clip.sourceStart - (ramp ? rampSource(ramp, seg.inDuration / 2) : seg.inDuration / 2);
      if (s + need > clip.sourceDuration) s = clip.sourceDuration - need;
      s = Math.max(0, s);
      seg.sourceStart = s;
      seg.sourceDuration = Math.min(need, clip.sourceDuration - s);
    }
    return seg;
  });
}

/** Setzt bei geändertem Rhythmus alle Clips auf die neue Beat-Anzahl. */
export function applyRhythm(rhythm: number, reel: ReelSlot, grid: BeatGrid) {
  const n = rhythm > 0 ? rhythm : grid.autoBeatsPerClip;
  reel.rhythm = rhythm;
  for (const c of reel.clips) c.beats = n;
}
