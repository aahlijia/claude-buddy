/**
 * HD wyvern — the dragon's wilder cousin (H6). A crimson wyvern facing right,
 * drawn to read apart from the teal four-legged `dragon` at a glance: it
 * stands upright on TWO strong hind legs (both `legB`, near and far), and its
 * wings ARE its arms — big raised ember membranes with a wrist claw, pivoting
 * at the shoulder. A long neck lifts a pointed snout and back-swept horns,
 * and a long tail chain ends in a barbed arrowhead. Big amber eyes keep
 * the menace cute.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kkk.", "kwwkk", "kwkkk", "kkkkk", "kgggk", ".kkk."] },
  half: { kind: "grid", rows: [".....", ".....", "kkkkk", "kkkkk", "kgggk", ".kkk."] },
  closed: { kind: "grid", rows: [".....", ".....", ".....", ".....", "kkkkk", "....."] },
  happy: { kind: "grid", rows: [".....", ".....", ".kkk.", "k...k", ".....", "....."] },
  x: { kind: "grid", rows: [".....", "k...k", ".k.k.", "..k..", ".k.k.", "k...k"] },
  angry: { kind: "grid", rows: ["kk...", ".kkkk", "kwkkk", "kkkkk", "kgggk", ".kkk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k...k.", ".kkk.."] },
  open: { kind: "grid", rows: ["kkkkkk", "kwrrrk", ".kkkk."] },
  frown: { kind: "grid", rows: [".kkkk.", "k....."] },
};

/** A thin quad from (x0,y0) to (x1,y1), `w` pixels wide — wing bones. */
function strut(x0: number, y0: number, x1: number, y1: number, w: number): [number, number][] {
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / l) * (w / 2);
  const ny = ((x1 - x0) / l) * (w / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}

/** Wing-arm membrane; pivot at the shoulder (bottom-right). */
const wing: Shape = {
  kind: "poly",
  pts: [[23, 20], [21.5, 4.5], [19, 1], [14.5, 5.5], [11, 2.5], [8.5, 8.5], [3, 6], [1, 8.5], [5.5, 14], [11.5, 16.5], [18, 19]],
  mat: "m",
};
/** Arm bone (shoulder → wrist), finger bones fanning back, and the wrist claw. */
const wingBones: Shape[] = [
  { kind: "poly", pts: strut(23, 20, 19, 1.5, 2.6), mat: "d" },
  { kind: "poly", pts: strut(19, 1.5, 11.5, 3, 1.4), mat: "d" },
  { kind: "poly", pts: strut(19, 1.5, 9, 8.5, 1.4), mat: "d" },
  { kind: "poly", pts: strut(19, 1.5, 2, 7, 1.4), mat: "d" },
  { kind: "poly", pts: [[18, 2], [22.5, 0], [20.5, 3.5]], mat: "h" },
];

/** A hind leg: a heavy drumstick thigh; the clawed foot is its child. */
const thigh: Shape = { kind: "ellipse", rx: 4.6, ry: 5.2, mat: "d" };
const foot: Shape = { kind: "poly", pts: [[0, 0], [5, 0], [8.5, 1.6], [10, 3.2], [0, 3.2]], mat: "d" };
const claws: Shape = { kind: "grid", rows: ["h.h.h"] };

const tail = (rx: number): Shape => ({ kind: "ellipse", rx, ry: 3.9, mat: "d" });
const horn: Shape = { kind: "poly", pts: [[0, 9], [0.6, 4], [2.4, 0], [3.8, 4.5], [3.8, 9]], mat: "h" };

