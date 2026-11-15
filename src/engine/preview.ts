// Live-Vorschau im Editor: Video-Elemente als Bildquellen, derselbe WebGL-Compositor wie beim Export,
// Ton vorab gemischt (inkl. Ducking) und synchron abgespielt.
import { signal } from '@preact/signals';
import { getBlob } from '../media/library';
import type { Project } from '../model/project';
import type { BeatAnalysis } from './beats';
import { renderMix } from './audio';
import { lutMap, makePlan } from './exporter';
import { isActive, loadPhoto } from './frames';
import { Renderer, type FrameSource } from './gl/renderer';
import { audioContext } from './music';
import { rampVelocity } from './ramp';
import { sourceTime, type RenderPlan, type SegmentRender } from './timeline';

const PREVIEW_SCALE = 0.5;
const PRELOAD = 1.5; // Sekunden vor dem Einsatz vorbereiten

interface VideoSlot { el: HTMLVideoElement; ready: boolean; assetID: string }

export class Preview {
  readonly time = signal(0);
  readonly playing = signal(false);
  readonly duration = signal(0);
  readonly building = signal(false);
  readonly error = signal<string | null>(null);

  private renderer: Renderer;
  private plan: RenderPlan | null = null;
  private mix: AudioBuffer | null = null;
  private mixGen = 0;
  private videos = new Map<string, VideoSlot>();
  private urls = new Map<string, string>();
  private photos = new Map<string, FrameSource>();
  private photoLoading = new Set<string>();
  private raf = 0;
  private audioSrc: AudioBufferSourceNode | null = null;
  private clockStart = 0;   // performance.now() bzw. AudioContext-Zeit beim Start
  private timeAtStart = 0;
  private usingAudioClock = false;
  private dirty = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Projekt hat sich geändert → Plan neu aufbauen, Ton neu mischen. */
  update(project: Project, analysis: BeatAnalysis | null) {
    try {
      this.plan = makePlan(project, analysis, true, PREVIEW_SCALE);
      this.renderer.setPlan(this.plan, lutMap());
      this.duration.value = this.plan.duration;
      this.error.value = null;
      if (this.time.value > this.plan.duration) this.seek(0);
    } catch (e) {
      this.error.value = (e as Error).message;
      return;
    }
    this.dirty = true;
    const gen = ++this.mixGen;
    const plan = this.plan;
    this.building.value = true;
    // Ton etwas verzögert neu mischen (bei schnellen Änderungen nur einmal)
    setTimeout(async () => {
      if (gen !== this.mixGen) return;
      try {
        const mix = await renderMix(plan);
        if (gen !== this.mixGen) return;
        this.mix = mix;
        if (this.playing.value) this.restartAudio();
      } catch (e) {
        console.warn('Ton-Vorschau fehlgeschlagen', e);
      } finally {
        if (gen === this.mixGen) this.building.value = false;
      }
    }, 300);
  }

  // MARK: Wiedergabe

  play() {
    if (!this.plan || this.playing.value) return;
    if (this.time.value >= this.plan.duration - 0.05) this.time.value = 0;
    void audioContext().resume();
    this.playing.value = true;
    this.restartAudio();
  }

  pause() {
    if (!this.playing.value) return;
    this.time.value = this.now();
    this.playing.value = false;
    this.stopAudio();
    for (const v of this.videos.values()) v.el.pause();
    this.dirty = true;
  }

  toggle() { if (this.playing.value) this.pause(); else this.play(); }

  seek(t: number) {
    const d = this.plan?.duration ?? 0;
    this.time.value = Math.max(0, Math.min(t, Math.max(0, d - 0.01)));
    if (this.playing.value) this.restartAudio();
    this.syncVideos(this.time.value, true);
    this.dirty = true;
  }

  private now(): number {
    if (!this.playing.value) return this.time.value;
    const elapsed = this.usingAudioClock ? audioContext().currentTime - this.clockStart : (performance.now() - this.clockStart) / 1000;
    return this.timeAtStart + elapsed;
  }

  private restartAudio() {
    this.stopAudio();
    const t = this.time.value;
    this.timeAtStart = t;
    const ctx = audioContext();
    if (this.mix) {
      const src = ctx.createBufferSource();
      src.buffer = this.mix;
      src.connect(ctx.destination);
      src.start(0, Math.min(t, this.mix.duration));
      this.audioSrc = src;
      this.usingAudioClock = true;
      this.clockStart = ctx.currentTime;
    } else {
      this.usingAudioClock = false;
      this.clockStart = performance.now();
    }
  }

  private stopAudio() {
    try { this.audioSrc?.stop(); } catch { /* bereits gestoppt */ }
    this.audioSrc?.disconnect();
    this.audioSrc = null;
  }

