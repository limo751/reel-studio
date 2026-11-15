// Beat-Analyse – Port von Engine/BeatAnalyzer.swift (gleiche Parameter und Schritte).

export interface BeatAnalysis {
  bpm: number;
  beats: number[];     // Sekunden im Song
  duration: number;
  waveform: number[];  // 0…1, ~1200 Werte
}

export const SAMPLE_RATE = 22050;
const FRAME = 1024;
const HOP = 512;

export function analyzeSamples(s: Float32Array): BeatAnalysis {
  const duration = s.length / SAMPLE_RATE;
  const waveform = makeWaveform(s, 1200);
  const onset = onsetEnvelope(s);
  const fps = SAMPLE_RATE / HOP;
  if (onset.length <= Math.floor(fps * 4)) {
    const beats: number[] = [];
    for (let t = 0; t < duration; t += 0.5) beats.push(t);
    return { bpm: 120, beats, duration, waveform };
  }
  const period = estimatePeriod(onset, fps);
  const frames = trackBeats(onset, period);
  // Fensterversatz ausgleichen: der Onset liegt im Mittel eine halbe Fensterlänge später
  const offset = FRAME / 2 / SAMPLE_RATE;
  const beats = frames.map((f) => f / fps + offset);
  const bpm = (60 * fps) / period;
  return { bpm: Math.round(bpm * 10) / 10, beats, duration, waveform };
}

function makeWaveform(s: Float32Array, bins: number): number[] {
  if (!s.length) return [];
  const per = Math.max(1, Math.floor(s.length / bins));
  const out: number[] = [];
  for (let i = 0; i < s.length; i += per) {
    const end = Math.min(s.length, i + per);
    let m = 0;
    for (let k = i; k < end; k++) { const v = Math.abs(s[k]); if (v > m) m = v; }
    out.push(m);
  }
  const peak = Math.max(...out, 0);
  return peak > 0 ? out.map((v) => v / peak) : out;
}

// MARK: FFT (radix 2, in place)

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Spektraler Fluss (log-komprimiert) als Onset-Stärke pro Frame. */
function onsetEnvelope(s: Float32Array): Float32Array {
  const n = FRAME, half = n / 2;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  const frames = Math.max(0, Math.floor((s.length - n) / HOP));
  const env = new Float32Array(frames);
  const re = new Float64Array(n), im = new Float64Array(n);
  const prev = new Float64Array(half);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < n; i++) { re[i] = s[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < half; k++) {
      // vDSP liefert den doppelten Betrag – Faktor 2 für gleiche Skalierung wie in der App
      const mag = 2 * Math.hypot(re[k], im[k]);
      const m = Math.log1p(mag * 0.1);
      const d = m - prev[k];
      if (d > 0) flux += d;
      prev[k] = m;
    }
    env[f] = flux;
  }
  // Gleitenden Mittelwert abziehen, negative Werte kappen, normieren
  const w = 16;
  const out = new Float32Array(env.length);
  let acc = 0;
  for (let i = 0; i < env.length; i++) {
    acc += env[i];
    if (i >= w) acc -= env[i - w];
    const mean = acc / Math.min(i + 1, w);
    out[i] = Math.max(0, env[i] - mean);
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const rms = Math.sqrt(sq / Math.max(1, out.length));
  if (rms > 0) for (let i = 0; i < out.length; i++) out[i] /= rms;
  return out;
}

/** Tempo per Autokorrelation, gewichtet um 120 BPM. */
function estimatePeriod(o: Float32Array, fps: number): number {
  const minLag = Math.floor((fps * 60) / 190);
  const maxLag = Math.floor((fps * 60) / 65);
  const n = o.length;
  const raw = new Float64Array(maxLag + 2);
  for (let lag = Math.max(1, minLag - 1); lag <= maxLag + 1 && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += o[i] * o[i + lag];
    raw[lag] = sum / (n - lag);
  }
  let best = 0;
  let bestLag = Math.floor(fps * 0.5);
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    const bpm = (60 * fps) / lag;
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    if (raw[lag] * weight > best) { best = raw[lag] * weight; bestLag = lag; }
  }
  // Feinjustierung mit parabolischer Interpolation
  const a = raw[bestLag - 1], b = raw[bestLag], c = raw[bestLag + 1];
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return bestLag + shift;
}

