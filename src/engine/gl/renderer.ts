// WebGL2-Compositor: setzt pro Zeitpunkt das komplette Bild zusammen – Port von RenderPlan.compose (Compositor.swift).
import { LOOK_FRAG, OVERLAY_FRAG, FIT_FRAG, TRANSITION_FRAG, VERT } from './shaders';
import { CINEMATIC_LUT, PRESET_CURVES, PRESET_ID, computeAutoAdjust, curveTable, manualCurve, type AutoAdjust, type LUTData } from './looks';
import type { AreaRender, RenderPlan, SegmentRender } from '../timeline';
import type { Crop, Rect, TransitionKind } from '../../model/project';
import { renderTitle } from '../titles';

/** Ein Bild für ein Segment: Videoframe, Video-Element oder Foto. */
export interface FrameSource {
  source: TexImageSource;
  width: number;      // Rohbreite (vor Drehung)
  height: number;
  rotation: 0 | 90 | 180 | 270;
  version?: number;   // bei Fotos unverändert → kein erneutes Hochladen
}

const TRANSITION_ID: Record<TransitionKind, number> = {
  cut: 0, dissolve: 1, fadeBlack: 2, fadeWhite: 3, wipeLeft: 4, wipeRight: 5, wipeUp: 6, wipeDown: 7,
  slideLeft: 8, slideRight: 9, slideUp: 10, slideDown: 11, zoom: 12, blur: 13, circle: 14,
};

