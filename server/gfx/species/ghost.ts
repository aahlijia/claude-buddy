/**
 * HD ghost — the no-legs, see-through pilot (H6). A pale sheet ghost facing
 * right: a dome head over a scalloped hem, two stubby arms, and a three-part
 * wisp trailing behind. Its sheet is a translucent material (`alpha`), and
 * `feel.float` keeps it hovering above its shadow with a slow bob and a
 * shimmer, sinking to the floor only when knocked out.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kk.", "kwkk", "kkkk", "kkkk", "kkkk", ".kk."] },
  half: { kind: "grid", rows: ["....", "....", "kkkk", "kkkk", "kkkk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "....", "....", "kkkk", "...."] },
  happy: { kind: "grid", rows: ["....", "....", ".kk.", "k..k", "....", "...."] },
  x: { kind: "grid", rows: ["....", "k..k", ".kk.", ".kk.", "k..k", "...."] },
  angry: { kind: "grid", rows: ["k...", ".kk.", "kwkk", "kkkk", "kkkk", ".kk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

/** The sheet below the dome: straight sides, a scalloped hem. */
const sheet: Shape = {
  kind: "poly",
  pts: [[1, 0], [23, 0], [24.5, 12], [24, 19], [21.5, 16.5], [18.5, 20], [15, 17], [11.5, 20.5], [8, 17], [4.5, 20], [1.5, 16.5], [-0.5, 18], [0, 8]].map(([x, y]) => [x + 1, y] as [number, number]),
  mat: "g",
};
const arm: Shape = { kind: "ellipse", rx: 2.6, ry: 4.4, mat: "g" };
const wisp = (r: number): Shape => ({ kind: "ellipse", rx: r, ry: 3.2, mat: "g" });

export const GHOST: RigDef = {
  id: "ghost",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 14,
  outline: hex("#2a2440"),
  feel: { float: 5 },
  materials: {
    g: {
      ramp: ramp("#6a6290", "#9a92c4", "#cac4ec", "#ebe8ff", "#ffffff"),
      shiny: ramp("#5a7a52", "#86b07a", "#b8e0a8", "#e0f8cc", "#ffffff"),
      alpha: 0.9,
    },
    c: { ramp: ramp("#ff9ab8"), flat: true, alpha: 0.8 },
    k: { ramp: ramp("#1a1428"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#5a2a50"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 40.5], pivot: [13, 10], z: 1, group: "sheet", shape: sheet },
    { name: "head", role: "head", parent: "body", at: [13, 5], pivot: [12.5, 17], z: 1.2, group: "sheet", shape: { kind: "ellipse", rx: 12.5, ry: 11.5, mat: "g" } },

    { name: "armF", role: "legF", side: -1, parent: "body", at: [7, 6], pivot: [2.6, 1], rot: 0.9, z: 0.5, shade: 0.75, shape: arm },
    { name: "armN", role: "legF", side: 1, parent: "body", at: [18, 8], pivot: [2.6, 1], rot: -0.5, z: 2, shape: arm },

    { name: "wisp0", role: "tail", seg: 0, parent: "body", at: [3, 14], pivot: [3, 1], rot: 1.2, z: 0.6, group: "sheet", shape: wisp(3) },
    { name: "wisp1", role: "tail", seg: 1, parent: "wisp0", at: [3, 5], pivot: [2.3, 1], rot: 0.35, z: 0.61, group: "sheet", shape: wisp(2.3) },
    { name: "wisp2", role: "tail", seg: 2, parent: "wisp1", at: [2.3, 5], pivot: [1.6, 1], rot: 0.45, z: 0.62, group: "sheet", shape: wisp(1.6) },

    { name: "eyeF", role: "eye", parent: "head", at: [13, 10], pivot: [2, 3], z: 1.4, group: "sheet", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [19.5, 10], pivot: [2, 3], z: 1.4, group: "sheet", shape: EYE.open, variants: EYE },
    { name: "cheek", role: "detail", parent: "head", at: [20.5, 14.5], pivot: [0, 0], z: 1.35, group: "sheet", shape: { kind: "grid", rows: ["ccc"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [16.5, 15], pivot: [2, 0], z: 1.4, group: "sheet", shape: MOUTH.smile, variants: MOUTH },
  ],
};