  // MARK: Quellen

  private url(assetID: string): Promise<string> {
    const u = this.urls.get(assetID);
    if (u) return Promise.resolve(u);
    return getBlob(assetID).then((b) => {
      const url = URL.createObjectURL(b);
      this.urls.set(assetID, url);
      return url;
    });
  }

  private video(key: string, seg: SegmentRender): VideoSlot {
    let v = this.videos.get(key);
    if (v && v.assetID === seg.assetID) return v;
    if (v) this.dropVideo(key);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.crossOrigin = 'anonymous';
    const slot: VideoSlot = { el, ready: false, assetID: seg.assetID };
    el.addEventListener('loadeddata', () => { slot.ready = true; this.dirty = true; });
    el.addEventListener('seeked', () => { this.dirty = true; });
    void this.url(seg.assetID).then((u) => { el.src = u; });
    this.videos.set(key, slot);
    return slot;
  }

  private dropVideo(key: string) {
    const v = this.videos.get(key);
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    this.videos.delete(key);
  }

  private photo(assetID: string): FrameSource | null {
    const p = this.photos.get(assetID);
    if (p) return p;
    if (!this.photoLoading.has(assetID)) {
      this.photoLoading.add(assetID);
      void loadPhoto(assetID).then((bmp) => {
        this.photos.set(assetID, { source: bmp, width: bmp.width, height: bmp.height, rotation: 0, version: 1 });
        this.dirty = true;
      }).catch(() => {}).finally(() => this.photoLoading.delete(assetID));
    }
    return null;
  }

  /** Video-Elemente an die Zeit anpassen: sichtbare abspielen/suchen, kommende vorbereiten, alte freigeben. */
  private syncVideos(t: number, forceSeek = false) {
    const plan = this.plan;
    if (!plan) return;
    const keep = new Set<string>();
    plan.areas.forEach((area, ai) => area.segments.forEach((seg, si) => {
      if (seg.isPhoto || !seg.time) return;
      const key = `${ai}:${si}`;
      const visible = isActive(seg, t);
      const upcoming = !visible && seg.visibleStart > t && seg.visibleStart - t < PRELOAD;
      if (!visible && !upcoming) return;
      keep.add(key);
      const v = this.video(key, seg);
      if (!v.ready) return;
      const target = sourceTime(seg.time, visible ? t : seg.visibleStart);
      const el = v.el;
      if (visible && this.playing.value) {
        const m = seg.time;
        let rate = m.mode === 'linear' ? m.rate : m.mode === 'slow' ? m.avail / m.duration : 1;
        if (m.mode === 'linear' && m.ramp) rate *= rampVelocity(m.ramp, t - m.insertAt);
        rate = Math.min(16, Math.max(0.1, rate));
        if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate;
        const frozen = (m.mode === 'freeze' && target >= m.srcDur - 0.05) || (m.mode === 'linear' && target >= m.srcMax - 0.05);
        if (frozen) { if (!el.paused) el.pause(); if (Math.abs(el.currentTime - target) > 0.1) el.currentTime = target; }
        else if (el.paused) { el.currentTime = target; void el.play().catch(() => {}); }
        // Toleranz wächst mit dem Tempo, sonst würde bei 10× ständig neu gesucht
        else if (Math.abs(el.currentTime - target) > 0.25 * Math.max(1, rate)) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (forceSeek || Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
      }
    }));
    for (const key of [...this.videos.keys()]) if (!keep.has(key)) this.dropVideo(key);
  }

  private frame = (ai: number, si: number): FrameSource | null => {
    const seg = this.plan!.areas[ai].segments[si];
    if (seg.isPhoto) return this.photo(seg.assetID);
    const v = this.videos.get(`${ai}:${si}`);
    if (!v || !v.ready || v.el.readyState < 2) return null;
    return { source: v.el, width: v.el.videoWidth, height: v.el.videoHeight, rotation: 0 };
  };

  private loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.plan) return;
    if (this.playing.value) {
      let t = this.now();
      if (t >= this.plan.duration) {
        // wie in der App: am Ende von vorn
        this.time.value = 0;
        this.restartAudio();
        t = 0;
      }
      this.time.value = t;
      this.syncVideos(t);
      this.renderer.render(t, this.frame);
    } else if (this.dirty) {
      this.dirty = false;
      this.syncVideos(this.time.value);
      this.renderer.render(this.time.value, this.frame);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const k of [...this.videos.keys()]) this.dropVideo(k);
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    for (const p of this.photos.values()) (p.source as ImageBitmap).close();
    this.renderer.dispose();
  }
}
