// Tab „Titel“ – entspricht UI/TitlesTab.swift.
import { useState } from 'preact/hooks';
import { TITLE_FONTS, placeName, titleSuggestions } from '../engine/titles';
import { media } from '../media/library';
import type { Editor } from '../model/editor';
import { TITLE_POSITION_LABEL, TITLE_STYLE_LABEL, type TitlePosition, type TitleSpec, type TitleStyle } from '../model/project';
import { AreaPicker, Card, ColorRow, Icon, Note, Seg, Select, Slider, Toggle, formatTime } from './components';

export function TitlesTab({ ed }: { ed: Editor }) {
  const p = ed.project.value;
  const [target, setTarget] = useState(-1); // -1 = Gesamt
  const [ideas, setIdeas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const t = target >= 0 && target < p.areas.length ? target : -1;
  const spec = t >= 0 ? p.areas[t].title : p.globalTitle;
  const set = (fn: (s: TitleSpec) => void) => ed.update((q) => fn(t >= 0 ? q.areas[t].title : q.globalTitle));
  const dur = ed.duration.value;

  const loadIdeas = async () => {
    setLoading(true);
    try {
      const ids: string[] = [];
      for (const a of p.areas) {
        ids.push(...a.reel.clips.map((c) => c.assetID));
        if (a.video.assetID) ids.push(a.video.assetID);
        if (a.photo.assetID) ids.push(a.photo.assetID);
      }
      const items = ids.slice(0, 60).map((id) => media.value[id]).filter(Boolean);
      const date = items.find((m) => m.created)?.created ?? null;
      const geo = items.find((m) => m.lat !== null && m.lon !== null);
      const place = geo ? await placeName(geo.lat!, geo.lon!) : null;
      setIdeas(titleSuggestions(place, geo?.created ?? date, p.title));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AreaPicker count={p.areas.length} includeGlobal={p.areas.length > 1} value={t} onChange={setTarget} />
      <Note>{t < 0 ? 'Titel über dem ganzen Bild' : `Titel nur in Bereich ${t + 1}`}</Note>
      <Card title="Text">
        <Toggle label="Titel einblenden" value={spec.enabled} onChange={(v) => set((s) => { s.enabled = v; })} />
        <textarea rows={2} placeholder="Titel" value={spec.text} onInput={(e) => set((s) => { s.text = (e.target as HTMLTextAreaElement).value; })} />
        <input type="text" placeholder="Untertitel (optional)" value={spec.subtitle} onInput={(e) => set((s) => { s.subtitle = (e.target as HTMLInputElement).value; })} />
        <button class="linkbtn" disabled={loading} onClick={() => void loadIdeas()}>
          <Icon name="sparkles" size={16} /> {loading ? 'Suche Ort & Datum …' : 'Vorschläge aus Ort & Datum'}
        </button>
        {ideas.length > 0 && (
          <div class="row wrap">
            {ideas.map((i) => <button key={i} class="btn small" onClick={() => set((s) => { s.text = i; s.enabled = true; })}>{i}</button>)}
          </div>
        )}
        <Note>Für den Ortsnamen wird der ungefähre Aufnahmeort an OpenStreetMap gesendet.</Note>
      </Card>

      <Card title="Gestaltung">
        <Select label="Schrift" value={spec.font} onChange={(v) => set((s) => { s.font = v; })} options={TITLE_FONTS.map((f) => [f.name, f.label])} />
        <Seg options={(Object.keys(TITLE_STYLE_LABEL) as TitleStyle[]).map((k) => [k, TITLE_STYLE_LABEL[k]] as [TitleStyle, string])} value={spec.style} onChange={(v) => set((s) => { s.style = v; })} />
        <Seg options={(Object.keys(TITLE_POSITION_LABEL) as TitlePosition[]).map((k) => [k, TITLE_POSITION_LABEL[k]] as [TitlePosition, string])} value={spec.position} onChange={(v) => set((s) => { s.position = v; })} />
        <Slider title="Größe" value={spec.size} min={0.04} max={0.2} step={0.005} format={(v) => (v * 100).toFixed(1).replace('.', ',')} onInput={(v) => set((s) => { s.size = v; })} />
        <ColorRow label="Farbe" value={spec.color} onChange={(c) => set((s) => { s.color = c; })} />
        <Toggle label="GROSSBUCHSTABEN" value={spec.uppercase} onChange={(v) => set((s) => { s.uppercase = v; })} />
      </Card>

      <Card title="Timing">
        <Toggle label="Ganze Laufzeit anzeigen" value={spec.fullLength} onChange={(v) => set((s) => { s.fullLength = v; })} />
        {!spec.fullLength && (
          <>
            <Slider title="Start" value={spec.start} min={0} max={Math.max(1, dur - 1)} step={0.5} format={formatTime} onInput={(v) => set((s) => { s.start = v; })} />
            <Slider title="Dauer" value={spec.duration} min={1} max={Math.max(2, dur)} step={0.5} format={formatTime} onInput={(v) => set((s) => { s.duration = v; })} />
          </>
        )}
      </Card>
    </>
  );
}
