// Grundbausteine der Oberfläche – entsprechen UI/Components.swift.
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { media, thumbnailURL } from '../media/library';
import { layoutRects, type AspectFormat, type RGBA } from '../model/project';

// MARK: Symbole (schlichte SVG-Linien, angelehnt an SF Symbols)

const paths: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  photo: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 100-.01',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  reel: 'M5 7h11v11H5zM8 4h11v11',
  palette: 'M12 3a9 9 0 100 18c1.1 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.3-2.2H17a4 4 0 004-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  empty: 'M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8',
  areas: 'M4 4h16v7H4zM4 13h16v7H4z',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  filter: 'M12 3a5 5 0 110 10 5 5 0 010-10zM7.5 9a5 5 0 110 10 5 5 0 010-10zM16.5 9a5 5 0 110 10 5 5 0 010-10z',
  layout: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  share: 'M12 15V3M8 7l4-4 4 4M5 11v9h14v-9',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  crop: 'M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14',
  wand: 'M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  library: 'M4 19V5M8 19V5M12 19l4-14 4 14',
  sparkles: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 15l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z',
  download: 'M12 3v12M8 11l4 4 4-4M5 21h14',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  check: 'M5 12l5 5 9-10',
  reset: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={paths[name] ?? ''} fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'} />
    </svg>
  );
}

// MARK: Hilfsfunktionen

export function formatTime(s: number): string {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0').replace('.', ',')}`;
}

export const pct = (v: number) => `${Math.round(v * 100)} %`;
export const signed = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`;

export function rgbaToHex(c: RGBA) {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
export function hexToRgba(hex: string): RGBA {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

export const toast = signal<string | null>(null);
let toastTimer = 0;
export function showToast(msg: string, ms = 3500) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), ms);
}

// MARK: Bausteine

export function Card({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function Note({ children, kind }: { children: ComponentChildren; kind?: 'warn' | 'err' | 'ok' }) {
  return <p class={'note' + (kind ? ' ' + kind : '')}>{children}</p>;
}

export function Slider(props: {
  title: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; reset?: number; onInput: (v: number) => void;
}) {
  const { title, value, min, max, step = 0.01, format = pct, reset, onInput } = props;
  return (
    <div class="slider">
      <div class="head">
        <span>{title}</span>
        <span class="val">{format(value)}</span>
        {reset !== undefined && Math.abs(value - reset) > 1e-9 && (
          <button class="iconbtn" style="min-width:0;padding:0 2px" onClick={() => onInput(reset)} aria-label="Zurücksetzen">
            <Icon name="reset" size={18} />
          </button>
        )}
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}

export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label class="toggle" style={disabled ? 'opacity:0.45' : ''}>
      <span>{label}</span>
      <span class="switch">
        <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        <span />
      </span>
    </label>
  );
}

export function Seg<T extends string | number>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {options.map(([v, l]) => (
        <button key={String(v)} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label class="pickrow">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: RGBA; onChange: (c: RGBA) => void }) {
  return (
    <label class="pickrow">
      <span>{label}</span>
      <input type="color" value={rgbaToHex(value)} onInput={(e) => onChange(hexToRgba((e.target as HTMLInputElement).value))} />
    </label>
  );
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span class="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </span>
  );
}

/** Miniaturbild eines Mediums. */
export function Thumb({ id, size, showDuration, number }: { id: string | null | undefined; size?: number; showDuration?: boolean; number?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id) void thumbnailURL(id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [id]);
  const item = id ? media.value[id] : null;
  const style: JSX.CSSProperties = size ? { width: size + 'px', height: size + 'px' } : {};
  return (
    <div class="thumb" style={style}>
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name={item && !item.isPhoto ? 'film' : 'photo'} size={20} />}
      {showDuration && item && !item.isPhoto && <span class="dur">{formatTime(item.duration).replace(/,\d$/, '')}</span>}
      {number !== undefined && <span class="num">{number}</span>}
    </div>
  );
}

/** Kleines Symbol für Format und Bereichsaufteilung. */
export function LayoutGlyph({ format, count, weights, highlighted, height }: { format: AspectFormat; count: number; weights?: number[]; highlighted?: number; height: number }) {
  const ratio = format === 'portrait' ? 9 / 16 : 16 / 9;
  const h = format === 'portrait' ? height : height * 0.6;
  const w = h * ratio;
  const rects = layoutRects(format, weights ?? Array(count).fill(1), { width: w, height: h });
  return (
    <div class="glyph" style={{ height: height + 'px', width: Math.max(w, height * 0.6) + 'px' }}>
      <svg width={w} height={h}>
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={Math.max(0, r.width - 1.5)} height={Math.max(0, r.height - 1.5)} rx="2"
            fill={highlighted === i ? 'var(--accent)' : 'rgba(255,255,255,0.25)'} />
        ))}
      </svg>
    </div>
  );
}

/** Auswahl des Bereichs (1, 2, 3) – optional mit „Gesamt“. */
export function AreaPicker({ count, includeGlobal, value, onChange }: { count: number; includeGlobal?: boolean; value: number; onChange: (v: number) => void }) {
  if (count <= 1 && !includeGlobal) return null;
  const opts: [number, string][] = [];
  if (includeGlobal) opts.push([-1, 'Gesamt']);
  for (let i = 0; i < count; i++) opts.push([i, `Bereich ${i + 1}`]);
  return <Seg options={opts} value={value} onChange={onChange} />;
}

/** Bildschirmfüllendes Blatt (wie .sheet in SwiftUI). */
export function Sheet({ title, onClose, left, right, children }: {
  title: string; onClose: () => void; left?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" role="dialog" aria-label={title}>
        <div class="topbar">
          <div style="min-width:90px">{left ?? <button class="iconbtn" onClick={onClose}>Abbrechen</button>}</div>
          <h1>{title}</h1>
          <div style="min-width:90px;text-align:right">{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Unsichtbares Datei-Eingabefeld, per Knopf geöffnet. */
export function pickFiles(opts: { accept?: string; multiple?: boolean; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.accept) input.accept = opts.accept;
    input.multiple = opts.multiple ?? false;
    if (opts.directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Kann dieses Gerät einen ganzen Ordner auswählen? (Desktop ja, iPhone nein) */
export const canPickDirectory = (() => {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  return !mobile && 'webkitdirectory' in document.createElement('input');
})();

// MARK: Namens-Eingabe (statt window.prompt, das in der Home-Bildschirm-App unzuverlässig ist)

const nameRequest = signal<{ title: string; value: string; resolve: (v: string | null) => void } | null>(null);

/** Fragt nach einem Namen. Liefert null bei Abbruch oder leerer Eingabe. */
export function askName(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => { nameRequest.value = { title, value: initial, resolve }; });
}

export function NameDialogHost() {
  const req = nameRequest.value;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!req) return;
    setText(req.value);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 50);
  }, [req]);
  if (!req) return null;
  const finish = (v: string | null) => {
    nameRequest.value = null;
    req.resolve(v && v.trim() ? v.trim() : null);
  };
  return (
    <div class="sheet-back" style="align-items:center" onClick={(e) => { if (e.target === e.currentTarget) finish(null); }}>
      <form class="card" style="width:min(92vw,420px)" onSubmit={(e) => { e.preventDefault(); finish(text); }}>
        <h3>{req.title}</h3>
        <input ref={inputRef} type="text" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <div class="row">
          <button type="button" class="btn" style="flex:1" onClick={() => finish(null)}>Abbrechen</button>
          <button type="submit" class="btn primary" style="flex:1" disabled={!text.trim()}>Sichern</button>
        </div>
      </form>
    </div>
  );
}
