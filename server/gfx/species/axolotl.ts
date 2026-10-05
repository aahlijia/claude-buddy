/**
 * HD axolotl — the frilly, smiling one (H6). A pink axolotl facing right: a
 * low body on four small legs, a wide flat head with beady eyes set far apart
 * and a big smile, and three feathery external gills per side as `ear` parts
 * (the near set fans out behind the cheek, the far set peeks over the top of
 * the head in shade), so they twitch, pin back on a hit and droop on KO. The
 * long tail is a four-segment chain, each segment a pale fin around a pink
 * core, so the follow-through sway reads as a swimming ripple.
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
  smile: { kind: "grid", rows: ["k.....k", ".kkkkk."] },
  open: { kind: "grid", rows: ["kkkkkkk", "kpppppk", ".kkkkk."] },
  frown: { kind: "grid", rows: ["..kkk..", ".k...k."] },
};

/** A feathery gill frond, base at the bottom centre (2.5, 9.5). */
const gill: Shape = {
  kind: "poly",
  pts: [[2.5, 9.5], [1.4, 7.6], [0, 7], [1.2, 5.8], [0, 4.6], [1.3, 3.6], [0.4, 2], [2.5, 0], [4.6, 2], [3.7, 3.6], [5, 4.6], [3.8, 5.8], [5, 7], [3.6, 7.6]],
  mat: "m",
};

const leg: Shape = { kind: "ellipse", rx: 2.1, ry: 3.3, mat: "a" };

/** Fin and core radii per tail segment, base to tip. */
const FIN = [3.6, 3.3, 2.8, 2.1];
const CORE = [2.2, 1.8, 1.4, 1];
const ROTS = [-1.35, 0.06, 0.1, 0.14];

const tail: PartDef[] = FIN.flatMap((r, i) => [
  {
    name: `tail${i}`,
    role: "tail" as const,
    seg: i,
    parent: i ? `tail${i - 1}` : "body",
    at: i ? ([FIN[i - 1], 1.2] as const) : ([1.5, 5] as const),
    pivot: [r, 4.2] as const,
    rot: ROTS[i],
    z: 0.3 + i * 0.01,
    group: "tail",
    shape: { kind: "ellipse" as const, rx: r, ry: 2.5, mat: "f" },
  },
  {
    name: `core${i}`,
    role: "detail" as const,
    parent: `tail${i}`,
    at: [r, 2.5] as const,
    pivot: [CORE[i], 2.3] as const,
    z: 0.305 + i * 0.01,
    group: "tail",
    shape: { kind: "ellipse" as const, rx: CORE[i], ry: 2.3, mat: "a" },
  },
]);

/** Three gills fanning from `at` (head-local); `rots` point each frond. */
function gills(id: string, side: -1 | 1, at: readonly (readonly [number, number])[], rots: readonly number[], z: number): PartDef[] {
  return at.map((a, i) => ({
    name: `gill${id}${i}`,
    role: "ear" as const,
    side,
    parent: "head",
    at: a,
    pivot: [2.5, 9] as const,
    rot: rots[i],
    z: z + i * 0.001,
    group: `gills${id}`,
    ...(side === -1 ? { shade: 0.72 } : {}),
    shape: gill,
  }));
}

export const AXOLOTL: RigDef = {
  id: "axolotl",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 16,
  outline: hex("#2a1020"),
  materials: {
    a: {
      ramp: ramp("#7a3446", "#c05e78", "#ee94a8", "#ffbfcc", "#ffe4ea"),
      shiny: ramp("#5a4a1a", "#a08a32", "#dcc458", "#f6e28a", "#fff6c8"),
      gloss: 0.4,
    },
    c: {
      ramp: ramp("#9a5a5a", "#d8908a", "#f8bcb0", "#ffd8cc", "#fff0ea"),
      shiny: ramp("#8a7a4a", "#c8b47a", "#eedaa4", "#fcecc8", "#fffae8"),
    },
    m: {
      ramp: ramp("#5a0e3a", "#8e1c5a", "#c8307e", "#ec5ea2", "#ff96c8"),
      shiny: ramp("#0e3e4a", "#1a6a72", "#2ea09e", "#56d0c2", "#9cf2e2"),
    },
    f: {
      ramp: ramp("#9a5a72", "#d48ea6", "#f4bccc", "#ffdce6", "#fff2f6"),
      shiny: ramp("#8a804a", "#c4b87a", "#ece0a8", "#fcf2cc", "#fffaea"),
    },
    b: { ramp: ramp("#ff7aa0"), flat: true },
    k: { ramp: ramp("#200c18"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c8305a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [26.5, 42], pivot: [9.5, 6], z: 1, shape: { kind: "ellipse", rx: 9.5, ry: 6, p: 2.2, mat: "a" } },
    { name: "belly", role: "belly", parent: "body", at: [10.5, 9.5], pivot: [7, 2.2], z: 1.05, group: "body", shape: { kind: "ellipse", rx: 7, ry: 2.2, mat: "c" } },
    ...tail,

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [5, 9.5], pivot: [2.1, 1], z: 0.5, shade: 0.7, shape: leg },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [14.5, 9.5], pivot: [2.1, 1], z: 0.5, shade: 0.7, shape: leg },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [7, 10], pivot: [2.1, 1], z: 1.5, shape: leg },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [16.5, 10], pivot: [2.1, 1], z: 1.5, shape: leg },

    { name: "head", role: "head", parent: "body", at: [15.5, 2.5], pivot: [6, 14.5], z: 2, shape: { kind: "ellipse", rx: 10, ry: 7.8, p: 2.3, mat: "a" } },
    { name: "chin", role: "snout", parent: "head", at: [11.5, 13.2], pivot: [6, 1.8], z: 2.01, group: "head", shape: { kind: "ellipse", rx: 6, ry: 1.8, mat: "c" } },
    { name: "eyeF", role: "eye", parent: "head", at: [7.5, 5.5], pivot: [2, 2.5], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [16, 5.5], pivot: [2, 2.5], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "cheek", role: "detail", parent: "head", at: [16.5, 9.5], pivot: [0, 0], z: 2.2, group: "head", shape: { kind: "grid", rows: ["bb"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [11.5, 10], pivot: [3.5, 0], z: 2.3, group: "head", shape: MOUTH.smile, variants: MOUTH },

    ...gills("F", -1, [[12.5, 1.5], [15, 2], [17, 3.4]], [0.0, 0.4, 0.75], 1.9),
    ...gills("N", 1, [[3.5, 3], [2.2, 6], [2.4, 9.2]], [-0.55, -1.15, -1.75], 2.4),
  ],
};
