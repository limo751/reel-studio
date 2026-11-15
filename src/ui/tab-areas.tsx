// Tab „Bereiche“ – entspricht UI/AreasTab.swift.
import { useEffect, useState } from 'preact/hooks';
import { applyRhythm } from '../engine/planner';
import { MAX_SPEED, clipRamp, fitRamp, rampSource } from '../engine/ramp';
import { folders, media } from '../media/library';
import type { Editor } from '../model/editor';
import {
  AREA_KINDS, AREA_KIND_LABEL, END_BEHAVIOR_LABEL, TRANSITION_KINDS, TRANSITION_LABEL, defaultCrop, layoutRects,
  type Area, type Crop, type EndBehavior, type ReelClip, type TransitionSpec,
} from '../model/project';
import { AreaPicker, Card, ColorRow, Icon, Note, Seg, Select, Slider, Stepper, Thumb, Toggle, formatTime } from './components';
import { CropEditor } from './crop';
import { AssetPickerSheet, FolderPickerSheet } from './library';

const KIND_ICON: Record<string, string> = { empty: 'empty', photo: 'photo', video: 'film', reel: 'reel', color: 'palette' };

type SheetKind = 'album' | 'photo' | 'video' | 'addClips' | null;

export function AreasTab({ ed }: { ed: Editor }) {
  const p = ed.project.value;
  const i = Math.min(ed.selectedArea.value, p.areas.length - 1);
  const area = p.areas[i];
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [crop, setCrop] = useState<{ assetID: string; clip: number | null } | null>(null);
  const set = (fn: (a: Area) => void) => ed.update((q) => fn(q.areas[i]));

  // Beim ersten Öffnen eines leeren Reel-Bereichs gleich nach dem Ordner fragen (wie in der App)
  useEffect(() => {
    if (!ed.didPromptAlbum && area.kind === 'reel' && !area.reel.albumID && area.reel.clips.length === 0) {
      ed.didPromptAlbum = true;
      setSheet('album');
    }
  }, []);

  const areaSize = layoutRects(p.format, p.weights)[i];
  const cropValue = (): Crop => {
    if (!crop) return defaultCrop();
    if (crop.clip !== null) return area.reel.clips[crop.clip]?.crop ?? defaultCrop();
    return area.kind === 'photo' ? area.photo.crop : area.video.crop;
  };
  const setCropValue = (c: Crop) => set((a) => {
    if (crop?.clip != null) { if (a.reel.clips[crop.clip]) a.reel.clips[crop.clip].crop = c; }
    else if (a.kind === 'photo') a.photo.crop = c;
    else a.video.crop = c;
  });

  return (
    <>
      <AreaPicker count={p.areas.length} value={i} onChange={(v) => (ed.selectedArea.value = v)} />
      <div class="kinds">
        {AREA_KINDS.map((k) => (
          <button key={k} class={'tile' + (area.kind === k ? ' on' : '')} onClick={() => set((a) => { a.kind = k; })}>
            <Icon name={KIND_ICON[k]} />{AREA_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {area.kind === 'empty' && <Card><Note>Wähle oben, womit dieser Bereich gefüllt wird.</Note></Card>}
      {area.kind === 'color' && <Card title="Farbe"><ColorRow label="Füllfarbe" value={area.fill} onChange={(c) => set((a) => { a.fill = c; })} /></Card>}

      {area.kind === 'photo' && (
        <Card title="Foto">
          <div class="row">
            <Thumb id={area.photo.assetID} size={72} />
            <div class="stack" style="gap:6px">
              <button class="linkbtn" onClick={() => setSheet('photo')}>{area.photo.assetID ? 'Anderes Foto …' : 'Foto wählen …'}</button>
              {area.photo.assetID && <button class="linkbtn" onClick={() => setCrop({ assetID: area.photo.assetID!, clip: null })}>Bildausschnitt …</button>}
            </div>
          </div>
          <Toggle label="Langsamer Zoom (Ken Burns)" value={area.photo.kenBurns} onChange={(v) => set((a) => { a.photo.kenBurns = v; })} />
          <Note>Das Foto steht über die gesamte Laufzeit des Reels.</Note>
        </Card>
      )}

      {area.kind === 'video' && (
        <Card title="Video ohne Schnitt">
          <div class="row">
            <Thumb id={area.video.assetID} size={72} />
            <div class="stack" style="gap:6px">
              <button class="linkbtn" onClick={() => setSheet('video')}>{area.video.assetID ? 'Anderes Video …' : 'Video wählen …'}</button>
              {area.video.assetID && <button class="linkbtn" onClick={() => setCrop({ assetID: area.video.assetID!, clip: null })}>Bildausschnitt …</button>}
            </div>
          </div>
          {area.video.assetID && (() => {
            const v = area.video;
            const maxStart = Math.max(0, v.sourceDuration - 0.5);
            return (
              <>
                {maxStart > 0 && <Slider title="Startpunkt im Video" value={v.start} min={0} max={maxStart} step={0.1} format={formatTime} onInput={(x) => set((a) => { a.video.start = x; })} />}
                <Note>Videolänge: {formatTime(v.sourceDuration)} · Reel: {formatTime(ed.duration.value)}</Note>
                {v.sourceDuration - v.start < ed.duration.value && (
                  <Select label="Wenn das Video zu kurz ist" value={v.endBehavior} onChange={(x) => set((a) => { a.video.endBehavior = x; })}
                    options={(Object.keys(END_BEHAVIOR_LABEL) as EndBehavior[]).map((k) => [k, END_BEHAVIOR_LABEL[k]])} />
                )}
              </>
            );
          })()}
        </Card>
      )}

      {area.kind === 'reel' && <ReelSection ed={ed} index={i} onSheet={setSheet} onCrop={(c) => setCrop({ assetID: area.reel.clips[c].assetID, clip: c })} />}

      {(area.kind === 'video' || area.kind === 'reel') && (
        <Card title="Originalton">
          <Toggle label="Ton dieses Bereichs abspielen" value={area.audio.enabled} onChange={(v) => set((a) => { a.audio.enabled = v; })} />
          {area.audio.enabled && (
            <>
              <Slider title="Lautstärke" value={area.audio.volume} min={0} max={2} step={0.05} reset={1} onInput={(v) => set((a) => { a.audio.volume = v; })} />
              {p.music.ducking && ed.song.value && <Note>Die Musik wird automatisch leiser, solange Originalton läuft.</Note>}
            </>
          )}
        </Card>
      )}

      {sheet === 'album' && <FolderPickerSheet title="Ordner für das Reel" onClose={() => setSheet(null)} onPick={(f) => ed.planReel(i, f.id)} />}
      {sheet === 'photo' && <AssetPickerSheet kind="photo" onClose={() => setSheet(null)} onPick={([m]) => set((a) => { a.photo.assetID = m.id; a.photo.crop = defaultCrop(); })} />}
      {sheet === 'video' && <AssetPickerSheet kind="video" onClose={() => setSheet(null)} onPick={([m]) => set((a) => {
        a.video.assetID = m.id; a.video.sourceDuration = m.duration; a.video.start = 0; a.video.crop = defaultCrop();
      })} />}
      {sheet === 'addClips' && <AssetPickerSheet kind="both" multiple onClose={() => setSheet(null)} onPick={(items) => ed.addClips(i, items)} />}
      {crop && <CropEditor assetID={crop.assetID} areaW={areaSize.width} areaH={areaSize.height} crop={cropValue()} onChange={setCropValue} onClose={() => setCrop(null)} />}
    </>
  );
}

function ReelSection({ ed, index, onSheet, onCrop }: { ed: Editor; index: number; onSheet: (s: SheetKind) => void; onCrop: (clip: number) => void }) {
  const p = ed.project.value;
  const reel = p.areas[index].reel;
  const set = (fn: (a: Area) => void) => ed.update((q) => fn(q.areas[index]));
  const cov = ed.reelCoverage(index);
  return (
    <>
      <Card title="Ordner mit dem Material">
        <button class="row" style="background:none;border:0;padding:0;text-align:left" onClick={() => onSheet('album')}>
          <Thumb id={reel.clips[0]?.assetID} size={56} />
          <div style="flex:1">
            <div style="font-weight:600">{folders.value.find((f) => f.id === reel.albumID)?.name ?? reel.albumName ?? 'Kein Ordner gewählt'}</div>
            <div class="note">{reel.clips.length} Clips im Schnittplan</div>
          </div>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </button>
        <button class="btn primary block" onClick={() => onSheet('album')}><Icon name="folder" />{reel.albumID ? 'Anderen Ordner wählen …' : 'Ordner wählen …'}</button>
        {reel.albumID && <Note>Beim Wechsel wird der Schnittplan aus dem neuen Ordner neu erstellt. Mit ↶ oben rechts kannst du das rückgängig machen.</Note>}
      </Card>

      {reel.clips.length > 0 && (
        <>
          <Card title="Schnitt im Takt">
            <div class="pickrow"><span>Clip-Länge</span></div>
            <Seg options={[[0, 'Auto'], [1, '1 Beat'], [2, '2'], [4, '4'], [8, '8']]} value={reel.rhythm}
              onChange={(r) => set((a) => applyRhythm(r, a.reel, ed.grid.value))} />
            {p.areas.filter((a) => a.kind === 'reel').length > 1 && (
              <div class="pickrow"><span>Versatz: {reel.offsetBeats} Beats</span><Stepper value={reel.offsetBeats} min={0} max={8} onChange={(v) => set((a) => { a.reel.offsetBeats = v; })} /></div>
            )}
            {cov.used < cov.total - 0.1 && <Note kind="warn">Die Clips reichen für {formatTime(cov.used)} – danach wiederholen sie sich.</Note>}
            {ed.song.value && ed.analysis.value
              ? <Note>Tempo: {Math.round(ed.analysis.value.bpm)} BPM · Schnitte liegen auf den Beats</Note>
              : <Note>Ohne Musik wird ein gleichmäßiger Takt (120 BPM) verwendet.</Note>}
          </Card>

          <Card title="Standard-Übergang">
            <TransitionEditor spec={reel.defaultTransition} onChange={(t) => set((a) => { a.reel.defaultTransition = t; })} />
            <button class="btn small" onClick={() => set((a) => { for (const c of a.reel.clips) c.transition = { ...a.reel.defaultTransition }; })}>Auf alle Clips anwenden</button>
          </Card>

          <Card title="Clips">
            <div>
              {reel.clips.map((c, k) => <ClipRow key={c.id} ed={ed} areaIndex={index} clipIndex={k} onCrop={() => onCrop(k)} />)}
            </div>
            <div class="row">
              <button class="btn small tint" onClick={() => onSheet('addClips')}><Icon name="plus" /> Clips hinzufügen</button>
              <span class="spacer" />
              <button class="btn small danger" onClick={() => ed.replanReel(index)}><Icon name="wand" /> Neu planen</button>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function ClipRow({ ed, areaIndex, clipIndex, onCrop }: { ed: Editor; areaIndex: number; clipIndex: number; onCrop: () => void }) {
  const [open, setOpen] = useState(false);
  const clips = ed.project.value.areas[areaIndex].reel.clips;
  const clip = clips[clipIndex];
  if (!clip) return null;
  const set = (fn: (c: typeof clip) => void) => ed.update((q) => { const c = q.areas[areaIndex].reel.clips[clipIndex]; if (c) fn(c); });
  const move = (d: number) => ed.update((q) => {
    const l = q.areas[areaIndex].reel.clips;
    const j = clipIndex + d;
    if (j < 0 || j >= l.length) return;
    [l[clipIndex], l[j]] = [l[j], l[clipIndex]];
  });
  const isLast = clipIndex === clips.length - 1;
  const srcDur = media.value[clip.assetID]?.duration ?? clip.sourceDuration;
  return (
    <div class="clip">
      <div class="head" onClick={() => setOpen(!open)}>
        <span class="idx">{clipIndex + 1}</span>
        <Thumb id={clip.assetID} size={54} />
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">{clip.beats} Beats · {formatTime(clip.beats * ed.grid.value.period)}</div>
          <div class="note">{clip.isPhoto ? 'Foto' : `Video ${formatTime(srcDur)}`}{(clip.speed ?? 1) > 1 && <span class="accent"> · Tempo bis {fmtSpeed(clip.speed!)}</span>}</div>
          {!isLast && <div class="note accent">→ {TRANSITION_LABEL[clip.transition.kind]}</div>}
        </div>
        <span onClick={(e) => e.stopPropagation()}><Stepper value={clip.beats} min={1} max={32} onChange={(v) => set((c) => { c.beats = v; })} /></span>
      </div>
      {open && (
        <>
          {!clip.isPhoto && <SpeedRamp clip={clip} length={clip.beats * ed.grid.value.period} srcDur={srcDur} onChange={(fn) => set(fn)} />}
          {!clip.isPhoto && srcDur > 1 && (
            <>
              <Slider title="Stelle im Clip (auf dem Beat)" value={clip.sourceStart} min={0} max={Math.max(0.1, srcDur - 0.3)} step={0.1} format={formatTime}
                onInput={(v) => set((c) => { c.sourceStart = v; })} />
              <Slider title="Originalton dieses Clips" value={clip.volume} min={0} max={2} step={0.05} reset={1} onInput={(v) => set((c) => { c.volume = v; })} />
            </>
          )}
          {!isLast && (
            <>
              <div style="font-size:15px">Übergang zum nächsten Clip</div>
              <TransitionEditor spec={clip.transition} onChange={(t) => set((c) => { c.transition = t; })} />
            </>
          )}
          <div class="row">
            <button class="btn small" onClick={onCrop}><Icon name="crop" /> Ausschnitt</button>
            <span class="spacer" />
            <button class="btn small" disabled={clipIndex === 0} onClick={() => move(-1)} aria-label="Nach oben"><Icon name="up" /></button>
            <button class="btn small" disabled={isLast} onClick={() => move(1)} aria-label="Nach unten"><Icon name="down" /></button>
            <button class="btn small danger" onClick={() => ed.update((q) => { q.areas[areaIndex].reel.clips.splice(clipIndex, 1); })} aria-label="Löschen"><Icon name="trash" /></button>
          </div>
        </>
      )}
    </div>
  );
}

const fmtSpeed = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + '×';
const fmtSec = (v: number) => v.toFixed(1).replace('.', ',') + ' s';

/** Tempo-Rampe: auf bis zu 10× beschleunigen, mit sanftem Ein- und Ausblenden der Geschwindigkeit. */
function SpeedRamp({ clip, length, srcDur, onChange }: {
  clip: ReelClip; length: number; srcDur: number; onChange: (fn: (c: ReelClip) => void) => void;
}) {
  const speed = clip.speed ?? 1;
  const rampIn = clip.rampIn ?? 0.5, rampOut = clip.rampOut ?? 0.5;
  const ramp = clipRamp(clip, length);
  const need = ramp ? rampSource(ramp, length) : length;
  const maxRamp = Math.max(0.1, Math.round(length * 10) / 10);
  return (
    <>
      <Slider title="Tempo-Rampe (Speed Ramp)" value={speed} min={1} max={MAX_SPEED} step={0.5} format={fmtSpeed} reset={1}
        onInput={(v) => onChange((c) => { c.speed = v; c.rampIn ??= 0.5; c.rampOut ??= 0.5; })} />
      {speed > 1 && (
        <>
          <Slider title="Beschleunigen (Fade-in)" value={Math.min(rampIn, maxRamp)} min={0} max={maxRamp} step={0.1} format={fmtSec}
            onInput={(v) => onChange((c) => { c.rampIn = v; })} />
          <Slider title="Abbremsen (Fade-out)" value={Math.min(rampOut, maxRamp)} min={0} max={maxRamp} step={0.1} format={fmtSec}
            onInput={(v) => onChange((c) => { c.rampOut = v; })} />
          <Note>Der Clip startet normal, wird sanft bis {fmtSpeed(speed)} schneller und bremst zum Schnitt wieder ab. Dafür werden {fmtSec(need)} Videomaterial in {fmtSec(length)} gezeigt. Der Originalton dieses Clips wird dabei stummgeschaltet.</Note>
          {ramp && need > srcDur - clip.sourceStart + 0.05 && (() => {
            const fit = fitRamp(ramp, Math.max(0, srcDur - clip.sourceStart));
            return (
              <Note kind="warn">Ab dieser Stelle hat der Clip nur {fmtSec(Math.max(0, srcDur - clip.sourceStart))} Material.{' '}
                {fit ? `Das Tempo wird deshalb auf ${fmtSpeed(Math.floor(fit.speed * 10) / 10)} begrenzt.` : 'Er läuft deshalb ohne Beschleunigung.'}{' '}
                Für mehr Tempo eine frühere Stelle oder ein längeres Video wählen.</Note>
            );
          })()}
        </>
      )}
    </>
  );
}

export function TransitionEditor({ spec, onChange }: { spec: TransitionSpec; onChange: (t: TransitionSpec) => void }) {
  return (
    <>
      <Select label="Art" value={spec.kind} onChange={(k) => onChange({ ...spec, kind: k })}
        options={TRANSITION_KINDS.map((k) => [k, TRANSITION_LABEL[k]])} />
      {spec.kind !== 'cut' && (
        <Slider title="Dauer (mittig auf dem Schnitt)" value={spec.duration} min={0.1} max={2} step={0.05}
          format={(v) => v.toFixed(2).replace('.', ',') + ' s'} onInput={(v) => onChange({ ...spec, duration: v })} />
      )}
    </>
  );
}