type Program = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export const segKey = (area: number, seg: number) => `${area}:${seg}`;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private fit: Program;
  private trans: Program;
  private look: Program;
  private overlay: Program;
  private quad: WebGLVertexArrayObject;
  private srcTex = new Map<string, { tex: WebGLTexture; ref: unknown; version?: number }>();
  private targets = new Map<string, Target>();
  private curveTex = new Map<string, WebGLTexture>();
  private lutTex = new Map<string, { tex: WebGLTexture; size: number }>();
  private titleTex: { tex: WebGLTexture; key: string }[] = [];
  private auto = new Map<string, AutoAdjust>();
  private statsCanvas: OffscreenCanvas | HTMLCanvasElement;
  private plan: RenderPlan | null = null;
  private luts: Record<string, LUTData> = {};

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 wird von diesem Browser nicht unterstützt.');
    this.gl = gl;
    this.fit = this.program(FIT_FRAG, ['uTex', 'uAreaSize', 'uOffset', 'uScaled', 'uRotation', 'uGains', 'uGamma']);
    this.trans = this.program(TRANSITION_FRAG, ['uA', 'uB', 'uKind', 'uP', 'uSize']);
    this.look = this.program(LOOK_FRAG, ['uTex', 'uExposure', 'uContrast', 'uSaturation', 'uVibrance', 'uTemp', 'uTint',
      'uHasManualCurve', 'uManualCurve', 'uPreset', 'uPresetAmount', 'uHasPresetCurve', 'uPresetCurve', 'uCineLUT',
      'uHasLUT', 'uLUTAmount', 'uLUT', 'uLUTSize']);
    this.overlay = this.program(OVERLAY_FRAG, ['uTex', 'uAlpha']);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quad = vao;
    this.lut3D('__cinematic', CINEMATIC_LUT);
    this.statsCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(48, 48) : Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
  }

  private program(frag: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Programm: ' + gl.getProgramInfoLog(prog));
    const u: Program['u'] = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(prog, n);
    return { prog, u };
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(key: string, w: number, h: number): Target {
    const gl = this.gl;
    const old = this.targets.get(key);
    if (old && old.w === w && old.h === h) return old;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fbo); }
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const t = { fbo, tex, w, h };
    this.targets.set(key, t);
    return t;
  }

  private curve(key: string, points: [number, number][]): WebGLTexture {
    let t = this.curveTex.get(key);
    if (t) return t;
    const gl = this.gl;
    t = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveTable(points));
    this.curveTex.set(key, t);
    return t;
  }

  private lut3D(key: string, lut: LUTData) {
    const existing = this.lutTex.get(key);
    if (existing) return existing;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.FLOAT, lut.data);
    const v = { tex, size: lut.size };
    this.lutTex.set(key, v);
    return v;
  }

  /** Neuer Plan: Titelbilder vorbereiten, eigene LUTs registrieren. */
  setPlan(plan: RenderPlan, luts: Record<string, LUTData>) {
    const gl = this.gl;
    this.plan = plan;
    this.luts = luts;
    if (this.canvas.width !== plan.width || this.canvas.height !== plan.height) {
      this.canvas.width = plan.width;
      this.canvas.height = plan.height;
    }
    const scale = plan.width / (plan.width > plan.height ? 1920 : 1080);
    plan.titles.forEach((t, i) => {
      const key = JSON.stringify([t.spec, t.rect, scale]);
      const existing = this.titleTex[i];
      if (existing?.key === key) return;
      const img = renderTitle(t.spec, t.rect.width, t.rect.height);
      const tex = existing?.tex ?? this.texture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.titleTex[i] = { tex, key };
    });
  }

  /** Auto-Korrektur für ein Segment (aus dem ersten verfügbaren Bild berechnet und zwischengespeichert). */
  private autoFor(seg: SegmentRender, frame: FrameSource): AutoAdjust {
    const key = `${seg.assetID}@${Math.floor(seg.autoAt)}`;
    let a = this.auto.get(key);
    if (!a) {
      const c = this.statsCanvas as OffscreenCanvas;
      const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      try {
        ctx.drawImage(frame.source as CanvasImageSource, 0, 0, 48, 48);
        a = computeAutoAdjust(ctx.getImageData(0, 0, 48, 48).data);
      } catch {
        a = { gains: [1, 1, 1], gamma: 1 };
      }
      this.auto.set(key, a);
    }
    return a;
  }

  private upload(key: string, f: FrameSource): WebGLTexture {
    const gl = this.gl;
    let e = this.srcTex.get(key);
    if (!e) { e = { tex: this.texture(), ref: null }; this.srcTex.set(key, e); }
    if (e.ref !== f.source || e.version !== f.version || f.version === undefined) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f.source);
      e.ref = f.source;
      e.version = f.version;
    }
    return e.tex;
  }

  /** Vergisst hochgeladene Quellbilder, deren Segmente nicht mehr gebraucht werden. */
  releaseSources(keep: Set<string>) {
    for (const [k, v] of this.srcTex) if (!keep.has(k)) { this.gl.deleteTexture(v.tex); this.srcTex.delete(k); }
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Medium in ein Ziel einpassen (Aspect Fill + Crop + Ken Burns) – entspricht RenderPlan.fit. */
  private renderSegment(dst: Target, seg: SegmentRender, frame: FrameSource, tex: WebGLTexture, t: number, autoOn: boolean) {
    const gl = this.gl;
    const rot = frame.rotation;
    const ew = rot === 90 || rot === 270 ? frame.height : frame.width;
    const eh = rot === 90 || rot === 270 ? frame.width : frame.height;
    const crop: Crop = { ...seg.crop };
    if (seg.kenBurns) {
      const len = Math.max(0.1, seg.visibleEnd - seg.visibleStart);
      crop.scale *= 1 + 0.1 * Math.min(1, Math.max(0, (t - seg.visibleStart) / len));
    }
    const s = Math.max(dst.w / ew, dst.h / eh) * Math.max(1, crop.scale);
    const w = ew * s, h = eh * s;
    const ox = -(w - dst.w) / 2 * (1 + crop.x);
    const oy = -(h - dst.h) / 2 * (1 + crop.y);
    const a = autoOn ? this.autoFor(seg, frame) : { gains: [1, 1, 1] as [number, number, number], gamma: 1 };
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(this.fit.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const u = this.fit.u;
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uAreaSize, dst.w, dst.h);
    gl.uniform2f(u.uOffset, ox, oy);
    gl.uniform2f(u.uScaled, w, h);
    gl.uniform1i(u.uRotation, rot / 90);
    gl.uniform3f(u.uGains, ...a.gains);
    gl.uniform1f(u.uGamma, a.gamma);
    this.drawQuad();
  }

  private viewportFor(r: Rect) {
    const H = this.canvas.height;
    const x = Math.round(r.x), y = Math.round(r.y);
    const w = Math.round(r.x + r.width) - x, h = Math.round(r.y + r.height) - y;
    this.gl.viewport(x, H - y - h, w, h);
    return { x, y: H - y - h, w, h };
  }

  private fillRect(r: Rect, c: { r: number; g: number; b: number }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const v = this.viewportFor(r);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(v.x, v.y, v.w, v.h);
    gl.clearColor(c.r, c.g, c.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  /**
   * Setzt das Bild für Zeitpunkt t zusammen. `frames` liefert pro Segment (segKey) das aktuelle Bild.
   */
  render(t: number, frames: (areaIndex: number, segIndex: number) => FrameSource | null) {
    const plan = this.plan;
    if (!plan) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, plan.width, plan.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    plan.areas.forEach((area, ai) => {
      if (area.kind === 'empty') return this.fillRect(area.rect, { r: 0.06, g: 0.06, b: 0.07 });
      if (area.kind === 'color') return this.fillRect(area.rect, area.fill);
      this.renderArea(area, ai, t, frames);
    });

    for (const d of plan.dividers) this.fillRect(d.rect, d.color);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    plan.titles.forEach((title, i) => {
      if (t < title.start || t >= title.end || !this.titleTex[i]) return;
      const alpha = Math.max(0, Math.min(1, (t - title.start) / 0.5, (title.end - t) / 0.5));
      this.viewportFor(title.rect);
      gl.useProgram(this.overlay.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.titleTex[i].tex);
      gl.uniform1i(this.overlay.u.uTex, 0);
      gl.uniform1f(this.overlay.u.uAlpha, alpha);
      this.drawQuad();
    });
    gl.disable(gl.BLEND);
  }

  private renderArea(area: AreaRender, ai: number, t: number, frames: (a: number, s: number) => FrameSource | null) {
    const gl = this.gl;
    const w = Math.max(2, Math.round(area.rect.width)), h = Math.max(2, Math.round(area.rect.height));
    const active: number[] = [];
    area.segments.forEach((s, si) => { if (t >= s.visibleStart - 0.0001 && t < s.visibleEnd) active.push(si); });
    const draw = (si: number, key: string): Target | null => {
      const f = frames(ai, si);
      if (!f) return null;
      const tex = this.upload(segKey(ai, si), f);
      const dst = this.target(`${ai}:${key}`, w, h);
      this.renderSegment(dst, area.segments[si], f, tex, t, area.look.autoCorrect);
      return dst;
    };

    let result: Target | null = null;
    if (active.length >= 2) {
      const ia = active[active.length - 2], ib = active[active.length - 1];
      const a = draw(ia, 'A'), b = draw(ib, 'B');
      const sb = area.segments[ib];
      const p = sb.inDuration > 0 ? (t - (sb.cutIn - sb.inDuration / 2)) / sb.inDuration : 1;
      if (a && b) {
        const dst = this.target(`${ai}:T`, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(this.trans.prog);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.uniform1i(this.trans.u.uA, 0);
        gl.uniform1i(this.trans.u.uB, 1);
        gl.uniform1i(this.trans.u.uKind, TRANSITION_ID[sb.inTransition]);
        gl.uniform1f(this.trans.u.uP, Math.min(1, Math.max(0, p)));
        gl.uniform2f(this.trans.u.uSize, w, h);
        this.drawQuad();
        result = dst;
      } else {
        result = b ?? a;
      }
    } else if (active.length === 1) {
      result = draw(active[0], 'A');
    }
    if (!result) return this.fillRect(area.rect, { r: 0, g: 0, b: 0 });
    this.applyLook(area, result);
  }

  private applyLook(area: AreaRender, src: Target) {
    const gl = this.gl;
    const l = area.look;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.viewportFor(area.rect);
    gl.useProgram(this.look.prog);
    const u = this.look.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1f(u.uExposure, l.exposure);
    gl.uniform1f(u.uContrast, l.contrast);
    gl.uniform1f(u.uSaturation, l.saturation);
    gl.uniform1f(u.uVibrance, l.vibrance);
    gl.uniform1f(u.uTemp, l.temperature);
    gl.uniform1f(u.uTint, l.tint);
    const mc = manualCurve(l);
    gl.uniform1i(u.uHasManualCurve, mc ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mc ? this.curve(JSON.stringify(mc), mc) : this.curve('id', [[0, 0], [1, 1]]));
    gl.uniform1i(u.uManualCurve, 1);
    gl.uniform1i(u.uPreset, PRESET_ID[l.preset]);
    gl.uniform1f(u.uPresetAmount, l.presetAmount);
    const pc = PRESET_CURVES[l.preset];
    gl.uniform1i(u.uHasPresetCurve, pc ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pc ? this.curve('preset:' + l.preset, pc) : this.curve('id', [[0, 0], [1, 1]]));
    gl.uniform1i(u.uPresetCurve, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex.get('__cinematic')!.tex);
    gl.uniform1i(u.uCineLUT, 3);
    const custom = l.lutName ? this.luts[l.lutName] : undefined;
    const lt = custom ? this.lut3D('lut:' + l.lutName, custom) : this.lutTex.get('__cinematic')!;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, lt.tex);
    gl.uniform1i(u.uLUT, 4);
    gl.uniform1i(u.uHasLUT, custom ? 1 : 0);
    gl.uniform1f(u.uLUTAmount, l.lutAmount);
    gl.uniform1f(u.uLUTSize, lt.size);
    this.drawQuad();
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
