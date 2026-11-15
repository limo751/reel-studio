// Tempo-Rampe (Speed Ramp) für Video-Clips:
// sanft von 1× auf das Zieltempo beschleunigen (Fade-in), halten, und am Ende sanft auf 1× abbremsen (Fade-out).
// Alle Berechnungen sind geschlossen lösbar: Die Geschwindigkeit folgt einer Smoothstep-Kurve,
// deren Integral x³ − x⁴/2 ist.

export const MAX_SPEED = 10;

export interface Ramp {
  speed: number;    // Zieltempo (1 … 10)
  rampIn: number;   // Dauer des Beschleunigens in Sekunden (auf der Zeitachse)
  rampOut: number;  // Dauer des Abbremsens in Sekunden
  length: number;   // Länge des Abschnitts auf der Zeitachse
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const smoothIntegral = (x: number) => x * x * x - (x * x * x * x) / 2; // ∫₀ˣ smooth

/** Rampenlängen so begrenzen, dass sie zusammen in den Abschnitt passen. */
function fitted(r: Ramp) {
  let a = Math.max(0, r.rampIn), b = Math.max(0, r.rampOut);
  if (a + b > r.length && a + b > 0) { const k = r.length / (a + b); a *= k; b *= k; }
  return { a, b, L: r.length, S: Math.max(1, Math.min(MAX_SPEED, r.speed)) };
}

/** Momentane Geschwindigkeit bei Zeit u (0 … length) im Abschnitt. */
export function rampVelocity(r: Ramp, u: number): number {
  const { a, b, L, S } = fitted(r);
  u = Math.min(Math.max(0, u), L);
  if (a > 0 && u < a) return 1 + (S - 1) * smooth(u / a);
  if (b > 0 && u > L - b) return 1 + (S - 1) * smooth((L - u) / b);
  return S;
}

/** Verstrichene Quellzeit (Sekunden im Video) nach u Sekunden auf der Zeitachse. */
export function rampSource(r: Ramp, u: number): number {
  const { a, b, L, S } = fitted(r);
  u = Math.min(Math.max(0, u), L);
  const inPart = (x: number) => x + (S - 1) * a * smoothIntegral(x / a);   // 0 ≤ x ≤ a
  const Ia = a > 0 ? inPart(a) : 0;
  if (a > 0 && u <= a) return inPart(u);
  const mid = L - b;
  if (u <= mid || b === 0) return Ia + S * (u - a);
  const Imid = Ia + S * (mid - a);
  return Imid + (u - mid) + (S - 1) * b * (0.5 - smoothIntegral((L - u) / b));
}

/** Rampe eines Clips (oder null, wenn er in normaler Geschwindigkeit läuft). */
export function clipRamp(clip: { speed?: number; rampIn?: number; rampOut?: number }, length: number): Ramp | null {
  const speed = clip.speed ?? 1;
  if (speed <= 1.001 || length <= 0) return null;
  return { speed, rampIn: clip.rampIn ?? 0.5, rampOut: clip.rampOut ?? 0.5, length };
}

/**
 * Reicht das Videomaterial nicht für das gewünschte Tempo, wird das Höchsttempo so weit gesenkt,
 * dass genau `available` Sekunden verbraucht werden. Liefert null, wenn selbst 1× zu viel wäre.
 */
export function fitRamp(r: Ramp, available: number): Ramp | null {
  if (rampSource(r, r.length) <= available) return r;
  if (r.length >= available) return null;
  let lo = 1, hi = r.speed;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rampSource({ ...r, speed: mid }, r.length) > available) hi = mid; else lo = mid;
  }
  return { ...r, speed: lo };
}
