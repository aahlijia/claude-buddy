/**
 * HD cat — the reference rig (H1 pilot). An orange tabby in 3/4 view facing
 * right: far-side limbs sit in shade behind the body, the ringed tail is a
 * five-segment chain (follow-through comes free from the motion library),
 * and the face is text-grid eyes and mouth with every expression variant.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kk.", "kwgk", "kggk", "kggk", ".kk."] },
  half: { kind: "grid", rows: ["....", "....", "kkkk", "kggk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "....", "kkkk", "...."] },
  happy: { kind: "grid", rows: ["....", ".kk.", "k..k", "....", "...."] },
  x: { kind: "grid", rows: ["k..k", ".kk.", ".kk.", "k..k", "...."] },
  angry: { kind: "grid", rows: ["kk..", ".kkk", "kwgk", "kggk", ".kk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k.k.k", ".k.k."] },
  open: { kind: "grid", rows: [".kkk.", "kpppk", ".kkk."] },
  frown: { kind: "grid", rows: [".kkk.", "k...k"] },
};

const leg = (mat = "f"): Shape => ({ kind: "ellipse", rx: 2.6, ry: 5, mat });
const tailSeg = (mat: string): Shape => ({ kind: "ellipse", rx: 2.4, ry: 3.4, mat });
const ear: Shape = { kind: "poly", pts: [[0, 8], [2.6, 0.6], [4.2, 0], [9, 8]], mat: "f" };
const earInner: Shape = { kind: "poly", pts: [[0, 5.5], [2.4, 0], [5.5, 5.5]], mat: "p" };

export const CAT: RigDef = {
  id: "cat",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 17,
  outline: hex("#1a1020"),
  materials: {
    f: {
      ramp: ramp("#5a2a1e", "#97462a", "#d17a3d", "#f0a85e", "#ffd796"),
      shiny: ramp("#2a3a5e", "#3d5a9a", "#6a8fd8", "#a8c4f5", "#e2ecff"),
    },
    s: {
      ramp: ramp("#3a160f", "#5e2817", "#8a3d20", "#ad5528", "#c66e34"),
      shiny: ramp("#1a2240", "#26345e", "#3a4f8a", "#5068a8", "#6a84c4"),
    },
    c: { ramp: ramp("#8a6a5a", "#c9a58a", "#efd4b8", "#fff0dc", "#ffffff") },
    p: { ramp: ramp("#7a2e48", "#b9506e", "#ec8aa6", "#ffb6c9", "#ffe0ea") },
    k: { ramp: ramp("#1e1830"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    g: { ramp: ramp("#3aa86a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [28, 38.5], pivot: [13, 8.5], z: 1, shape: { kind: "ellipse", rx: 13, ry: 8.5, mat: "f" } },
    { name: "belly", role: "belly", parent: "body", at: [15, 12.5], pivot: [9, 4], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 9, ry: 4, mat: "c" } },
    { name: "stripes", role: "detail", parent: "body", at: [8, 1], pivot: [0, 0], z: 1.05, group: "body", shape: { kind: "grid", rows: [".s...s...s.", "ss..ss..ss.", ".s...s...s."] } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [6, 12], pivot: [2.6, 1.5], z: 0.5, shade: 0.72, shape: leg() },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [19, 12], pivot: [2.6, 1.5], z: 0.5, shade: 0.72, shape: leg() },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [9, 12.5], pivot: [2.6, 1.5], z: 1.5, shape: leg() },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [22, 12.5], pivot: [2.6, 1.5], z: 1.5, shape: leg() },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [2.5, 6], pivot: [2.4, 6], rot: -0.95, z: 0.2, group: "tail", shape: tailSeg("f") },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [2.4, 2.2], pivot: [2.4, 6], rot: 0.18, z: 0.21, group: "tail", shape: tailSeg("s") },
    { name: "tail2", role: "tail", seg: 2, parent: "tail1", at: [2.4, 2.2], pivot: [2.4, 6], rot: 0.22, z: 0.22, group: "tail", shape: tailSeg("f") },
    { name: "tail3", role: "tail", seg: 3, parent: "tail2", at: [2.4, 2.2], pivot: [2.4, 6], rot: 0.28, z: 0.23, group: "tail", shape: tailSeg("s") },
    { name: "tail4", role: "tail", seg: 4, parent: "tail3", at: [2.4, 2.2], pivot: [2.4, 6], rot: 0.32, z: 0.24, group: "tail", shape: tailSeg("f") },

    { name: "head", role: "head", parent: "body", at: [22, 5], pivot: [10.5, 14], z: 3, shape: { kind: "ellipse", rx: 10.5, ry: 8.8, p: 2.1, mat: "f" } },
    { name: "forehead", role: "detail", parent: "head", at: [8.5, 1.2], pivot: [0, 0], z: 3.02, group: "head", shape: { kind: "grid", rows: ["s...s", "ss.ss", "s.s.s"] } },
    { name: "muzzle", role: "snout", parent: "head", at: [14, 11.5], pivot: [5, 3.2], z: 3.05, group: "head", shape: { kind: "ellipse", rx: 5, ry: 3.2, mat: "c" } },
    { name: "nose", role: "detail", parent: "head", at: [14.5, 8.6], pivot: [1.5, 0], z: 3.3, group: "head", shape: { kind: "grid", rows: ["ppp", ".p."] } },
    { name: "mouth", role: "mouth", parent: "head", at: [14.5, 10.6], pivot: [2.5, 0], z: 3.3, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [9, 6.5], pivot: [2, 2.5], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [16.5, 6.5], pivot: [2, 2.5], z: 3.25, group: "head", shape: EYE.open, variants: EYE },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [5.5, 4], pivot: [4.5, 7.5], rot: -0.2, z: 2.9, shade: 0.8, shape: ear },
    { name: "earFin", role: "detail", parent: "earF", at: [4.5, 8], pivot: [2.75, 5.5], z: 2.91, group: "earF", shade: 0.8, shape: earInner },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [15, 3.2], pivot: [4.5, 7.5], rot: 0.15, z: 3.1, shape: ear },
    { name: "earNin", role: "detail", parent: "earN", at: [4.5, 8], pivot: [2.75, 5.5], z: 3.11, group: "earN", shape: earInner },
  ],
};
