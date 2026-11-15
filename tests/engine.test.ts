import { describe, expect, it } from 'vitest';
import { analyzeSamples, BeatGrid, SAMPLE_RATE } from '../src/engine/beats';
import { planReel, resolve, visibleEnd, visibleStart } from '../src/engine/planner';
import { defaultTransition, layoutRects, newArea } from '../src/model/project';

/** Synthetischer Beat: Bass-Kick auf jedem Schlag, Hi-Hat dazwischen. */
function clickTrack(bpm: number, seconds: number, offset = 0.2) {
  const s = new Float32Array(Math.floor(seconds * SAMPLE_RATE));
  const period = 60 / bpm;
  for (let i = 0; i < s.length; i++) {
    const t = i / SAMPLE_RATE;
    const ph = (((t - offset) % period) + period) % period;
    const kick = t >= offset ? Math.sin(2 * Math.PI * 55 * ph) * Math.exp(-ph * 18) : 0;
    const hh = ((((t - offset - period / 2) % period) + period) % period);
    const click = t >= offset ? (Math.random() * 2 - 1) * Math.exp(-ph * 250) : 0; // Anschlag des Kicks
    const hat = 0.06 * (Math.random() * 2 - 1) * Math.exp(-hh * 60);
    s[i] = 0.8 * kick + 0.4 * click + hat;
  }
  return s;
}

describe('Beat-Analyse', () => {
  for (const bpm of [96, 120, 128, 140]) {
    it(`erkennt ${bpm} BPM`, () => {
      const a = analyzeSamples(clickTrack(bpm, 40));
      // Wie in der iOS-App: bei schnellen Songs ist auch das halbe Tempo zulässig (Oktav-Mehrdeutigkeit)
      const err = Math.min(Math.abs(a.bpm - bpm), Math.abs(a.bpm * 2 - bpm));
      expect(err).toBeLessThan(1.5);
      const p = 60 / bpm;
      // Beats liegen auf den Schlägen (max. 40 ms daneben)
      const devs = a.beats.filter((b) => b > 1 && b < 38).map((b) => {
        const x = (b - 0.2) / p;
        return Math.abs(x - Math.round(x)) * p;
      });
      expect(Math.max(...devs)).toBeLessThan(0.04);
      expect(a.waveform.length).toBeGreaterThan(1000);
    });
  }
});

describe('Beat-Raster', () => {
  const a = analyzeSamples(clickTrack(120, 60, 0.0));
  const g = new BeatGrid(a, a.beats[8]);
  it('beginnt bei 0 und rastet die Länge auf Takte ein', () => {
    expect(g.times[0]).toBe(0);
    const d = g.snappedDuration(30);
    expect(Math.abs(d - 30)).toBeLessThan(1.1);
    expect(g.beatIndex(d) % 4).toBe(0);
  });
  it('ohne Musik: gleichmäßig 120 BPM', () => {
    const e = new BeatGrid(null, 0);
    expect(e.period).toBe(0.5);
    expect(e.time(10)).toBe(5);
    expect(e.autoBeatsPerClip).toBe(4);
  });
});

describe('Planer', () => {
  const grid = new BeatGrid(null, 0);
  const media = Array.from({ length: 6 }, (_, i) => ({ id: 'm' + i, isPhoto: i % 3 === 0, duration: i % 3 === 0 ? 0 : 8, created: i }));
  it('füllt die ganze Länge, Übergänge mittig auf dem Schnitt', () => {
    const clips = planReel(media, grid, 30, 0, 0, defaultTransition());
    expect(clips.length).toBe(Math.ceil(grid.beatIndex(30) / 4));
    const reel = { ...newArea('reel').reel, clips };
    const segs = resolve(reel, grid, 30);
    expect(segs[0].cutIn).toBe(0);
    expect(segs[segs.length - 1].cutOut).toBe(30);
    for (let k = 1; k < segs.length; k++) {
      expect(segs[k].cutIn).toBeCloseTo(segs[k - 1].cutOut);
      expect(segs[k].inDuration).toBeCloseTo(segs[k - 1].outDuration);
      expect(visibleStart(segs[k])).toBeLessThan(visibleEnd(segs[k - 1]) + 1e-9);
    }
    for (const s of segs.filter((x) => !x.isPhoto)) {
      expect(s.sourceStart + s.sourceDuration).toBeLessThanOrEqual(8 + 1e-9);
    }
  });
  it('wiederholt Clips, wenn zu wenig Material da ist', () => {
    const clips = planReel(media.slice(0, 2), grid, 30, 0, 0, defaultTransition());
    expect(clips.length).toBe(15);
    expect(new Set(clips.map((c) => c.assetID)).size).toBe(2);
  });
});

describe('Layout', () => {
  it('teilt hochkant vertikal auf und deckt die Fläche ab', () => {
    const r = layoutRects('portrait', [1, 2, 1]);
    expect(r.map((x) => x.height)).toEqual([480, 960, 480]);
    expect(r[2].y + r[2].height).toBe(1920);
    const q = layoutRects('landscape', [1, 1]);
    expect(q[1].x).toBe(960);
  });
});