export const WYVERN: RigDef = {
  id: "wyvern",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 16,
  feel: { waddle: 0.06, tempo: 0.9 },
  outline: hex("#1a0810"),
  materials: {
    d: {
      ramp: ramp("#24060e", "#4a0c1a", "#781628", "#a82434", "#d24c48"),
      shiny: ramp("#141c3a", "#22306a", "#3650a2", "#5c80d4", "#a0c4f6"),
      gloss: 0.55,
    },
    m: {
      ramp: ramp("#6a2208", "#a83c10", "#e06a1e", "#f8a040", "#ffd88a"),
      shiny: ramp("#0e3a40", "#186466", "#28a09a", "#56d2c0", "#a8f6e6"),
    },
    b: {
      ramp: ramp("#6a4428", "#a0704a", "#d8a878", "#f0d4a4", "#fff2d6"),
      shiny: ramp("#4a4a5a", "#7a7a92", "#b0b0c8", "#d8d8ea", "#ffffff"),
    },
    h: { ramp: ramp("#4a3a30", "#8a7462", "#c8b49a", "#ece0c8", "#ffffff") },
    n: { ramp: ramp("#8a5a34", "#9a6a40", "#b07e50", "#c08e5c", "#d0a06a") },
    k: { ramp: ramp("#160a10"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    g: { ramp: ramp("#ffb428"), flat: true },
    r: { ramp: ramp("#ff6a5a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [33, 37], pivot: [10.5, 9.5], rot: -0.25, z: 1, shape: { kind: "ellipse", rx: 10.5, ry: 9.5, mat: "d" } },
    { name: "belly", role: "belly", parent: "body", at: [14, 11], pivot: [6, 6.5], rot: -0.35, z: 1.1, group: "body", shape: { kind: "ellipse", rx: 6, ry: 6.5, mat: "b" } },
    { name: "plates", role: "detail", parent: "belly", at: [2.5, 2], pivot: [0, 0], z: 1.12, group: "body", shape: { kind: "grid", rows: [".nnnn.", "......", "nnnnnn", "......", ".nnnn."] } },
    { name: "spines", role: "detail", parent: "body", at: [1.5, 0.5], pivot: [0, 0], rot: -0.35, z: 0.9, group: "spines", shape: { kind: "grid", rows: ["....h....h", "...hh...hh", "..hhh..hhh"] } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [14, 4], pivot: [23, 20], rot: -0.05, z: 0.1, shade: 0.66, group: "wingF", shape: wing },
    ...wingBones.map((shape, i) => ({ name: `wingFb${i}`, role: "detail" as const, parent: "wingF", at: [23, 20] as const, pivot: [23, 20] as const, z: 0.11, shade: 0.66, group: "wingF", shape })),

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9, 14], pivot: [4.6, 2], z: 0.5, shade: 0.7, group: "legBF", shape: thigh },
    { name: "footF", role: "detail", parent: "legBF", at: [3.5, 9.5], pivot: [2, 1], z: 0.51, shade: 0.7, group: "legBF", shape: foot },
    { name: "clawsF", role: "detail", parent: "footF", at: [5, 3], pivot: [0, 0], z: 0.52, shade: 0.7, group: "legBF", shape: claws },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [13, 15.5], pivot: [4.6, 2], z: 1.5, group: "legBN", shape: thigh },
    { name: "footN", role: "detail", parent: "legBN", at: [3.5, 9.5], pivot: [2, 1], z: 1.51, group: "legBN", shape: foot },
    { name: "clawsN", role: "detail", parent: "footN", at: [5, 3], pivot: [0, 0], z: 1.52, group: "legBN", shape: claws },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [5.5, 14], pivot: [3, 6.5], rot: -1.65, z: 0.3, group: "tail", shape: tail(3) },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [3, 2], pivot: [2.5, 6.6], rot: 0.2, z: 0.31, group: "tail", shape: tail(2.5) },
    { name: "tail2", role: "tail", seg: 2, parent: "tail1", at: [2.5, 2], pivot: [2, 6.6], rot: 0.35, z: 0.32, group: "tail", shape: tail(2) },
    { name: "tail3", role: "tail", seg: 3, parent: "tail2", at: [2, 2], pivot: [1.6, 6.6], rot: 0.45, z: 0.33, group: "tail", shape: tail(1.6) },
    { name: "barb", role: "tail", seg: 4, parent: "tail3", at: [1.6, 1.5], pivot: [3.5, 7], rot: 0.2, z: 0.35, shape: { kind: "poly", pts: [[0, 6], [3.5, 0], [7, 6], [4.5, 5], [3.5, 7.5], [2.5, 5]], mat: "m" } },

    { name: "head", role: "head", parent: "body", at: [18, 5.5], pivot: [1, 18], z: 3, shape: { kind: "ellipse", rx: 8, ry: 7, p: 2.2, mat: "d" } },
    { name: "neck", role: "detail", parent: "head", at: [-3, 0], pivot: [0, 0], z: 2.9, group: "neck", shape: { kind: "poly", pts: [[0.5, 20], [8, 20], [10.5, 13], [12.5, 8.5], [5.5, 7.5], [2.5, 13]], mat: "d" } },
    { name: "snout", role: "snout", parent: "head", at: [11, 8.5], pivot: [0, 3], z: 3.05, group: "head", shape: { kind: "poly", pts: [[0, 0.5], [5.5, 1.2], [9.5, 3], [10, 4.4], [5.5, 6.2], [0, 6.5]], mat: "d" } },
    { name: "nostril", role: "detail", parent: "head", at: [18.5, 7.5], pivot: [0, 0], z: 3.2, group: "head", shape: { kind: "grid", rows: ["k"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [13, 10], pivot: [0, 0], z: 3.2, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [5.5, 6], pivot: [2.5, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [11.5, 6], pivot: [2.5, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "hornF", role: "horn", side: -1, parent: "head", at: [3, 3], pivot: [1.8, 8], rot: -1.2, z: 2.95, shade: 0.8, shape: horn },
    { name: "hornN", role: "horn", side: 1, parent: "head", at: [6.5, 2], pivot: [1.8, 8], rot: -1.05, z: 3.1, shape: horn },

    { name: "wingN", role: "wing", side: 1, parent: "body", at: [11, 5], pivot: [23, 20], rot: 0.12, z: 1.6, group: "wingN", shape: wing },
    ...wingBones.map((shape, i) => ({ name: `wingNb${i}`, role: "detail" as const, parent: "wingN", at: [23, 20] as const, pivot: [23, 20] as const, z: 1.61, group: "wingN", shape })),
  ],
};
