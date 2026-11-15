import { describe, expect, it } from 'vitest';
import { BeatGrid } from '../src/engine/beats';
import { resolve } from '../src/engine/planner';
import { clipRamp, fitRamp, rampSource, rampVelocity } from '../src/engine/ramp';
import { defaultCrop, newArea } from '../src/model/project';

describe('Tempo-Rampe', () => {
  const cases = [
    { speed: 10, rampIn: 0.5, rampOut: 0.5, length: 3 },
    { speed: 4, rampIn: 1, rampOut: 0, length: 2 },
    { speed: 2.5, rampIn: 0, rampOut: 0, length: 1.5 },
    { speed: 8, rampIn: 2, rampOut: 2, length: 3 }, // Rampen länger als der Abschnitt → werden gekürzt
  ];
  for (const r of cases) {
    it(`Quellzeit = Integral der Geschwindigkeit (${r.speed}×, ${r.rampIn}/${r.rampOut} s)`, () => {
      const n = 20000;
      let acc = 0;
      for (let i = 0; i < n; i++) acc += rampVelocity(r, ((i + 0.5) / n) * r.length) * (r.length / n);
      expect(rampSource(r, r.length)).toBeCloseTo(acc, 4);
      expect(rampSource(r, 0)).toBe(0);
      // stetig und streng steigend
      let prev = -1;
      for (let i = 0; i <= 300; i++) {
        const v = rampSource(r, (i / 300) * r.length);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    });
  }
  it('beginnt und endet mit normaler Geschwindigkeit, erreicht das Zieltempo', () => {
    const r = { speed: 10, rampIn: 0.5, rampOut: 0.5, length: 3 };
    expect(rampVelocity(r, 0)).toBeCloseTo(1);
    expect(rampVelocity(r, 3)).toBeCloseTo(1);
    expect(rampVelocity(r, 1.5)).toBe(10);
    // 0,5 s auf + 2 s bei 10× + 0,5 s ab = 0,5·5,5 + 20 + 0,5·5,5
    expect(rampSource(r, 3)).toBeCloseTo(25.5, 6);
  });
  it('ohne Tempo keine Rampe', () => {
    expect(clipRamp({ speed: 1 }, 2)).toBeNull();
    expect(clipRamp({}, 2)).toBeNull();
  });
  it('Planer reserviert genug Material für beschleunigte Clips', () => {
    const grid = new BeatGrid(null, 0);
    const reel = newArea('reel').reel;
    reel.clips = [{
      id: 'a', assetID: 'v', isPhoto: false, sourceDuration: 60, sourceStart: 10, beats: 4,
      transition: { kind: 'cut', duration: 0 }, volume: 1, crop: defaultCrop(), speed: 6, rampIn: 0.4, rampOut: 0.4,
    }];
    const [seg] = resolve(reel, grid, 2);
    expect(seg.sourceStart).toBe(10);
    expect(seg.sourceDuration).toBeCloseTo(rampSource({ speed: 6, rampIn: 0.4, rampOut: 0.4, length: 2 }, 2), 6);
    expect(seg.sourceDuration).toBeGreaterThan(9);
  });
});

describe('Tempo bei zu wenig Material', () => {
  it('senkt das Höchsttempo so, dass das Material genau reicht', () => {
    const r = { speed: 10, rampIn: 0.6, rampOut: 0.6, length: 3.76 };
    const fit = fitRamp(r, 8)!;
    expect(fit.speed).toBeGreaterThan(1);
    expect(fit.speed).toBeLessThan(10);
    expect(rampSource(fit, r.length)).toBeCloseTo(8, 3);
    expect(rampVelocity(fit, 0)).toBeCloseTo(1);
  });
  it('lässt die Rampe unverändert, wenn genug Material da ist', () => {
    const r = { speed: 4, rampIn: 0.5, rampOut: 0.5, length: 2 };
    expect(fitRamp(r, 100)).toBe(r);
    expect(fitRamp(r, 1.5)).toBeNull();
  });
});
