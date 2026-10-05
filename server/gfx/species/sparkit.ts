/**
 * HD sparkit — an original electric mouse (H6). A periwinkle mouse facing
 * right: a small round body with a cream belly, a big round head with a
 * little pink-nosed muzzle, and two big ROUND mouse ears (pink inside, the
 * `ear` role so they twitch and pin back). The tail is a gold lightning bolt:
 * a chain of zig-zag segments that sways like any tail, with tiny flat spark
 * pixels riding the tip. Small paws in front (`legF`), feet behind (`legB`).
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kkk.", "kwwkk", "kwkkk", "kkkkk", "kkkbk", ".kkk."] },
  half: { kind: "grid", rows: [".....", ".....", "kkkkk", "kkkkk", "kkkbk", ".kkk."] },
  closed: { kind: "grid", rows: [".....", ".....", ".....", ".....", "kkkkk", "....."] },
  happy: { kind: "grid", rows: [".....", ".....", ".kkk.", "k...k", ".....", "....."] },
  x: { kind: "grid", rows: [".....", "k...k", ".k.k.", "..k..", ".k.k.", "k...k"] },
  angry: { kind: "grid", rows: ["kk...", ".kkkk", "kwkkk", "kkkkk", "kkkbk", ".kkk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k.k", ".k."] },
  open: { kind: "grid", rows: [".kk.", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".k.", "k.k"] },
};

const ear: Shape = { kind: "ellipse", rx: 5.6, ry: 5.4, mat: "f" };
const earInner: Shape = { kind: "ellipse", rx: 3.4, ry: 3.3, mat: "p" };
const paw: Shape = { kind: "ellipse", rx: 2.2, ry: 3, mat: "f" };
const foot: Shape = { kind: "ellipse", rx: 3.6, ry: 2.2, mat: "f" };
/** One stroke of the bolt: a slanted bar; the chain alternates its lean. */
const bar = (l: number): Shape => ({ kind: "poly", pts: [[0, l], [3.4, l], [3.4, 0], [0, 0]], mat: "y" });
const tip: Shape = { kind: "poly", pts: [[0, 8], [3.6, 8], [1.4, 0]], mat: "y" };

export const SPARKIT: RigDef = {
  id: "sparkit",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 14,
  feel: { tempo: 1.25 },
  outline: hex("#141430"),
  materials: {
    f: {
      ramp: ramp("#262a64", "#40509c", "#6880cc", "#98b2ec", "#d0e0ff"),
      shiny: ramp("#1a4a3a", "#2a7a5a", "#48ae88", "#80dab2", "#c4f8e0"),
    },
    c: {
      ramp: ramp("#8a7658", "#c4ae88", "#ead8b2", "#fff2d8", "#ffffff"),
      shiny: ramp("#8a6a6a", "#c49ea0", "#eacace", "#fff0f0", "#ffffff"),
    },
    p: { ramp: ramp("#7a2e48", "#b9506e", "#ec8aa6", "#ffb6c9", "#ffe0ea") },
    y: {
      ramp: ramp("#7a5208", "#b88a10", "#f0c020", "#ffe060", "#fff6b0"),
      shiny: ramp("#1a5070", "#2a86b0", "#56c4f0", "#a6ecff", "#ffffff"),
      gloss: 0.35,
    },
    s: { ramp: ramp("#fff3a0"), flat: true },
    k: { ramp: ramp("#141430"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    b: { ramp: ramp("#5a7ad8"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 41.5], pivot: [10, 8.5], z: 1, shape: { kind: "ellipse", rx: 10, ry: 8.5, mat: "f" } },
    { name: "belly", role: "belly", parent: "body", at: [13.5, 11], pivot: [6, 4.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 6, ry: 4.5, mat: "c" } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [5, 13.5], pivot: [2, 0], z: 0.5, shade: 0.7, shape: foot },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [16, 12], pivot: [2.2, 1], z: 0.5, shade: 0.7, shape: paw },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [8, 14], pivot: [2, 0], z: 1.5, shape: foot },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [18.5, 12.5], pivot: [2.2, 1], z: 1.5, shape: paw },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [4, 9], pivot: [1.7, 9], rot: -0.95, z: 0.3, group: "tail", shape: bar(10) },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [1.7, 1.2], pivot: [1.7, 7.8], rot: 1.35, z: 0.31, group: "tail", shape: bar(9) },
    { name: "tail2", role: "tail", seg: 2, parent: "tail1", at: [1.7, 1.2], pivot: [1.7, 8.8], rot: -1.35, z: 0.32, group: "tail", shape: bar(10) },
    { name: "tail3", role: "tail", seg: 3, parent: "tail2", at: [1.7, 1.2], pivot: [1.8, 7], rot: 0.95, z: 0.33, group: "tail", shape: tip },
    { name: "spark0", role: "detail", parent: "tail3", at: [-3, -1], pivot: [0, 0], z: 0.34, shape: { kind: "grid", rows: ["s......", ".......", "......s", ".s....."] } },
    { name: "spark1", role: "detail", parent: "tail1", at: [-3, 2], pivot: [0, 0], z: 0.34, shape: { kind: "grid", rows: ["s", ".", ".", "s"] } },

    { name: "head", role: "head", parent: "body", at: [16, 3], pivot: [9, 16], z: 3, shape: { kind: "ellipse", rx: 10, ry: 8.8, p: 2.1, mat: "f" } },
    { name: "muzzle", role: "snout", parent: "head", at: [17, 10], pivot: [2, 3], z: 3.05, group: "head", shape: { kind: "ellipse", rx: 4, ry: 3, mat: "f" } },
    { name: "nose", role: "detail", parent: "head", at: [22, 8.5], pivot: [0, 0], z: 3.3, group: "head", shape: { kind: "grid", rows: ["pp", "pp"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [17.5, 11.5], pivot: [1.5, 0], z: 3.3, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "whiskers", role: "detail", parent: "head", at: [20, 10.5], pivot: [0, 0], z: 3.3, group: "head", shape: { kind: "grid", rows: ["..kk", "....", ".kk."] } },
    { name: "eyeF", role: "eye", parent: "head", at: [8.5, 7.5], pivot: [2.5, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [14.5, 7.5], pivot: [2.5, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [4.5, 3.5], pivot: [5.6, 9], rot: -0.3, z: 2.9, shade: 0.8, shape: ear },
    { name: "earFin", role: "detail", parent: "earF", at: [5.6, 5.6], pivot: [3.4, 3.3], z: 2.91, group: "earF", shade: 0.8, shape: earInner },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [12.5, 2.5], pivot: [5.6, 9], rot: 0.2, z: 3.1, shape: ear },
    { name: "earNin", role: "detail", parent: "earN", at: [5.6, 5.6], pivot: [3.4, 3.3], z: 3.11, group: "earN", shape: earInner },
  ],
};
