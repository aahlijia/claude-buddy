/**
 * HD turtle — the slow, armored one (H6). A green land turtle facing right:
 * the domed shell is the root body (it breathes), built from pillow-shaded
 * scute plates over a dark seam layer with a pale rim along its base. The
 * head pokes out front-right on a short neck tucked under the shell, four
 * stubby legs stand below the rim, and a tiny tail peeks out behind.
 * `feel.tempo` slows idle and walk to a turtle's pace.
 */

import type { PartDef, RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kk.", "kwkk", "kkkk", "kkkk", ".kk."] },
  half: { kind: "grid", rows: ["....", "....", "kkkk", "kkkk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "....", "kkkk", "...."] },
  happy: { kind: "grid", rows: ["....", ".kk.", "k..k", "....", "...."] },
  x: { kind: "grid", rows: ["k..k", ".kk.", ".kk.", "k..k", "...."] },
  angry: { kind: "grid", rows: ["kk..", ".kkk", "kwkk", "kkkk", ".kk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k...k", ".kkk."] },
  open: { kind: "grid", rows: [".kkk.", "kpppk", ".kkk."] },
  frown: { kind: "grid", rows: [".kkk.", "k...k"] },
};

/** Shell dome: the top of a superellipse with a flat base (w × h). */
function dome(w: number, h: number): Shape {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * (i / 20);
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([w / 2 - (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.85), h - h * Math.pow(s, 0.85)]);
  }
  return { kind: "poly", pts, mat: "d" };
}

/** A six-sided scute, w × h, pointy at the left and right. */
const scute = (w: number, h: number): Shape => ({
  kind: "poly",
  pts: [[0, h / 2], [w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h]],
  mat: "s",
});

/** Scute plates in shell-local pixels: [cx, cy, w, h]. */
const PLATES: readonly (readonly [number, number, number, number])[] = [
  [15, 6.5, 10, 8.5],
  [7, 10.5, 8, 8],
  [23, 10.5, 8, 8],
  [3.2, 17.5, 5, 5],
  [8.6, 18, 5.8, 5],
  [15, 18, 6.2, 5],
  [21.4, 18, 5.8, 5],
  [26.8, 17.5, 5, 5],
];

const plates: PartDef[] = PLATES.map(([cx, cy, w, h], i) => ({
  name: `plate${i}`,
  role: "detail" as const,
  parent: "body",
  at: [cx, cy] as const,
  pivot: [w / 2, h / 2] as const,
  z: 1.05,
  group: "body",
  shape: scute(w, h),
}));

/** Sturdy tortoise legs: it stands tall rather than sprawling. */
const leg: Shape = { kind: "ellipse", rx: 3.4, ry: 6.4, p: 2.6, mat: "l" };

export const TURTLE: RigDef = {
  id: "turtle",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 19,
  outline: hex("#14200f"),
  feel: { tempo: 0.6 },
  materials: {
    d: {
      ramp: ramp("#1a2a12", "#24391a", "#304a20", "#3c5a28", "#486a30"),
      shiny: ramp("#3a200c", "#4e2c12", "#663a18", "#7c4a1e", "#905a26"),
    },
    s: {
      ramp: ramp("#2a4a1c", "#3e6e28", "#5a9a36", "#86c24e", "#bce47a"),
      shiny: ramp("#6a3a10", "#9a5a18", "#d08a2a", "#f0b84a", "#ffe08a"),
      gloss: 0.25,
    },
    r: {
      ramp: ramp("#5a5a26", "#8a8a3a", "#bcb85a", "#dcd682", "#f4f0b4"),
      shiny: ramp("#6a4a20", "#9a6e30", "#c8984a", "#e6c276", "#fae8b0"),
    },
    l: {
      ramp: ramp("#3a4a1c", "#5e7a2c", "#88aa44", "#b2d064", "#dcf09a"),
      shiny: ramp("#1e3a4e", "#2e5a76", "#4a86a8", "#78b4d0", "#b4e0f0"),
    },
    c: { ramp: ramp("#8a8a4a", "#b8b86a", "#dcdc92", "#f0f0ba", "#fcfce0") },
    k: { ramp: ramp("#141c10"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#d0506a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [25, 39.4], pivot: [15, 22], z: 1, group: "body", shape: dome(30, 22) },
    ...plates,
    { name: "rim", role: "belly", parent: "body", at: [15, 22], pivot: [16.5, 2.6], z: 1.2, shape: { kind: "ellipse", rx: 16.5, ry: 2.6, mat: "r" } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [8, 21.5], pivot: [3.3, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [24, 21.5], pivot: [3.3, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [5, 22.5], pivot: [3.3, 1.5], z: 1.5, shape: leg },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [21, 22.5], pivot: [3.3, 1.5], z: 1.5, shape: leg },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [2, 20.5], pivot: [4, 1.5], rot: -0.25, z: 0.4, shape: { kind: "poly", pts: [[0, 2], [4, 0], [4.5, 3.5]], mat: "l" } },

    { name: "head", role: "head", parent: "body", at: [26, 10.5], pivot: [1, 11], z: 2, shape: { kind: "ellipse", rx: 7.5, ry: 6.6, p: 2.1, mat: "l" } },
    { name: "neck", role: "detail", parent: "head", at: [1.5, 10], pivot: [4.6, 2], rot: -0.35, z: 0.8, group: "head", shape: { kind: "ellipse", rx: 4.6, ry: 8, mat: "l" } },
    { name: "chin", role: "snout", parent: "head", at: [10, 11.2], pivot: [4.5, 2], z: 2.05, group: "head", shape: { kind: "ellipse", rx: 4.5, ry: 2, mat: "c" } },
    { name: "eyeF", role: "eye", parent: "head", at: [7, 5.5], pivot: [2, 2.5], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [12.5, 5.5], pivot: [2, 2.5], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "mouth", role: "mouth", parent: "head", at: [11, 9.5], pivot: [2.5, 0], z: 2.3, group: "head", shape: MOUTH.smile, variants: MOUTH },
  ],
};
