/**
 * HD snail — the no-legs, slow-and-steady one (H6). A soft slug foot glides
 * along the ground facing right as the root body; a big swirled shell rides
 * on its back, built from nested, offset ellipses so the inner lines between
 * them draw the spiral. Two eye stalks rise from the head as `ear` parts with
 * the eye bulbs parented to their tips, so the eyes twitch, pin back on a hit
 * and droop on KO with the stalks. The foot's tapered end is a one-segment
 * tail. `feel.tempo` keeps idle and walk at a snail's pace.
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
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

const stalk: Shape = { kind: "poly", pts: [[0, 11], [1, 0], [2.6, 0], [3.4, 11]], mat: "b" };
const bulb: Shape = { kind: "ellipse", rx: 3.4, ry: 3.4, mat: "b" };

/** Shell swirl, outermost first: [cx, cy, r, material] around the shell centre. */
const SWIRL: readonly (readonly [number, number, number, string])[] = [
  [0, 0, 12.5, "s"],
  [-1.6, 0.8, 9.4, "t"],
  [0.2, 1.8, 6.6, "s"],
  [-0.8, 1.6, 4, "t"],
  [0.2, 1.4, 1.8, "s"],
];

const swirl: PartDef[] = SWIRL.slice(1).map(([cx, cy, r, mat], i) => ({
  name: `swirl${i}`,
  role: "detail" as const,
  parent: "shell",
  at: [12.5 + cx, 12.5 + cy] as const,
  pivot: [r, r] as const,
  z: 1.31 + i * 0.01,
  shape: { kind: "ellipse" as const, rx: r, ry: r, mat },
}));

/** One eye stalk with its bulb and eye riding the tip. */
function eyeStalk(id: string, side: -1 | 1, at: readonly [number, number], rot: number, z: number): PartDef[] {
  const shade = side === -1 ? { shade: 0.8 } : {};
  return [
    { name: `stalk${id}`, role: "ear", side, parent: "head", at, pivot: [1.7, 11], rot, z, group: `stalk${id}`, ...shade, shape: stalk },
    { name: `bulb${id}`, role: "detail", parent: `stalk${id}`, at: [1.8, 0.8], pivot: [3.4, 3.4], z: z + 0.01, group: `stalk${id}`, ...shade, shape: bulb },
    { name: `eye${id}`, role: "eye", parent: `bulb${id}`, at: [3.6, 3.4], pivot: [2, 2.5], z: z + 0.02, group: `stalk${id}`, shape: EYE.open, variants: EYE },
  ];
}

export const SNAIL: RigDef = {
  id: "snail",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 19,
  outline: hex("#24160e"),
  feel: { tempo: 0.5 },
  materials: {
    b: {
      ramp: ramp("#6a4a3a", "#a87a5e", "#d8ac86", "#f2d0a8", "#fff0d4"),
      shiny: ramp("#3a4a6a", "#5a76a2", "#86a8d4", "#b4d0f0", "#e4f2ff"),
      gloss: 0.35,
    },
    s: {
      ramp: ramp("#3e1e10", "#6a3418", "#9a5224", "#c87a36", "#eaa656"),
      shiny: ramp("#4a1438", "#7a2460", "#ae3c8a", "#d86ab0", "#f6a4d4"),
      gloss: 0.3,
    },
    t: {
      ramp: ramp("#6a4628", "#9a6c3c", "#c8985a", "#e8c07e", "#fbe2aa"),
      shiny: ramp("#6a3a5e", "#9a5a8a", "#c88ab6", "#e8b4d6", "#fadcf0"),
      gloss: 0.3,
    },
    c: { ramp: ramp("#ff9a8a"), flat: true },
    k: { ramp: ramp("#1c120c"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c8485a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [25.5, 46.5], pivot: [15, 4.5], z: 1, shape: { kind: "ellipse", rx: 15, ry: 4.6, p: 2.4, mat: "b" } },
    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [4.5, 6], pivot: [5, 2.5], rot: 0.05, z: 0.9, shape: { kind: "poly", pts: [[0, 4.2], [5.5, 0], [6, 5]], mat: "b" } },

    { name: "shell", role: "detail", parent: "body", at: [14.5, 1], pivot: [12.5, 22], rot: -0.06, z: 1.3, shape: { kind: "ellipse", rx: 12.5, ry: 12.5, mat: "s" } },
    ...swirl,

    { name: "head", role: "head", parent: "body", at: [26.5, 4], pivot: [4, 15], rot: 0.12, z: 2, shape: { kind: "ellipse", rx: 6.4, ry: 8.4, p: 2.2, mat: "b" } },
    { name: "cheek", role: "detail", parent: "head", at: [9.5, 9], pivot: [0, 0], z: 2.2, group: "head", shape: { kind: "grid", rows: ["cc"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [8.5, 10.5], pivot: [2, 0], z: 2.3, group: "head", shape: MOUTH.smile, variants: MOUTH },

    ...eyeStalk("F", -1, [3.5, 3], -0.05, 1.9),
    ...eyeStalk("N", 1, [8, 3.5], 0.18, 2.5),
  ],
};
