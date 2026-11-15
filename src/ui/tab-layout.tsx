// Tab „Layout“ – entspricht UI/LayoutTab.swift.
import type { Editor } from '../model/editor';
import { BLACK, DURATIONS, FORMAT_LABEL, WHITE, setAreaCount, type AspectFormat } from '../model/project';
import { Card, ColorRow, LayoutGlyph, Note, Seg, Slider, Toggle, formatTime } from './components';

export function LayoutTab({ ed }: { ed: Editor }) {
  const p = ed.project.value;
  const total = p.weights.reduce((a, b) => a + b, 0);
  const sameColor = (a: typeof WHITE, b: typeof WHITE) => a.r === b.r && a.g === b.g && a.b === b.b;
  return (
    <>
      <Card title="Reel">
        <input type="text" value={p.title} placeholder="Titel des Reels" onInput={(e) => ed.update((q) => { q.title = (e.target as HTMLInputElement).value; })} />
        <Seg options={DURATIONS.map((d) => [d, `${d} s`] as [number, string])} value={p.targetDuration} onChange={(v) => ed.update((q) => { q.targetDuration = v; })} />
        <Seg options={(['portrait', 'landscape'] as AspectFormat[]).map((f) => [f, FORMAT_LABEL[f]] as [AspectFormat, string])} value={p.format} onChange={(v) => ed.update((q) => { q.format = v; })} />
        {ed.song.value && <Note>Die tatsächliche Länge rastet auf den nächsten Takt ein: {formatTime(ed.duration.value)}.</Note>}
      </Card>

      <Card title="Aufteilung">
        <div class="layouts">
          {[1, 2, 3].map((n) => (
            <button key={n} class={p.areas.length === n ? 'on' : ''} onClick={() => {
              if (n === p.areas.length) return;
              ed.update((q) => setAreaCount(q, n));
              ed.selectedArea.value = Math.min(ed.selectedArea.value, n - 1);
            }}>
              <LayoutGlyph format={p.format} count={n} height={60} />
              {n === 1 ? 'Vollbild' : `${n} Bereiche`}
            </button>
          ))}
        </div>
        {p.areas.length > 1 && (
          <>
            {p.areas.map((_, a) => (
              <Slider key={a} title={`Größe Bereich ${a + 1}`} value={p.weights[a] ?? 1} min={0.3} max={3} step={0.05}
                format={() => `${Math.round(((p.weights[a] ?? 1) / Math.max(0.01, total)) * 100)} %`}
                onInput={(v) => ed.update((q) => { q.weights[a] = v; })} />
            ))}
            <button class="btn small" onClick={() => ed.update((q) => { q.weights = q.areas.map(() => 1); })}>Gleich groß</button>
          </>
        )}
      </Card>

      {p.areas.length > 1 && (
        <Card title="Trennlinien">
          <Toggle label="Trennlinien anzeigen" value={p.divider.enabled} onChange={(v) => ed.update((q) => { q.divider.enabled = v; })} />
          {p.divider.enabled && (
            <>
              <Seg options={[['thin', 'Dünn'], ['thick', 'Dick']]} value={p.divider.thickness} onChange={(v) => ed.update((q) => { q.divider.thickness = v; })} />
              <div class="row">
                <button class={'btn small' + (sameColor(p.divider.color, WHITE) ? ' tint' : '')} onClick={() => ed.update((q) => { q.divider.color = { ...WHITE }; })}>Weiß</button>
                <button class={'btn small' + (sameColor(p.divider.color, BLACK) ? ' tint' : '')} onClick={() => ed.update((q) => { q.divider.color = { ...BLACK }; })}>Schwarz</button>
                <span class="spacer" />
                <ColorRow label="Eigene" value={p.divider.color} onChange={(c) => ed.update((q) => { q.divider.color = c; })} />
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
