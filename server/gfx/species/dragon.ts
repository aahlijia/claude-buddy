/**
 * HD dragon — the showpiece rig (H1 pilot). A teal wyrmling facing right:
 * two membrane wings (far one in shade), horns swept back, a gold plated
 * belly, back spikes, and a six-segment tail ending in a spade. Wings and
 * tail get their flap and follow-through from the shared motion library.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kk.", "kwgk", "kgkk", "kgkk", ".kk."] },
  half: { kind: "grid", rows: ["....", "....", "kkkk", "kgkk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "....", "kkkk", "...."] },
  happy: { kind: "grid", rows: ["....", ".kk.", "k..k", "....", "...."] },
  x: { kind: "grid", rows: ["k..k", ".kk.", ".kk.", "k..k", "...."] },
  angry: { kind: "grid", rows: ["kk..", ".kkk", "kwgk", "kgkk", ".kk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: [".kkk."] },
  open: { kind: "grid", rows: ["kkkkk", "kwrrk", ".kkkk"] },
  frown: { kind: "grid", rows: ["..kk.", "kk..."] },
};

const leg: Shape = { kind: "ellipse", rx: 3.2, ry: 5.2, mat: "d" };
const tail = (rx: number): Shape => ({ kind: "ellipse", rx, ry: 3.3, mat: "d" });
/** Bat-wing membrane; pivot at the shoulder (bottom-right). */
const wing: Shape = {
  kind: "poly",
  pts: [[24, 22], [23, 6], [19, 0.5], [15, 8], [10, 4], [8, 12], [1.5, 10], [5, 18], [14, 20]],
  mat: "m",
};

/** A thin quad from (x0,y0) to (x1,y1), `w` pixels wide — wing struts. */
function strut(x0: number, y0: number, x1: number, y1: number, w: number): [number, number][] {
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / l) * (w / 2);
  const ny = ((x1 - x0) / l) * (w / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}

/** Arm + finger bones over the membrane (same pivot frame as `wing`). */
const wingBones: Shape[] = [
  { kind: "poly", pts: strut(24, 22, 19.5, 1, 2.2), mat: "d" },
  { kind: "poly", pts: strut(19.5, 1.5, 15, 8, 1.4), mat: "d" },
  { kind: "poly", pts: strut(19.5, 1.5, 8.5, 11, 1.4), mat: "d" },
  { kind: "poly", pts: strut(19.5, 1.5, 2.5, 10, 1.4), mat: "d" },
];
const horn: Shape = { kind: "poly", pts: [[0, 7], [0.8, 0], [3.6, 3.2], [3.4, 7]], mat: "h" };

