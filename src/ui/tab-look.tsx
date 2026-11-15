// Tab „Look“ – entspricht UI/LookTab.swift.
import { useState } from 'preact/hooks';
import { parseCube } from '../engine/gl/looks';
import { deleteLUT, importLUT, luts } from '../media/library';
import type { Editor } from '../model/editor';
import { LOOK_PRESETS, LOOK_PRESET_LABEL, defaultLook, type Look } from '../model/project';
import { AreaPicker, Card, Icon, Note, Select, Slider, Toggle, pickFiles, signed } from './components';

export function LookTab({ ed }: { ed: Editor }) {
  const p = ed.project.value;
  const i = Math.min(ed.selectedArea.value, p.areas.length - 1);
  const look = p.areas[i].look;
  const set = (fn: (l: Look) => void) => ed.update((q) => fn(q.areas[i].look));
  const [lutError, setLutError] = useState<string | null>(null);

  const addLUT = async () => {
    const files = await pickFiles({ accept: '.cube', multiple: true });
    setLutError(null);
    for (const f of files) {
      try {
        const name = await importLUT(f, parseCube);
        set((l) => { l.lutName = name; });
      } catch (e) {
        setLutError((e as Error).message);
      }
    }
  };

  return (
    <>
      <AreaPicker count={p.areas.length} value={i} onChange={(v) => (ed.selectedArea.value = v)} />
      <Card title="Filter">
        <div class="grid-tiles">
          {LOOK_PRESETS.map((k) => (
            <button key={k} class={'tile' + (look.preset === k ? ' on' : '')} onClick={() => set((l) => { l.preset = k; })}>{LOOK_PRESET_LABEL[k]}</button>
          ))}
        </div>
        {look.preset !== 'none' && <Slider title="Stärke" value={look.presetAmount} min={0} max={1} reset={1} onInput={(v) => set((l) => { l.presetAmount = v; })} />}
        <Toggle label="Auto-Korrektur pro Clip" value={look.autoCorrect} onChange={(v) => set((l) => { l.autoCorrect = v; })} />
        <Note>Gleicht Belichtung und Farbe der einzelnen Clips vorab an.</Note>
      </Card>

      <Card title="Color Grading">
        <Slider title="Belichtung" value={look.exposure} min={-2} max={2} step={0.05} reset={0} format={(v) => (v >= 0 ? '+' : '') + v.toFixed(2).replace('.', ',')} onInput={(v) => set((l) => { l.exposure = v; })} />
        <Slider title="Kontrast" value={look.contrast} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.contrast = v; })} />
        <Slider title="Sättigung" value={look.saturation} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.saturation = v; })} />
        <Slider title="Dynamik" value={look.vibrance} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.vibrance = v; })} />
        <Slider title="Temperatur" value={look.temperature} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.temperature = v; })} />
        <Slider title="Tönung" value={look.tint} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.tint = v; })} />
        <Slider title="Lichter" value={look.highlights} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.highlights = v; })} />
        <Slider title="Tiefen" value={look.shadows} min={-1} max={1} reset={0} format={signed} onInput={(v) => set((l) => { l.shadows = v; })} />
      </Card>

      <Card title="LUT">
        <Select label="LUT" value={look.lutName ?? ''} onChange={(v) => set((l) => { l.lutName = v || null; })}
          options={[['', 'Keine'], ...luts.value.map((l) => [l.name, l.name.replace(/\.cube$/i, '')] as [string, string])]} />
        {look.lutName && <Slider title="Stärke" value={look.lutAmount} min={0} max={1} reset={1} onInput={(v) => set((l) => { l.lutAmount = v; })} />}
        <div class="row">
          <button class="btn small tint" onClick={() => void addLUT()}><Icon name="download" /> LUT importieren (.cube)</button>
          {look.lutName && (
            <button class="btn small danger" onClick={() => {
              const l = luts.value.find((x) => x.name === look.lutName);
              if (l && confirm(`LUT „${l.name}“ aus der App löschen?`)) { void deleteLUT(l.id); set((x) => { x.lutName = null; }); }
            }}>LUT löschen</button>
          )}
        </div>
        {lutError && <Note kind="err">{lutError}</Note>}
      </Card>

      {p.areas.length > 1 && (
        <button class="btn" onClick={() => ed.update((q) => { for (const a of q.areas) a.look = structuredClone(look); })}>Diesen Look auf alle Bereiche übertragen</button>
      )}
      <button class="btn danger" onClick={() => set((l) => Object.assign(l, defaultLook()))}>Look zurücksetzen</button>
    </>
  );
}
