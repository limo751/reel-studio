// Editor mit Vorschau und Tabs – entspricht UI/EditorView.swift.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Preview } from '../engine/preview';
import { folders, luts, media, songs } from '../media/library';
import { Editor } from '../model/editor';
import { layoutRects, renderSize, type Project } from '../model/project';
import { Icon, formatTime } from './components';
import { AreasTab } from './tab-areas';
import { ExportTab } from './tab-export';
import { LayoutTab } from './tab-layout';
import { LookTab } from './tab-look';
import { MusicTab } from './tab-music';
import { TitlesTab } from './tab-titles';

type Tab = 'areas' | 'music' | 'titles' | 'look' | 'layout' | 'export';
const TABS: [Tab, string, string][] = [
  ['areas', 'Bereiche', 'areas'], ['music', 'Musik', 'music'], ['titles', 'Titel', 'text'],
  ['look', 'Look', 'filter'], ['layout', 'Layout', 'layout'], ['export', 'Export', 'share'],
];

export function EditorView({ project, onBack }: { project: Project; onBack: () => void }) {
  const ed = useMemo(() => new Editor(project), [project.id]);
  const [tab, setTab] = useState<Tab>('areas');
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const save = () => { if (document.visibilityState !== 'visible') void ed.saveNow(); };
    document.addEventListener('visibilitychange', save);
    return () => { document.removeEventListener('visibilitychange', save); void ed.saveNow(); };
  }, [ed]);

  const back = () => { preview?.pause(); void ed.saveNow(); onBack(); };

  return (
    <>
      <div class="topbar">
        <button class="iconbtn" onClick={back}><Icon name="back" /> Reels</button>
        <h1>{ed.project.value.title}</h1>
        <button class="iconbtn" disabled={!ed.canUndo.value} onClick={() => ed.undo()} aria-label="Rückgängig"><Icon name="undo" /></button>
        <button class="iconbtn" disabled={!ed.canRedo.value} onClick={() => ed.redo()} aria-label="Wiederholen"><Icon name="redo" /></button>
      </div>
      <PreviewPanel ed={ed} onReady={setPreview} />
      <div class="chips">
        {TABS.map(([t, label, icon]) => (
          <button key={t} class={'chip' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}><Icon name={icon} />{label}</button>
        ))}
      </div>
      <div class="scroll stack">
        {tab === 'areas' && <AreasTab ed={ed} />}
        {tab === 'music' && <MusicTab ed={ed} />}
        {tab === 'titles' && <TitlesTab ed={ed} />}
        {tab === 'look' && <LookTab ed={ed} />}
        {tab === 'layout' && <LayoutTab ed={ed} />}
        {tab === 'export' && <ExportTab ed={ed} preview={preview} />}
      </div>
    </>
  );
}

function PreviewPanel({ ed, onReady }: { ed: Editor; onReady: (p: Preview) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const p = new Preview(canvasRef.current!);
      setPv(p);
      onReady(p);
      return () => p.dispose();
    } catch (e) {
      setInitError((e as Error).message);
    }
  }, []);

  // Bei jeder Änderung (Projekt, Analyse, Mediathek, LUTs) die Vorschau neu aufbauen
  useSignalEffect(() => {
    const p = ed.project.value;
    const a = ed.song.value ? ed.analysis.value : null;
    void media.value; void luts.value; void songs.value; void folders.value;
    if (!pv) return;
    const timer = setTimeout(() => pv.update(p, a), 120);
    return () => clearTimeout(timer);
  });
  useEffect(() => { if (pv) pv.update(ed.project.peek(), ed.song.peek() ? ed.analysis.peek() : null); }, [pv]);

  const p = ed.project.value;
  const size = renderSize(p.format);
  const ratio = size.width / size.height;
  const rects = layoutRects(p.format, p.weights, { width: 100, height: 100 });
  const t = pv?.time.value ?? 0;
  const dur = pv?.duration.value ?? ed.duration.value;
  return (
    <div class="preview">
      <div class="stage">
        <div class="frame" style={{ aspectRatio: String(ratio), maxWidth: '100%' }} onClick={() => pv?.toggle()}>
          <canvas ref={canvasRef} />
          {p.areas.length > 1 && (
            <div class="overlay">
              {rects.map((r, i) => (
                <div key={i} style={{
                  position: 'absolute', left: r.x + '%', top: r.y + '%', width: r.width + '%', height: r.height + '%',
                  border: i === ed.selectedArea.value ? '2px solid var(--accent)' : 'none', boxSizing: 'border-box',
                }} />
              ))}
            </div>
          )}
          {(pv?.building.value || ed.analyzing.value) && <span class="badge">{ed.analyzing.value ? 'Analysiere Takt …' : 'Aktualisiere …'}</span>}
          {(initError || pv?.error.value) && <div class="errbox">{initError || pv?.error.value}</div>}
        </div>
      </div>
      <div class="transport">
        <button class="play" onClick={() => pv?.toggle()} aria-label="Abspielen">
          <Icon name={pv?.playing.value ? 'pause' : 'play'} />
        </button>
        <span>{formatTime(t)}</span>
        <input type="range" min={0} max={Math.max(0.1, dur)} step={0.01} value={t}
          onInput={(e) => pv?.seek(parseFloat((e.target as HTMLInputElement).value))} />
        <span style="color:var(--muted)">{formatTime(dur)}</span>
      </div>
    </div>
  );
}
