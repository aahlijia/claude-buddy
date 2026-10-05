/**
 * HD goose — the tall one (H6). A Canada-style goose facing right: a low
 * grey-brown body with a cream belly and a white tail patch, folded dark
 * wings, and a long S-curved neck built as a chain of three segments rising
 * from the chest to a sooty head with a white chinstrap and an orange beak.
 * The neck segments are plain details (they hold the S); the head rides on
 * the last one with its pivot at the neck end, so it bobs from the throat.
 * The tall neck gives it a silhouette nothing like the duck's round one.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

/** Dark-head eyes carry a white rim so they read on the sooty feathers. */
const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".ww.", "wkkw", "kwkk", "kkkk", ".kk."] },
  half: { kind: "grid", rows: ["....", "....", "wwww", "kkkk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "....", "wwww", "...."] },
  happy: { kind: "grid", rows: ["....", ".ww.", "w..w", "....", "...."] },
  x: { kind: "grid", rows: ["w..w", ".ww.", ".ww.", "w..w", "...."] },
  angry: { kind: "grid", rows: ["ww..", ".www", "kwkk", "kkkk", ".kk."] },
};

/** Parting line along the beak. */
const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k....", ".kkkk"] },
  open: { kind: "grid", rows: ["kkkkk", "kppk.", ".kk.."] },
  frown: { kind: "grid", rows: [".kkkk", "k...."] },
};

const foot: Shape = { kind: "poly", pts: [[0.5, 0], [3, 0], [3, 3.5], [7, 3.6], [8, 6], [0, 6], [0, 3.5]], mat: "o" };
/** Folded wing: shoulder at the front, primaries crossing over the tail. */
const wing: Shape = { kind: "poly", pts: [[17, 0.5], [19.5, 3.5], [18, 7.5], [12, 10], [4, 9.5], [0, 7], [5, 4], [11, 1]], mat: "d" };
const neckSeg = (rx: number): Shape => ({ kind: "ellipse", rx, ry: 4.3, p: 2.4, mat: "n" });

export const GOOSE: RigDef = {
  id: "goose",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 15,
  outline: hex("#141218"),
  feel: { waddle: 0.1 },
  materials: {
    b: {
      ramp: ramp("#3e342c", "#6a5a4c", "#958272", "#bcab98", "#e0d4c2"),
      shiny: ramp("#2c3a4a", "#4a6278", "#7290aa", "#a2bed4", "#d4e6f2"),
    },
    d: {
      ramp: ramp("#2a221c", "#4a3e34", "#6e5e50", "#8e7e6e", "#ae9e8c"),
      shiny: ramp("#1c2836", "#304458", "#4c6680", "#6a86a0", "#8eaac0"),
    },
    n: {
      ramp: ramp("#141418", "#24252c", "#363842", "#4a4d5a", "#626676"),
      shiny: ramp("#1a2a24", "#24403a", "#325a50", "#467668", "#5e9282"),
      gloss: 0.4,
    },
    c: { ramp: ramp("#8a8274", "#bdb4a2", "#e4dccb", "#f6f0e2", "#ffffff") },
    o: {
      ramp: ramp("#7a3410", "#c05818", "#ee8a26", "#ffb04c", "#ffd88c"),
      shiny: ramp("#6a5a10", "#a8901c", "#dcc030", "#f4dc64", "#fff2a8"),
      gloss: 0.3,
    },
    s: { ramp: ramp("#5a4c40"), flat: true },
    k: { ramp: ramp("#0e0c12"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#8a2a3a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [22, 39.5], pivot: [13, 9], z: 1, shape: { kind: "ellipse", rx: 13, ry: 9, mat: "b" } },
    { name: "belly", role: "belly", parent: "body", at: [15.5, 14], pivot: [8.5, 3.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 8.5, ry: 3.5, mat: "c" } },
    { name: "bars", role: "detail", parent: "body", at: [5, 4], pivot: [0, 0], z: 1.05, group: "body", shape: { kind: "grid", rows: ["..s...s...s", ".s...s...s.", "..........."] } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [21, 2.5], pivot: [17, 2], rot: -0.25, z: 0.4, shade: 0.7, shape: wing },
    { name: "wingN", role: "wing", side: 1, parent: "body", at: [20.5, 5], pivot: [17, 2], rot: -0.08, z: 1.6, shape: wing },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9.5, 16], pivot: [1.8, 0.5], z: 0.5, shade: 0.72, shape: foot },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [14.5, 16.5], pivot: [1.8, 0.5], z: 1.5, shape: foot },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [4.5, 7], pivot: [5, 2.5], rot: -0.35, z: 0.3, group: "tail", shape: { kind: "poly", pts: [[0, 0.5], [6, 0], [6, 5], [1.5, 4]], mat: "n" } },
    { name: "tailW", role: "detail", parent: "tail0", at: [1, 3], pivot: [0, 0], z: 0.31, group: "tail", shape: { kind: "grid", rows: [".cccc", "ccccc"] } },

    { name: "neck0", role: "detail", parent: "body", at: [23, 6], pivot: [2.6, 7.6], rot: 0.85, z: 2, group: "neck", shape: neckSeg(2.6) },
    { name: "neck1", role: "detail", parent: "neck0", at: [2.6, 1.5], pivot: [2.1, 7.6], rot: -1.5, z: 2.01, group: "neck", shape: neckSeg(2.1) },
    { name: "neck2", role: "detail", parent: "neck1", at: [2.1, 1.5], pivot: [2.1, 7.6], rot: 1.05, z: 2.02, group: "neck", shape: neckSeg(2.1) },

    { name: "head", role: "head", parent: "neck2", at: [2.1, 2], pivot: [4.5, 10], rot: -0.4, z: 3, shape: { kind: "ellipse", rx: 7, ry: 5.8, mat: "n" } },
    { name: "chin", role: "detail", parent: "head", at: [1.5, 5.5], pivot: [0, 0], z: 3.02, group: "head", shape: { kind: "grid", rows: ["..cc", ".ccc", "cccc", "cccc", ".cc."] } },
    { name: "eyeF", role: "eye", parent: "head", at: [4, 2], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [9, 2], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "beak", role: "snout", parent: "head", at: [12.5, 7], pivot: [1, 2.5], z: 3.1, group: "beak", shape: { kind: "poly", pts: [[0, 0.5], [4.5, 0.8], [7.2, 2.6], [5, 5], [0, 5]], mat: "o" } },
    { name: "mouth", role: "mouth", parent: "beak", at: [1.5, 2], pivot: [0, 0], z: 3.2, group: "beak", shape: MOUTH.smile, variants: MOUTH },
  ],
};
