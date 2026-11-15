// Tab „Export“ – entspricht UI/ExportTab.swift + Exporter.swift.
import { signal } from '@preact/signals';
import { AUDIO_BITRATE, FPS, VIDEO_BITRATE, exportFileName, exportReel } from '../engine/exporter';
import type { Preview } from '../engine/preview';
import type { Editor } from '../model/editor';
import { renderSize } from '../model/project';
import { Card, Icon, Note, Toggle, formatTime } from './components';

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; quick: boolean }
  | { kind: 'done'; url: string; blob: Blob; name: string; quick: boolean; warning?: string }
  | { kind: 'failed'; message: string };

// Bleibt beim Tab-Wechsel erhalten (wie der ExportManager der App)
const state = signal<State>({ kind: 'idle' });
let controller: AbortController | null = null;

async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}

async function run(ed: Editor, preview: Preview | null, quick: boolean) {
  if (state.value.kind === 'running') return;
  preview?.pause();
  await ed.saveNow();
  const old = state.value;
  if (old.kind === 'done') URL.revokeObjectURL(old.url);
  controller = new AbortController();
  state.value = { kind: 'running', progress: 0, quick };
  const release = await keepAwake();
  const p = ed.project.value;
  try {
    const r = await exportReel(p, ed.song.value ? ed.analysis.value : null, {
      includeMusic: p.music.includeInExport || quick,
      scale: quick ? 0.5 : 1,
      signal: controller.signal,
      onProgress: (x) => { if (state.value.kind === 'running') state.value = { kind: 'running', progress: x, quick }; },
    });
    state.value = { kind: 'done', url: URL.createObjectURL(r.blob), blob: r.blob, name: exportFileName(p.title), quick, warning: r.warning };
  } catch (e) {
    const err = e as Error;
    state.value = { kind: 'failed', message: err.name === 'AbortError' ? 'Export abgebrochen.' : err.message || String(e) };
    console.error(e);
  } finally {
    release();
    controller = null;
  }
}

async function share(s: Extract<State, { kind: 'done' }>) {
  const file = new File([s.blob], s.name, { type: 'video/mp4' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: s.name.replace(/\.mp4$/, '') });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  download(s);
}

function download(s: Extract<State, { kind: 'done' }>) {
  const a = document.createElement('a');
  a.href = s.url;
  a.download = s.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportTab({ ed, preview }: { ed: Editor; preview: Preview | null }) {
  const p = ed.project.value;
  const size = renderSize(p.format);
  const dur = ed.duration.value;
  const mb = Math.round(((VIDEO_BITRATE + AUDIO_BITRATE) * Math.max(1, dur)) / 8 / 1e6);
  const s = state.value;
  const row = (a: string, b: string) => <div class="row" style="font-size:15px"><span class="note" style="font-size:15px">{a}</span><span class="spacer" /><span>{b}</span></div>;
  return (
    <>
      <Card title="Web-optimierter Export">
        {row('Auflösung', `${size.width} × ${size.height}`)}
        {row('Video', `H.264 · ${FPS} fps · ca. ${VIDEO_BITRATE / 1e6} Mbit/s`)}
        {row('Ton', 'AAC · 256 kbit/s')}
        {row('Farbe', 'SDR (HDR wird automatisch umgewandelt)')}
        {row('Länge', formatTime(dur))}
        {row('Größe', `ca. ${mb} MB`)}
        <Toggle label="Musik einbetten" value={p.music.includeInExport} disabled={!ed.song.value}
          onChange={(v) => ed.update((q) => { q.music.includeInExport = v; })} />
      </Card>

      {(s.kind === 'idle' || s.kind === 'failed') && (
        <>
          <button class="btn primary block" style="padding:14px;font-size:17px" onClick={() => void run(ed, preview, false)}>
            <Icon name="share" /> Reel exportieren
          </button>
          <button class="btn block" onClick={() => void run(ed, preview, true)}>Genaue Vorschau rendern (halbe Auflösung)</button>
          {s.kind === 'failed' && <Note kind="err">{s.message}</Note>}
          <Note>Lass Safari während des Exports geöffnet – der Bildschirm bleibt dabei an. Im Hintergrund pausiert der Browser die Berechnung.</Note>
        </>
      )}

      {s.kind === 'running' && (
        <Card>
          <div class="row"><span>{s.quick ? 'Rendere Vorschau' : 'Exportiere'} … {Math.round(s.progress * 100)} %</span></div>
          <div class="progress"><div style={{ width: `${s.progress * 100}%` }} /></div>
          <Note>Bitte Safari geöffnet lassen, bis der Export fertig ist.</Note>
          <button class="btn danger" onClick={() => controller?.abort()}>Abbrechen</button>
        </Card>
      )}

      {s.kind === 'done' && (
        <Card>
          <div class="row" style="color:var(--ok);font-weight:600"><Icon name="check" /> {s.quick ? 'Vorschau fertig' : 'Export fertig'}</div>
          <video src={s.url} controls playsInline style="width:100%;max-height:50vh;border-radius:10px;background:#000" />
          {s.warning && <Note kind="warn">{s.warning}</Note>}
          {!s.quick && (
            <>
              <button class="btn primary block" onClick={() => void share(s)}><Icon name="share" /> Teilen / „Video sichern“</button>
              <button class="btn block" onClick={() => download(s)}><Icon name="download" /> In „Dateien“ laden</button>
              <Note>Im Teilen-Menü speichert „Video sichern“ das Reel in deine Fotos. Tipp WhatsApp: Vor dem Senden auf „HD“ tippen, sonst wird das Video stark verkleinert.</Note>
            </>
          )}
          <button class="btn" onClick={() => { URL.revokeObjectURL(s.url); state.value = { kind: 'idle' }; }}>{s.quick ? 'Schließen' : 'Neu exportieren'}</button>
        </Card>
      )}
    </>
  );
}
