// Datenmodell – entspricht Model/Project.swift der iOS-App.

export interface RGBA { r: number; g: number; b: number; a?: number }
export const WHITE: RGBA = { r: 1, g: 1, b: 1 };
export const BLACK: RGBA = { r: 0, g: 0, b: 0 };
export const SLATE: RGBA = { r: 0.09, g: 0.1, b: 0.12 };

export type AspectFormat = 'portrait' | 'landscape';
export const FORMAT_LABEL: Record<AspectFormat, string> = { portrait: 'Hochkant 9:16', landscape: 'Querformat 16:9' };
export function renderSize(f: AspectFormat) {
  return f === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export type AreaKind = 'empty' | 'photo' | 'video' | 'reel' | 'color';
export const AREA_KINDS: AreaKind[] = ['empty', 'photo', 'video', 'reel', 'color'];
export const AREA_KIND_LABEL: Record<AreaKind, string> = {
  empty: 'Leer', photo: 'Foto', video: 'Video', reel: 'Reel', color: 'Farbe',
};

// MARK: Übergänge

export type TransitionKind =
  | 'cut' | 'dissolve' | 'fadeBlack' | 'fadeWhite'
  | 'wipeLeft' | 'wipeRight' | 'wipeUp' | 'wipeDown'
  | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown'
  | 'zoom' | 'blur' | 'circle';
export const TRANSITION_LABEL: Record<TransitionKind, string> = {
  cut: 'Harter Schnitt', dissolve: 'Überblenden', fadeBlack: 'Schwarzblende', fadeWhite: 'Weißblende',
  wipeLeft: 'Wischen ←', wipeRight: 'Wischen →', wipeUp: 'Wischen ↑', wipeDown: 'Wischen ↓',
  slideLeft: 'Schieben ←', slideRight: 'Schieben →', slideUp: 'Schieben ↑', slideDown: 'Schieben ↓',
  zoom: 'Zoom', blur: 'Unschärfe', circle: 'Kreis',
};
export const TRANSITION_KINDS = Object.keys(TRANSITION_LABEL) as TransitionKind[];

export interface TransitionSpec { kind: TransitionKind; duration: number }
export const defaultTransition = (): TransitionSpec => ({ kind: 'dissolve', duration: 0.5 });

/** Bildausschnitt: scale ≥ 1, x/y von -1 (links/oben) bis 1 (rechts/unten). */
export interface Crop { scale: number; x: number; y: number }
export const defaultCrop = (): Crop => ({ scale: 1, x: 0, y: 0 });

// MARK: Look

export type LookPreset = 'none' | 'cinematic' | 'blackWhite' | 'summer' | 'vintage' | 'cool' | 'matte' | 'vivid' | 'noir';
export const LOOK_PRESET_LABEL: Record<LookPreset, string> = {
  none: 'Original', cinematic: 'Cinematisch', blackWhite: 'Schwarz-Weiß', summer: 'Sommer', vintage: 'Vintage',
  cool: 'Kühl', matte: 'Matt', vivid: 'Kräftig', noir: 'Noir',
};
export const LOOK_PRESETS = Object.keys(LOOK_PRESET_LABEL) as LookPreset[];

export interface Look {
  preset: LookPreset;
  presetAmount: number;
  exposure: number;     // Blendenstufen, -2…2
  contrast: number;     // -1…1
  saturation: number;   // -1…1
  vibrance: number;     // -1…1
  temperature: number;  // -1 (kühl) … 1 (warm)
  tint: number;         // -1 (grün) … 1 (magenta)
  highlights: number;   // -1…1
  shadows: number;      // -1…1
  lutName: string | null;
  lutAmount: number;
  autoCorrect: boolean;
}
export const defaultLook = (): Look => ({
  preset: 'none', presetAmount: 1, exposure: 0, contrast: 0, saturation: 0, vibrance: 0,
  temperature: 0, tint: 0, highlights: 0, shadows: 0, lutName: null, lutAmount: 1, autoCorrect: true,
});

// MARK: Ton & Titel

export interface AudioSetting { enabled: boolean; volume: number }

export type TitleStyle = 'shadow' | 'outline' | 'box' | 'plain';
export const TITLE_STYLE_LABEL: Record<TitleStyle, string> = { shadow: 'Schatten', outline: 'Umriss', box: 'Box', plain: 'Schlicht' };
export type TitlePosition = 'top' | 'center' | 'bottom';
export const TITLE_POSITION_LABEL: Record<TitlePosition, string> = { top: 'Oben', center: 'Mitte', bottom: 'Unten' };

export interface TitleSpec {
  enabled: boolean;
  text: string;
  subtitle: string;
  font: string;
  style: TitleStyle;
  position: TitlePosition;
  size: number;         // Anteil an der kürzeren Seite des Bereichs
  color: RGBA;
  uppercase: boolean;
  start: number;
  duration: number;
  fullLength: boolean;
}
export const defaultTitle = (): TitleSpec => ({
  enabled: false, text: '', subtitle: '', font: 'AvenirNext-Bold', style: 'shadow', position: 'center',
  size: 0.09, color: { ...WHITE }, uppercase: false, start: 0, duration: 10, fullLength: false,
});
export const titleVisible = (t: TitleSpec) => t.enabled && (t.text + t.subtitle).trim().length > 0;

// MARK: Bereiche

export interface ReelClip {
  id: string;
  assetID: string;
  isPhoto: boolean;
  sourceDuration: number;
  sourceStart: number;   // Stelle im Clip, die auf dem Schnitt (Beat) liegt
  beats: number;
  transition: TransitionSpec;  // Übergang zum nächsten Clip
  volume: number;
  crop: Crop;
  speed?: number;    // Tempo-Rampe: Zieltempo 1 … 10 (fehlt = 1)
  rampIn?: number;   // Sekunden zum Beschleunigen (Fade-in)
  rampOut?: number;  // Sekunden zum Abbremsen (Fade-out)
}

export type EndBehavior = 'loop' | 'freeze' | 'slow';
export const END_BEHAVIOR_LABEL: Record<EndBehavior, string> = { loop: 'Wiederholen', freeze: 'Letztes Bild halten', slow: 'Verlangsamen' };

export interface PhotoSlot { assetID: string | null; crop: Crop; kenBurns: boolean }
export interface VideoSlot { assetID: string | null; sourceDuration: number; start: number; crop: Crop; endBehavior: EndBehavior }
export interface ReelSlot {
  albumID: string | null;
  albumName: string | null;
  clips: ReelClip[];
  rhythm: number;        // 0 = automatisch, sonst Beats pro Clip
  offsetBeats: number;   // Versatz der Schnitte gegenüber anderen Bereichen
  defaultTransition: TransitionSpec;
}

export interface Area {
  id: string;
  kind: AreaKind;
  photo: PhotoSlot;
  video: VideoSlot;
  reel: ReelSlot;
  fill: RGBA;
  look: Look;
  audio: AudioSetting;
  title: TitleSpec;
}

export function newArea(kind: AreaKind = 'empty'): Area {
  return {
    id: uid(), kind,
    photo: { assetID: null, crop: defaultCrop(), kenBurns: true },
    video: { assetID: null, sourceDuration: 0, start: 0, crop: defaultCrop(), endBehavior: 'loop' },
    reel: { albumID: null, albumName: null, clips: [], rhythm: 0, offsetBeats: 0, defaultTransition: defaultTransition() },
    fill: { ...SLATE }, look: defaultLook(), audio: { enabled: false, volume: 1 }, title: defaultTitle(),
  };
}

// MARK: Layout, Musik, Projekt

export type DividerThickness = 'thin' | 'thick';
export const dividerPixels = (t: DividerThickness) => (t === 'thin' ? 5 : 16);
export interface DividerStyle { enabled: boolean; color: RGBA; thickness: DividerThickness }

export interface MusicSettings {
  song: string | null;   // ID in der Musikbibliothek
  start: number;         // Startpunkt im Song (auf Beat eingerastet)
  volume: number;
  fadeOut: number;
  ducking: boolean;
  duckLevel: number;
  includeInExport: boolean;
}

export interface Project {
  id: string;
  title: string;
  created: number;
  modified: number;
  targetDuration: number;
  format: AspectFormat;
  areas: Area[];
  weights: number[];
  divider: DividerStyle;
  music: MusicSettings;
  globalTitle: TitleSpec;
}

export const DURATIONS = [30, 60, 90, 120];

export function newProject(title: string, duration: number, format: AspectFormat, areaCount: number): Project {
  const n = Math.max(1, Math.min(3, areaCount));
  const areas = Array.from({ length: n }, (_, i) => newArea(i === 0 ? 'reel' : 'empty'));
  const t = defaultTitle();
  t.enabled = true;
  t.text = title;
  return {
    id: uid(), title, created: Date.now(), modified: Date.now(), targetDuration: duration, format, areas,
    weights: areas.map(() => 1),
    divider: { enabled: false, color: { ...WHITE }, thickness: 'thin' },
    music: { song: null, start: 0, volume: 1, fadeOut: 3, ducking: true, duckLevel: 0.3, includeInExport: true },
    globalTitle: t,
  };
}

export function setAreaCount(p: Project, count: number) {
  const n = Math.max(1, Math.min(3, count));
  while (p.areas.length < n) p.areas.push(newArea());
  if (p.areas.length > n) p.areas.splice(n);
  p.weights = p.areas.map(() => 1);
}

// MARK: Layout-Berechnung

export interface Rect { x: number; y: number; width: number; height: number }

/** Bereichs-Rechtecke in Bildkoordinaten (Ursprung oben links). */
export function layoutRects(format: AspectFormat, weights: number[], size = renderSize(format)): Rect[] {
  const w = weights.map((v) => Math.max(0.05, v));
  const total = w.reduce((a, b) => a + b, 0);
  const rects: Rect[] = [];
  let pos = 0;
  w.forEach((wi, i) => {
    if (format === 'portrait') {
      const h = i === w.length - 1 ? size.height - pos : Math.round(size.height * (wi / total));
      rects.push({ x: 0, y: pos, width: size.width, height: h });
      pos += h;
    } else {
      const width = i === w.length - 1 ? size.width - pos : Math.round(size.width * (wi / total));
      rects.push({ x: pos, y: 0, width, height: size.height });
      pos += width;
    }
  });
  return rects;
}

export function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const clone = <T>(v: T): T => structuredClone(v);
