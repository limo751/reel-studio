// Tab „Musik“ – entspricht UI/MusicTab.swift.
import { useEffect, useRef } from 'preact/hooks';
import type { BeatAnalysis } from '../engine/beats';
import { songs } from '../media/library';
import type { Editor } from '../model/editor';
import { Card, Icon, Note, Select, Slider, Toggle, formatTime } from './components';
import { ImportProgress, importMusic } from './library';

export function MusicTab({ ed }: { ed: Editor }) {
  const p = ed.project.value;
  const song = ed.song.value;
  const a = ed.analysis.value;
  const m = p.music;
  const set = (fn: (mm: typeof m) => void) => ed.update((q) => fn(q.music));
  return (
    <>
      <ImportProgress />
      <Card title="Song">
        {songs.value.length === 0
          ? <Note>Noch keine Musik in der App. Wähle in der Dateien-App die MP3s aus, die du verwenden möchtest.</Note>
          : <Select label="Song" value={m.song ?? ''} onChange={(v) => set((mm) => { mm.song = v || null; mm.start = 0; })}
              options={[['', 'Keine Musik'], ...songs.value.map((s) => [s.id, s.name] as [string, string])]} />}
        <button class="btn small tint" onClick={() => void importMusic()}><Icon name="plus" /> Musik hinzufügen …</button>
      </Card>

      {song && (
        <>
          <Card title="Startpunkt im Song">
            {a ? (
              <>
                <Waveform analysis={a} start={m.start} length={ed.duration.value} onSelect={(t) => ed.setMusicStart(t)} />
                <div class="row note" style="font-variant-numeric:tabular-nums">
                  <span>Start: {formatTime(m.start)}</span><span class="spacer" /><span>{Math.round(a.bpm)} BPM · Reel {formatTime(ed.duration.value)}</span>
                </div>
                <Note>Tippe oder ziehe in der Wellenform, z. B. um das Intro zu überspringen. Der Start rastet auf einem Beat ein, die Reel-Länge auf einem Takt.</Note>
              </>
            ) : <Note>{ed.analyzing.value ? `Analysiere Takt von „${song.name}“ …` : 'Der Song konnte nicht analysiert werden.'}</Note>}
          </Card>

          <Card title="Mischung">
            <Slider title="Musik-Lautstärke" value={m.volume} min={0} max={1.5} step={0.05} reset={1} onInput={(v) => set((mm) => { mm.volume = v; })} />
            <Toggle label="Musik leiser bei Originalton" value={m.ducking} onChange={(v) => set((mm) => { mm.ducking = v; })} />
            {m.ducking && <Slider title="Absenken auf" value={m.duckLevel} min={0} max={0.8} step={0.05} onInput={(v) => set((mm) => { mm.duckLevel = v; })} />}
            <Slider title="Ausblenden am Ende" value={m.fadeOut} min={0} max={10} step={0.5} format={(v) => v.toFixed(1).replace('.', ',') + ' s'} onInput={(v) => set((mm) => { mm.fadeOut = v; })} />
          </Card>

          <Card title="Beim Export">
            <Toggle label="Musik ins Reel einbetten" value={m.includeInExport} onChange={(v) => set((mm) => { mm.includeInExport = v; })} />
            <Note>{m.includeInExport
              ? 'Gut für WhatsApp, Familie & Archiv. Auf Instagram/TikTok kann bekannte Musik stummgeschaltet werden.'
              : 'Ideal für Instagram/TikTok: Füge dort einen lizenzierten Song hinzu. Die Schnitte passen weiterhin zum Takt deines Songs.'}</Note>
          </Card>
        </>
      )}
    </>
  );
}

function Waveform({ analysis, start, length, onSelect }: { analysis: BeatAnalysis; start: number; length: number; onSelect: (t: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const bins = analysis.waveform;
    const step = w / Math.max(1, bins.length);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    bins.forEach((v, i) => {
      const bh = Math.max(1, v * h * 0.9);
      ctx.fillRect(i * step, (h - bh) / 2, Math.max(0.5, step * 0.7), bh);
    });
    const dur = Math.max(1, analysis.duration);
    const x0 = (start / dur) * w, x1 = (Math.min(dur, start + length) / dur) * w;
    ctx.fillStyle = 'rgba(255,92,122,0.25)';
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    ctx.fillStyle = '#ff5c7a';
    ctx.fillRect(x0, 0, 2, h);
  }, [analysis, start, length]);

  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSelect((Math.min(Math.max(0, e.clientX - r.left), r.width) / r.width) * analysis.duration);
  };
  return (
    <div class="wave" onPointerUp={pick}>
      <canvas ref={ref} />
    </div>
  );
}
