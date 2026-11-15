// GLSL-Shader (WebGL2). Entsprechen dem Core-Image-Compositor der iOS-App.
// Konvention: vUV hat den Ursprung unten links; Bilder werden mit Zeile 0 = oben hochgeladen.

export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Pass 1: Medium in den Bereich einpassen (Aspect Fill + Ausschnitt), Drehung, Auto-Korrektur. */
export const FIT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uAreaSize;
uniform vec2 uOffset;     // linke obere Ecke des skalierten Bildes (Pixel, oben links)
uniform vec2 uScaled;     // Größe des skalierten Bildes (Pixel)
uniform int uRotation;    // 0, 1 = 90°, 2 = 180°, 3 = 270° (im Uhrzeigersinn)
uniform vec3 uGains;
uniform float uGamma;
void main() {
  vec2 p = vec2(vUV.x, 1.0 - vUV.y) * uAreaSize;
  vec2 d = clamp((p - uOffset) / uScaled, 0.0, 1.0);
  vec2 r = d;
  if (uRotation == 1) r = vec2(d.y, 1.0 - d.x);
  else if (uRotation == 2) r = 1.0 - d;
  else if (uRotation == 3) r = vec2(1.0 - d.y, d.x);
  vec3 c = texture(uTex, r).rgb;
  c = pow(clamp(c * uGains, 0.0, 1.0), vec3(uGamma));
  outColor = vec4(c, 1.0);
}`;

/** Pass 2: Übergang zwischen zwei Bildern (A = alter Clip, B = neuer Clip). */
export const TRANSITION_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform int uKind;
uniform float uP;
uniform vec2 uSize;

vec4 blur(sampler2D t, vec2 uv, float radius) {
  if (radius < 0.5) return texture(t, uv);
  vec4 acc = texture(t, uv) * 2.0;
  float w = 2.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    vec2 dir = vec2(cos(a), sin(a)) / uSize;
    acc += texture(t, clamp(uv + dir * radius, 0.0, 1.0));
    acc += texture(t, clamp(uv + dir * radius * 0.5, 0.0, 1.0)) * 1.5;
    w += 2.5;
  }
  return acc / w;
}

void main() {
  float p = clamp(uP, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  vec2 uv = vUV;
  vec4 a = texture(uA, uv);
  vec4 b = texture(uB, uv);
  vec4 c;
  if (uKind == 0) c = p < 0.5 ? a : b;
  else if (uKind == 1) c = mix(a, b, p);
  else if (uKind == 2 || uKind == 3) {
    vec4 solid = uKind == 2 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    c = p < 0.5 ? mix(a, solid, p * 2.0) : mix(solid, b, (p - 0.5) * 2.0);
  }
  else if (uKind == 4) c = uv.x >= 1.0 - e ? b : a;           // Wischen ←
  else if (uKind == 5) c = uv.x <= e ? b : a;                 // Wischen →
  else if (uKind == 6) c = uv.y <= e ? b : a;                 // Wischen ↑
  else if (uKind == 7) c = uv.y >= 1.0 - e ? b : a;           // Wischen ↓
  else if (uKind == 8) c = uv.x >= 1.0 - e ? texture(uB, vec2(uv.x - (1.0 - e), uv.y)) : texture(uA, vec2(uv.x + e, uv.y));
  else if (uKind == 9) c = uv.x < e ? texture(uB, vec2(uv.x + 1.0 - e, uv.y)) : texture(uA, vec2(uv.x - e, uv.y));
  else if (uKind == 10) c = uv.y < e ? texture(uB, vec2(uv.x, uv.y + 1.0 - e)) : texture(uA, vec2(uv.x, uv.y - e));
  else if (uKind == 11) c = uv.y >= 1.0 - e ? texture(uB, vec2(uv.x, uv.y - (1.0 - e))) : texture(uA, vec2(uv.x, uv.y + e));
  else if (uKind == 12) {
    float s = 1.0 + 0.5 * e;
    vec4 za = texture(uA, (uv - 0.5) / s + 0.5);
    c = mix(za, b, p);
  }
  else if (uKind == 13) {
    float r = sin(p * 3.14159265) * 30.0;
    c = mix(blur(uA, uv, r), blur(uB, uv, r), p);
  }
  else {
    float radius = length(uSize) * 0.5 * e;
    float dist = length((uv - 0.5) * uSize);
    c = mix(a, b, 1.0 - smoothstep(radius, radius + 2.0, dist));
  }
  outColor = vec4(c.rgb, 1.0);
}`;