/** Beat-Tracking per dynamischer Programmierung (nach Ellis 2007). */
function trackBeats(o: Float32Array, period: number, tightness = 100): number[] {
  const n = o.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 0.5);
  const hi = Math.round(period * 2);
  // Strafterm vorab berechnen (hängt nur vom Abstand ab)
  const penalty = new Float64Array(hi + 1);
  for (let d = 1; d <= hi; d++) penalty[d] = -tightness * Math.pow(Math.log(d / period), 2);
  for (let t = 0; t < n; t++) {
    let bestVal = -Infinity, bestPrev = -1;
    if (t - lo >= 0) {
      for (let prev = Math.max(0, t - hi); prev <= t - lo; prev++) {
        const v = score[prev] + penalty[t - prev];
        if (v > bestVal) { bestVal = v; bestPrev = prev; }
      }
    }
    if (bestPrev >= 0 && bestVal > 0) {
      score[t] = o[t] + bestVal;
      back[t] = bestPrev;
    } else {
      score[t] = o[t];
    }
  }
  // Bestes Ende im letzten Beat-Intervall suchen
  const tailStart = Math.max(0, n - Math.floor(period * 1.5));
  let end = tailStart;
  for (let t = tailStart; t < n; t++) if (score[t] > score[end]) end = t;
  let beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // Lücken am Anfang mit dem Raster auffüllen
  if (beats.length) {
    const pre: number[] = [];
    for (let f = beats[0] - period; f > -period * 0.3; f -= period) pre.push(Math.max(0, Math.round(f)));
    beats = [...pre.reverse(), ...beats];
  }
  return beats;
}

// MARK: Beat-Raster

/** Beat-Raster relativ zum Reel-Start (Zeit 0 = Startpunkt im Song). */
export class BeatGrid {
  readonly times: number[];
  readonly period: number;

  constructor(analysis: BeatAnalysis | null, start: number, cover = 400) {
    if (!analysis || analysis.beats.length <= 4) {
      this.period = 0.5;
      this.times = [];
      for (let t = 0; t <= cover; t += 0.5) this.times.push(t);
      return;
    }
    this.period = 60 / Math.max(40, analysis.bpm);
    const t = analysis.beats.filter((b) => b >= start - 0.03).map((b) => Math.max(0, b - start));
    if ((t[0] ?? 1) > 0.08) t.unshift(0);
    else if (t.length) t[0] = 0;
    let last = t[t.length - 1] ?? 0;
    while (last < cover) { last += this.period; t.push(last); }
    this.times = t;
  }

  time(ofBeat: number): number {
    if (ofBeat < this.times.length) return this.times[Math.max(0, ofBeat)];
    return this.times[this.times.length - 1] + (ofBeat - this.times.length + 1) * this.period;
  }

  /** Index des Beats, der `t` am nächsten liegt. */
  beatIndex(near: number): number {
    let lo = 0, hi = this.times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < near) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(this.times[lo - 1] - near) < Math.abs(this.times[lo] - near)) return lo - 1;
    return lo;
  }

  /** Reel-Länge, eingerastet auf den nächstgelegenen Takt (4 Beats). */
  snappedDuration(target: number): number {
    const i = this.beatIndex(target);
    const bar = Math.max(4, Math.round(i / 4) * 4);
    return this.time(bar);
  }

  /** Automatische Clip-Länge in Beats (Ziel ca. 2–3 Sekunden pro Clip). */
  get autoBeatsPerClip(): number {
    const options = [1, 2, 4, 8];
    return options.reduce((a, b) => (Math.abs(b * this.period - 2.4) < Math.abs(a * this.period - 2.4) ? b : a));
  }
}
