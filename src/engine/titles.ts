// Titel als transparentes Bild – Port von Engine/TitleRenderer.swift (Canvas statt UIKit).
import type { TitleSpec } from '../model/project';

/** Gleiche Schriftliste wie in der App. Auf dem iPhone sind alle diese Schriften vorhanden. */
export const TITLE_FONTS: { name: string; label: string; css: string; weight: string; style?: string }[] = [
  { name: 'AvenirNext-Bold', label: 'Avenir Next', css: '"Avenir Next", Avenir, "Helvetica Neue", sans-serif', weight: '700' },
  { name: 'AvenirNext-Heavy', label: 'Avenir Next Heavy', css: '"Avenir Next", Avenir, "Helvetica Neue", sans-serif', weight: '800' },
  { name: 'HelveticaNeue-Bold', label: 'Helvetica Neue', css: '"Helvetica Neue", Helvetica, Arial, sans-serif', weight: '700' },
  { name: 'HelveticaNeue-CondensedBlack', label: 'Helvetica Condensed', css: '"Helvetica Neue Condensed Black", "HelveticaNeue-CondensedBlack", "Arial Narrow", sans-serif', weight: '900' },
  { name: 'Futura-Bold', label: 'Futura', css: 'Futura, "Century Gothic", sans-serif', weight: '700' },
  { name: 'Futura-CondensedExtraBold', label: 'Futura Condensed', css: '"Futura Condensed ExtraBold", "Futura-CondensedExtraBold", Futura, sans-serif', weight: '800' },
  { name: 'GillSans-Bold', label: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", sans-serif', weight: '700' },
  { name: 'Didot-Bold', label: 'Didot', css: 'Didot, "Bodoni 72", serif', weight: '700' },
  { name: 'Georgia-Bold', label: 'Georgia', css: 'Georgia, serif', weight: '700' },
  { name: 'Baskerville-Bold', label: 'Baskerville', css: 'Baskerville, "Baskerville Old Face", serif', weight: '700' },
  { name: 'AmericanTypewriter-Bold', label: 'Typewriter', css: '"American Typewriter", "Courier New", monospace', weight: '700' },
  { name: 'Copperplate-Bold', label: 'Copperplate', css: 'Copperplate, "Copperplate Gothic Bold", serif', weight: '700' },
  { name: 'Noteworthy-Bold', label: 'Noteworthy', css: 'Noteworthy, "Comic Sans MS", cursive', weight: '700' },
  { name: 'MarkerFelt-Wide', label: 'Marker Felt', css: '"Marker Felt", "Comic Sans MS", cursive', weight: '700' },
  { name: 'SnellRoundhand-Black', label: 'Snell Roundhand', css: '"Snell Roundhand", "Brush Script MT", cursive', weight: '900' },
  { name: 'ChalkboardSE-Bold', label: 'Chalkboard', css: '"Chalkboard SE", Chalkboard, "Comic Sans MS", cursive', weight: '700' },
  { name: 'System-Rounded', label: 'SF Rounded', css: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif', weight: '800' },
];

export function fontCSS(name: string, px: number): string {
  const f = TITLE_FONTS.find((x) => x.name === name) ?? TITLE_FONTS[0];
  return `${f.weight} ${Math.round(px)}px ${f.css}`;
}

function wrap(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** Rendert einen Titel als transparentes Bild in Bereichsgröße. */
export function renderTitle(spec: TitleSpec, width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  const w = Math.round(width), h = Math.round(height);
  if (w <= 10 || h <= 10) return null;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const text = spec.uppercase ? spec.text.toLocaleUpperCase('de') : spec.text;
  const sub = spec.uppercase ? spec.subtitle.toLocaleUpperCase('de') : spec.subtitle;
  const base = Math.min(w, h);
  const fontSize = Math.max(14, base * spec.size);
  const subSize = Math.max(10, fontSize * 0.45);
  const maxW = w * 0.86;

  ctx.font = fontCSS(spec.font, fontSize);
  const lines = text.trim() ? wrap(ctx, text, maxW) : [];
  ctx.font = fontCSS(spec.font, subSize);
  const subLines = sub.trim() ? wrap(ctx, sub, maxW) : [];
  const lh = fontSize * 1.2, slh = subSize * 1.2;
  const gap = lines.length && subLines.length ? fontSize * 0.15 : 0;
  const blockH = lines.length * lh + gap + subLines.length * slh;
  const margin = h * 0.1;
  const y = spec.position === 'top' ? margin : spec.position === 'bottom' ? h - margin - blockH : (h - blockH) / 2;

  const measure = (ls: string[], size: number) => {
    ctx.font = fontCSS(spec.font, size);
    return Math.max(0, ...ls.map((l) => ctx.measureText(l).width));
  };
  const textW = Math.max(measure(lines, fontSize), measure(subLines, subSize));

  if (spec.style === 'box') {
    const padX = fontSize * 0.5, padY = fontSize * 0.3;
    const bw = textW + padX * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect((w - bw) / 2, y - padY, bw, blockH + padY * 2, fontSize * 0.3);
    ctx.fill();
  }

  const c = spec.color;
  ctx.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a ?? 1})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  const drawLines = (ls: string[], size: number, lineH: number, top: number) => {
    ctx.font = fontCSS(spec.font, size);
    ls.forEach((l, i) => {
      const ly = top + i * lineH + (lineH - size) / 2;
      if (spec.style === 'shadow') {
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = size * 0.12;
        ctx.shadowOffsetY = size * 0.04;
      }
      if (spec.style === 'outline') {
        ctx.strokeStyle = 'black';
        ctx.lineWidth = size * 0.08; // entspricht strokeWidth -4 (4 % der Schriftgröße, doppelt wegen Mittellinie)
        ctx.strokeText(l, w / 2, ly);
      }
      ctx.fillText(l, w / 2, ly);
      ctx.shadowColor = 'transparent';
    });
  };
  drawLines(lines, fontSize, lh, y);
  drawLines(subLines, subSize, slh, y + lines.length * lh + gap);
  return canvas;
}

/** Titelvorschläge aus Ort und Datum der Medien – Port von TitleIdeas. */
export function titleSuggestions(place: string | null, date: number | null, fallback: string): string[] {
  const p = (place && place.trim() ? place : fallback).trim();
  let monthYear = '', year = '';
  if (date) {
    const d = new Date(date);
    monthYear = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    year = String(d.getFullYear());
  }
  const ideas = [
    monthYear ? `${p} · ${monthYear}` : p,
    `${p} ${year}`.trim(),
    `Erinnerungen an ${p}`,
    `Unvergessliche Tage in ${p}`,
    `${p} Vibes`,
    `Sommer in ${p}`,
    `Hallo ${p}!`,
    `Best of ${p} ${year}`.trim(),
    `Zeit für ${p}`,
  ];
  const seen = new Set<string>();
  return ideas.filter((i) => i && !seen.has(i.toLowerCase()) && seen.add(i.toLowerCase()));
}

/** Ortsname aus Koordinaten (OpenStreetMap Nominatim). Wird nur auf Knopfdruck aufgerufen. */
export async function placeName(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address ?? {};
    return a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? j.name ?? null;
  } catch {
    return null;
  }
}
