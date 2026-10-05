/**
 * Easing curves and small motion helpers. Everything takes t ∈ [0, 1]
 * (clamped) and returns a progress value; nothing moves linearly.
 */

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export const linear = (t: number) => clamp01(t);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Overshoots past 1 then settles — pop-ins. */
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** Springy settle — UI bounces, jelly bodies. */
export const easeOutElastic = (t: number) => {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

/** Damped spring response to a unit impulse at t=0 (seconds): starts at 1, rings to 0. */
export function springDecay(t: number, freqHz = 3, damping = 5): number {
  if (t < 0) return 0;
  return Math.exp(-damping * t) * Math.cos(2 * Math.PI * freqHz * t);
}

/** Map `t` from [a, b] into [0, 1] (clamped). */
export function span(t: number, a: number, b: number): number {
  return b === a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a));
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
