/**
 * HD chonk — the absolute unit (H6). A grey-and-white cat that is mostly
 * sphere: one huge round body (the root), a wide head sunk into it with no
 * neck (same group, so no inner line between them), tiny triangle ears, a
 * white bib and muzzle, stubby legs that barely peek out from under the
 * belly and a short thick tail. The face is smug: heavy-lidded eyes and a
 * little ":3" mouth. Reads apart from the orange `cat` by silhouette alone.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

/** Heavy upper lids: the resting look is already smug. */
const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: ["kkkk", "kkkk", "kwgk", "kggk", ".kk."] },
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

const stub: Shape = { kind: "ellipse", rx: 3, ry: 3, mat: "c" };
const ear: Shape = { kind: "poly", pts: [[0, 6], [2.8, 0], [4.2, 0], [7, 6]], mat: "f" };
const earInner: Shape = { kind: "poly", pts: [[0, 3.6], [1.7, 0], [3.4, 3.6]], mat: "q" };
const tailSeg = (rx: number, mat = "f"): Shape => ({ kind: "ellipse", rx, ry: 3.8, mat });

export const CHONK: RigDef = {
  id: "chonk",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 19,
  outline: hex("#14141e"),
  feel: { tempo: 0.8, waddle: 0.06 },
  materials: {
    f: {
      ramp: ramp("#2e3040", "#4e5264", "#7a7e92", "#a6aabc", "#d2d6e2"),
      shiny: ramp("#3e2a44", "#644670", "#9070a0", "#bc9ccc", "#e6ccf0"),
    },
    s: {
      ramp: ramp("#1e202c", "#30323f", "#464a5a", "#5a5e70", "#6e7286"),
      shiny: ramp("#24162a", "#38223e", "#4e3456", "#64466e", "#7a5886"),
    },
    c: {
      ramp: ramp("#8a8a98", "#c2c4ce", "#e8eaf0", "#f8f8fc", "#ffffff"),
      shiny: ramp("#8a7a68", "#c4b49c", "#ecdcc4", "#faf0e0", "#ffffff"),
    },
    q: { ramp: ramp("#7a2e48", "#b9506e", "#ec8aa6", "#ffb6c9", "#ffe0ea") },
    n: { ramp: ramp("#f08aa6"), flat: true },
    k: { ramp: ramp("#14141e"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    g: { ramp: ramp("#e8b830"), flat: true },
    p: { ramp: ramp("#c8304a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 35], pivot: [17, 15], z: 1, group: "body", shape: { kind: "ellipse", rx: 17, ry: 15, mat: "f" } },
    { name: "belly", role: "belly", parent: "body", at: [22, 21], pivot: [9.5, 7.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 9.5, ry: 7.5, mat: "c" } },
    {
      name: "stripes",
      role: "detail",
      parent: "body",
      at: [3, 6],
      pivot: [0, 0],
      z: 1.05,
      group: "body",
      shape: { kind: "grid", rows: ["....s....", "...ss..s.", "s..s..ss.", "ss.....s.", "s...s....", "...ss....", "...s....."] },
    },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9, 25.5], pivot: [3, 1], z: 0.5, shade: 0.72, shape: stub },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [24, 25.5], pivot: [3, 1], z: 0.5, shade: 0.72, shape: stub },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [12, 26.5], pivot: [3, 1], z: 1.5, shape: stub },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [27, 26], pivot: [3, 1], z: 1.5, shape: stub },

    // A thick, short tail: out from the low back, curling up, dark-tipped.
    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [3, 21], pivot: [3.6, 6], rot: -1.3, z: 0.3, group: "tail", shape: tailSeg(3.6) },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [3.6, 1.8], pivot: [3.3, 6], rot: 0.55, z: 0.31, group: "tail", shape: tailSeg(3.3) },
    { name: "tail2", role: "tail", seg: 2, parent: "tail1", at: [3.3, 1.8], pivot: [3, 6], rot: 0.6, z: 0.32, group: "tail", shape: tailSeg(3, "s") },

    { name: "head", role: "head", parent: "body", at: [23, 12], pivot: [12, 15], z: 2, group: "body", shape: { kind: "ellipse", rx: 12, ry: 9, p: 2.2, mat: "f" } },
    { name: "forehead", role: "detail", parent: "head", at: [9.5, 1.5], pivot: [0, 0], z: 2.02, group: "body", shape: { kind: "grid", rows: ["s.s.s", "s.s.s", "..s.."] } },
    { name: "muzzle", role: "snout", parent: "head", at: [15.5, 13], pivot: [5.5, 3.5], z: 2.05, group: "body", shape: { kind: "ellipse", rx: 5.5, ry: 3.5, mat: "c" } },
    { name: "nose", role: "detail", parent: "head", at: [16, 10], pivot: [1.5, 0], z: 2.3, group: "body", shape: { kind: "grid", rows: ["nnn", ".n."] } },
    { name: "mouth", role: "mouth", parent: "head", at: [16, 12], pivot: [2.5, 0], z: 2.3, group: "body", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [10, 7.5], pivot: [2, 2.5], z: 2.25, group: "body", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [19, 7.5], pivot: [2, 2.5], z: 2.25, group: "body", shape: EYE.open, variants: EYE },
    { name: "whiskers", role: "detail", parent: "head", at: [21, 11.5], pivot: [0, 0], z: 2.3, group: "body", shape: { kind: "grid", rows: ["...cc", "cc...", "...cc"] } },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [6.5, 2.5], pivot: [3.5, 6], rot: -0.3, z: 1.9, shade: 0.8, shape: ear },
    { name: "earFin", role: "detail", parent: "earF", at: [3.5, 6], pivot: [1.7, 3.6], z: 1.91, group: "earF", shade: 0.8, shape: earInner },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [16, 1.5], pivot: [3.5, 6], rot: 0.2, z: 2.1, shape: ear },
    { name: "earNin", role: "detail", parent: "earN", at: [3.5, 6], pivot: [1.7, 3.6], z: 2.11, group: "earN", shape: earInner },
  ],
};
