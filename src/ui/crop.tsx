// Bildausschnitt mit dem Finger verschieben und zoomen – entspricht UI/CropEditor.swift.
import { useEffect, useRef, useState } from 'preact/hooks';
import { media, previewURL } from '../media/library';
import { defaultCrop, type Crop } from '../model/project';
import { Note, Sheet } from './components';

export function CropEditor({ assetID, areaW, areaH, crop, onChange, onClose }: {
  assetID: string; areaW: number; areaH: number; crop: Crop; onChange: (c: Crop) => void; onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 200, h: 200 });
  const item = media.value[assetID];
  const img = { w: item?.width || 1, h: item?.height || 1 };

  useEffect(() => { void previewURL(assetID).then(setUrl); }, [assetID]);
  useEffect(() => {
    const el = stageRef.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const ratio = areaW / areaH;
      const aw = r.width - 40, ah = r.height - 40;
      setFrame(aw / ah > ratio ? { w: ah * ratio, h: ah } : { w: aw, h: aw / ratio });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [areaW, areaH]);

  const place = (c: Crop) => {
    const s = Math.max(frame.w / img.w, frame.h / img.h) * c.scale;
    const w = img.w * s, h = img.h * s;
    return { x: -(w - frame.w) / 2 * (1 + c.x), y: -(h - frame.h) / 2 * (1 + c.y), w, h };
  };

  // Gesten: ein Finger verschiebt, zwei Finger zoomen
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ crop: Crop; pts: Map<number, { x: number; y: number }> } | null>(null);
  const latest = useRef(crop);
  latest.current = crop;

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { crop: { ...latest.current }, pts: new Map(pointers.current) };
  };
  const onMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const base = start.current.crop;
    const ids = [...pointers.current.keys()];
    if (ids.length >= 2) {
      const d = (m: Map<number, { x: number; y: number }>) => {
        const a = m.get(ids[0]), b = m.get(ids[1]);
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      };
      const d0 = d(start.current.pts), d1 = d(pointers.current);
      if (d0 > 10) onChange({ ...latest.current, scale: Math.min(4, Math.max(1, base.scale * (d1 / d0))) });
      return;
    }
    const s0 = start.current.pts.get(e.pointerId);
    if (!s0) return;
    const r = place(base);
    const slackW = Math.max(1, r.w - frame.w), slackH = Math.max(1, r.h - frame.h);
    onChange({
      ...base,
      x: Math.min(1, Math.max(-1, base.x - (e.clientX - s0.x) / (slackW / 2))),
      y: Math.min(1, Math.max(-1, base.y - (e.clientY - s0.y) / (slackH / 2))),
    });
  };
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    start.current = pointers.current.size ? { crop: { ...latest.current }, pts: new Map(pointers.current) } : null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    onChange({ ...crop, scale: Math.min(4, Math.max(1, crop.scale * (e.deltaY < 0 ? 1.05 : 0.95))) });
  };

  const r = place(crop);
  return (
    <Sheet title="Bildausschnitt" onClose={onClose}
      left={<button class="iconbtn" onClick={() => onChange(defaultCrop())}>Zurücksetzen</button>}
      right={<button class="iconbtn" style="font-weight:700" onClick={onClose}>Fertig</button>}>
      <div class="crop-stage" ref={stageRef}>
        <div class="crop-frame" style={{ width: frame.w + 'px', height: frame.h + 'px' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
          {url && <img src={url} alt="" style={{ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }} />}
        </div>
      </div>
      <div style="padding:0 16px calc(env(safe-area-inset-bottom) + 16px);text-align:center">
        <Note>Ziehen zum Verschieben, mit zwei Fingern zoomen.</Note>
      </div>
    </Sheet>
  );
}