/** Pass 3: Look (Grading, Preset, LUT) und Ausgabe in den Bereich des Gesamtbildes. */
export const LOOK_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uExposure, uContrast, uSaturation, uVibrance, uTemp, uTint;
uniform int uHasManualCurve;
uniform sampler2D uManualCurve;
uniform int uPreset;
uniform float uPresetAmount;
uniform int uHasPresetCurve;
uniform sampler2D uPresetCurve;
uniform sampler3D uCineLUT;
uniform int uHasLUT;
uniform float uLUTAmount;
uniform sampler3D uLUT;
uniform float uLUTSize;

const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGam(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 exposure(vec3 c, float ev) { return toGam(toLin(c) * exp2(ev)); }
vec3 controls(vec3 c, float contrast, float sat) {
  float l = dot(c, W);
  c = mix(vec3(l), c, sat);
  return (c - 0.5) * contrast + 0.5;
}
vec3 vibrance(vec3 c, float amount) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = dot(c, W);
  return mix(vec3(l), c, 1.0 + amount * (1.0 - (mx - mn)));
}
vec3 balance(vec3 c, float warm, float magenta) { return c * vec3(1.0 + warm, 1.0 - magenta, 1.0 - warm); }
vec3 curve(sampler2D t, vec3 c) {
  c = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  return vec3(texture(t, vec2(c.r, 0.5)).r, texture(t, vec2(c.g, 0.5)).r, texture(t, vec2(c.b, 0.5)).r);
}
vec3 lut(sampler3D t, float size, vec3 c) {
  vec3 uvw = clamp(c, 0.0, 1.0) * ((size - 1.0) / size) + 0.5 / size;
  return texture(t, uvw).rgb;
}

vec3 preset(vec3 c) {
  if (uPreset == 1) { c = lut(uCineLUT, 32.0, c); return curve(uPresetCurve, c); }
  if (uPreset == 2) return controls(c, 1.12, 0.0);
  if (uPreset == 3) {
    c = balance(c, 0.09, 0.01);
    c = vibrance(c, 0.45);
    c = exposure(c, 0.12);
    return controls(c, 1.06, 1.1);
  }
  if (uPreset == 4) { c = balance(c, 0.07, 0.02); c = controls(c, 0.92, 0.75); return curve(uPresetCurve, c); }
  if (uPreset == 5) { c = balance(c, -0.09, -0.01); return controls(c, 1.05, 0.92); }
  if (uPreset == 6) { c = controls(c, 0.95, 0.82); return curve(uPresetCurve, c); }
  if (uPreset == 7) { c = vibrance(c, 0.6); return controls(c, 1.12, 1.12); }
  if (uPreset == 8) { c = controls(c, 1.1, 0.0); return curve(uPresetCurve, c); }
  return c;
}

void main() {
  vec3 c = texture(uTex, vUV).rgb;
  if (uExposure != 0.0) c = exposure(c, uExposure);
  if (uContrast != 0.0 || uSaturation != 0.0) c = controls(c, 1.0 + uContrast * 0.45, 1.0 + uSaturation);
  if (uVibrance != 0.0) c = vibrance(c, uVibrance);
  if (uTemp != 0.0 || uTint != 0.0) c = balance(c, uTemp * 0.12, uTint * 0.08);
  if (uHasManualCurve == 1) c = curve(uManualCurve, c);
  if (uPreset != 0) c = mix(c, preset(c), uPresetAmount);
  if (uHasLUT == 1) c = mix(c, lut(uLUT, uLUTSize, c), uLUTAmount);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** Titel und Flächen (mit Deckkraft) über das Bild legen. */
export const OVERLAY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uAlpha;
void main() {
  vec4 c = texture(uTex, vec2(vUV.x, 1.0 - vUV.y));
  outColor = vec4(c.rgb, c.a * uAlpha);
}`;