export const DRAGON: RigDef = {
  id: "dragon",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 18,
  outline: hex("#0c1418"),
  materials: {
    d: {
      ramp: ramp("#123a3a", "#1e6260", "#2f9a88", "#5cc9a6", "#a8f0c8"),
      shiny: ramp("#3a1240", "#6a2068", "#a83c9a", "#e070c4", "#ffb0e6"),
      gloss: 0.6,
    },
    b: {
      ramp: ramp("#6a4a18", "#a8782a", "#e0b04a", "#f8d878", "#fff2b8"),
      shiny: ramp("#4a4a6a", "#7a7aa8", "#b0b0e0", "#d8d8f8", "#ffffff"),
    },
    m: {
      ramp: ramp("#3a1a3a", "#6a2a52", "#a8456e", "#d8708a", "#f5a8b0"),
      shiny: ramp("#1a2a4a", "#2a4a7a", "#4a7ab0", "#7ab0e0", "#b8e0ff"),
    },
    h: { ramp: ramp("#5a5048", "#9a8a78", "#d8ccb4", "#f4ecd8", "#ffffff") },
    n: { ramp: ramp("#6a4a18", "#8a6224", "#a8782a", "#c08a32", "#d8a040") },
    k: { ramp: ramp("#10161c"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    g: { ramp: ramp("#ffb020"), flat: true },
    r: { ramp: ramp("#e8506a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 37.5], pivot: [14, 9.5], z: 1, shape: { kind: "ellipse", rx: 14, ry: 9.5, mat: "d" } },
    { name: "belly", role: "belly", parent: "body", at: [17, 13.5], pivot: [9, 4.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 9, ry: 4.5, mat: "b" } },
    { name: "plates", role: "detail", parent: "belly", at: [3, 1.5], pivot: [0, 0], z: 1.12, group: "body", shape: { kind: "grid", rows: ["..n...n...n.", ".n...n...n..", "n...n...n..."] } },
    { name: "spikes", role: "detail", parent: "body", at: [4, -2.5], pivot: [0, 0], z: 0.9, group: "spikes", shape: { kind: "grid", rows: ["..h....h....h...", ".hh...hh...hh...", "hhh..hhh..hhh..."] } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [15, 4], pivot: [24, 22], rot: -0.3, z: 0.1, shade: 0.68, group: "wingF", shape: wing },
    ...wingBones.map((shape, i) => ({ name: `wingFb${i}`, role: "detail" as const, parent: "wingF", at: [24, 22] as const, pivot: [24, 22] as const, z: 0.11, shade: 0.68, group: "wingF", shape })),
    { name: "wingN", role: "wing", side: 1, parent: "body", at: [12, 5], pivot: [24, 22], rot: 0.05, z: 1.6, group: "wingN", shape: wing },
    ...wingBones.map((shape, i) => ({ name: `wingNb${i}`, role: "detail" as const, parent: "wingN", at: [24, 22] as const, pivot: [24, 22] as const, z: 1.61, group: "wingN", shape })),

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [7, 13], pivot: [3.2, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [21, 13], pivot: [3.2, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [10, 13.5], pivot: [3.2, 1.5], z: 1.5, shape: leg },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [24, 13.5], pivot: [3.2, 1.5], z: 1.5, shape: leg },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [2, 11], pivot: [3.4, 6], rot: -1.35, z: 0.3, group: "tail", shape: tail(3.4) },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [3.4, 2], pivot: [3, 6.4], rot: 0.42, z: 0.31, group: "tail", shape: tail(3) },
    { name: "tail2", role: "tail", seg: 2, parent: "tail1", at: [3, 2], pivot: [2.6, 6.4], rot: 0.42, z: 0.32, group: "tail", shape: tail(2.6) },
    { name: "tail3", role: "tail", seg: 3, parent: "tail2", at: [2.6, 2], pivot: [2.2, 6.4], rot: 0.42, z: 0.33, group: "tail", shape: tail(2.2) },
    { name: "tail4", role: "tail", seg: 4, parent: "tail3", at: [2.2, 2], pivot: [1.8, 6.4], rot: 0.42, z: 0.34, group: "tail", shape: tail(1.8) },
    { name: "spade", role: "tail", seg: 5, parent: "tail4", at: [1.8, 1.5], pivot: [4, 6], rot: 0.2, z: 0.35, shape: { kind: "poly", pts: [[0, 6], [4, 0], [8, 6], [4, 4.5]], mat: "m" } },

    { name: "head", role: "head", parent: "body", at: [24, 4.5], pivot: [6.5, 12], z: 3, shape: { kind: "ellipse", rx: 8.5, ry: 7.5, p: 2.2, mat: "d" } },
    { name: "snout", role: "snout", parent: "head", at: [13.5, 9.5], pivot: [2, 3.8], z: 3.05, group: "head", shape: { kind: "ellipse", rx: 6.2, ry: 3.8, p: 2.4, mat: "d" } },
    { name: "nostril", role: "detail", parent: "head", at: [22, 7.5], pivot: [0, 0], z: 3.2, group: "head", shape: { kind: "grid", rows: ["k"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [16.5, 11.5], pivot: [0, 0], z: 3.2, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [7.5, 5.5], pivot: [2, 2.5], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [12.5, 5.5], pivot: [2, 2.5], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "hornF", role: "horn", side: -1, parent: "head", at: [4, 2.5], pivot: [1.8, 7], rot: -0.85, z: 2.95, shade: 0.8, shape: horn },
    { name: "hornN", role: "horn", side: 1, parent: "head", at: [8.5, 1.8], pivot: [1.8, 7], rot: -0.7, z: 3.1, shape: horn },
  ],
};
