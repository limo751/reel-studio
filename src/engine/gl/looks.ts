// Look-Daten für den Shader – Port von Engine/Looks.swift (Presets, Tonkurven, LUTs).
import type { Look, LookPreset } from '../../model/project';

export interface LUTData { size: number; data: Float32Array /* RGBA, Rot läuft am schnellsten */ }

type Pt = [number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Tonkurven der Presets (identische Stützpunkte wie in der App). */
export const PRESET_CURVES: Partial<Record<LookPreset, Pt[]>> = {
  cinematic: [[0, 0.02], [0.25, 0.21], [0.5, 0.5], [0.75, 0.8], [1, 0.98]],
  vintage: [[0, 0.09], [0.25, 0.28], [0.5, 0.52], [0.75, 0.74], [1, 0.92]],
  matte: [[0, 0.1], [0.25, 0.3], [0.5, 0.52], [0.75, 0.73], [1, 0.9]],
  noir: [[0, 0], [0.25, 0.17], [0.5, 0.5], [0.75, 0.84], [1, 1]],
};

export const PRESET_ID: Record<LookPreset, number> = {
  none: 0, cinematic: 1, blackWhite: 2, summer: 3, vintage: 4, cool: 5, matte: 6, vivid: 7, noir: 8,
};

export function manualCurve(l: Look): Pt[] | null {
  if (l.highlights === 0 && l.shadows === 0) return null;
  return [
    [0, 0],
    [0.25, 0.25 + 0.12 * l.shadows],
    [0.5, 0.5 + 0.03 * (l.shadows + l.highlights)],
    [0.75, 0.75 + 0.12 * l.highlights],
    [1, 1],
  ];
}

/** Monotone kubische Interpolation (wie CIToneCurve ohne Überschwinger) → 256 Werte. */
export function curveTable(points: Pt[]): Uint8Array {
  const p = points.map(([x, y]) => [x, Math.min(1, Math.max(0, y))] as Pt);
  const n = p.length;
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const out = new Uint8Array(256 * 4);
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0];
    const t = (x - p[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    const v = Math.round(Math.min(1, Math.max(0, y)) * 255);
    out.set([v, v, v, 255], k * 4);
  }
  return out;
}

/** Teal & Orange: Schatten Richtung Petrol, Hauttöne/Lichter Richtung Orange. */
export const CINEMATIC_LUT: LUTData = (() => {
  const n = 32;
  const data = new Float32Array(n * n * n * 4);
  let o = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    let R = r / (n - 1), G = g / (n - 1), B = b / (n - 1);
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const shadow = Math.max(0, 1 - lum * 2);
    const high = Math.max(0, lum * 2 - 1);
    R += -0.05 * shadow + 0.07 * high;
    G += 0.02 * shadow + 0.02 * high;
    B += 0.07 * shadow - 0.07 * high;
    const l2 = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    R = l2 + (R - l2) * 0.92;
    G = l2 + (G - l2) * 0.92;
    B = l2 + (B - l2) * 0.92;
    data[o++] = clamp01(R); data[o++] = clamp01(G); data[o++] = clamp01(B); data[o++] = 1;
  }
  return { size: n, data };
})();


/** Liest eine .cube-Datei (Rot läuft am schnellsten). */
export function parseCube(text: string): LUTData | null {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('TITLE') || t.startsWith('DOMAIN_')) continue;
    const parts = t.split(/\s+/);
    if (parts[0] === 'LUT_3D_SIZE' && parts.length > 1) { size = parseInt(parts[1], 10) || 0; continue; }
    if (parts[0] === 'LUT_1D_SIZE') return null;
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) values.push(r, g, b, 1);
    }
  }
  if (size < 2 || size > 128 || values.length !== size * size * size * 4) return null;
  return { size, data: new Float32Array(values) };
}

/** Auto-Korrektur aus Bildstatistik: gedämpfter Weißabgleich + Belichtungsausgleich. */
export interface AutoAdjust { gains: [number, number, number]; gamma: number }

export function computeAutoAdjust(rgba: Uint8ClampedArray): AutoAdjust {
  let r = 0, g = 0, b = 0, n = 0, lsum = 0, all = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const R = rgba[i] / 255, G = rgba[i + 1] / 255, B = rgba[i + 2] / 255;
    const L = 0.299 * R + 0.587 * G + 0.114 * B;
    lsum += L; all++;
    if (L > 0.15 && L < 0.85) { r += R; g += G; b += B; n++; }
  }
  const luma = all ? lsum / all : 0.46;
  if (n < 20) return { gains: [1, 1, 1], gamma: 1 };
  const mean = [r / n, g / n, b / n].map((v) => Math.max(0.05, v));
  const gray = (mean[0] + mean[1] + mean[2]) / 3;
  // Farbstich nur teilweise neutralisieren – die Stimmung soll bleiben
  let gains = mean.map((v) => Math.min(1.15, Math.max(0.87, 1 + 0.45 * (gray / v - 1))));
  const avg = (gains[0] + gains[1] + gains[2]) / 3;
  gains = gains.map((v) => v / avg);
  const L = Math.min(0.95, Math.max(0.05, luma));
  let gamma = Math.log(0.46) / Math.log(L); // Ausgabe = Eingabe ^ gamma
  gamma = 1 + 0.6 * (gamma - 1);
  gamma = Math.min(1.35, Math.max(0.75, gamma));
  return { gains: gains as [number, number, number], gamma };
}
