/**
 * HD penguin — the upright waddler (H6). A chubby penguin standing tall and
 * facing right: a navy egg body with a white belly turned toward the
 * viewer, a round navy head with a white face mask the eyes sit on, an
 * orange beak (the mouth line runs along it), stubby flippers on the `wing`
 * role so they flap, flat orange feet, and a tiny tail nub. `feel.waddle`
 * gives it the side-to-side rock that makes a penguin a penguin.
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
  smile: { kind: "grid", rows: ["k...", ".kkk"] },
  open: { kind: "grid", rows: ["kkkk", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kkk", "k..."] },
};

/** A flat paddle foot, toes forward; pivot at the ankle. */
const foot: Shape = { kind: "ellipse", rx: 4, ry: 2, p: 2.4, mat: "o" };
/** Flipper hanging from the shoulder (pivot at the top). */
const flipper: Shape = { kind: "poly", pts: [[1, 0], [5, 0.5], [5.5, 6], [4, 12], [2, 13.5], [0, 7]], mat: "n" };

export const PENGUIN: RigDef = {
  id: "penguin",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 13,
  outline: hex("#0a0c16"),
  feel: { waddle: 0.16 },
  materials: {
    n: {
      ramp: ramp("#0c1020", "#182036", "#263252", "#384a72", "#536a98"),
      shiny: ramp("#2a1636", "#422254", "#603478", "#82509e", "#a878c4"),
      gloss: 0.5,
    },
    c: {
      ramp: ramp("#6e7a8c", "#a8b4c4", "#d8e2ee", "#f0f5fa", "#ffffff"),
      shiny: ramp("#8a7a5a", "#c4b088", "#ecdcb4", "#faf0d6", "#fffcf0"),
    },
    o: {
      ramp: ramp("#7a3410", "#c05818", "#ee8a26", "#ffb04c", "#ffd88c"),
      shiny: ramp("#7a2440", "#b83c62", "#e86890", "#ff9ab8", "#ffd0e0"),
      gloss: 0.3,
    },
    r: { ramp: ramp("#ff9ab0"), flat: true },
    k: { ramp: ramp("#0e0c18"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#8a2a3a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [29, 37.5], pivot: [11.5, 12], z: 1, shape: { kind: "ellipse", rx: 11.5, ry: 12, mat: "n" } },
    { name: "belly", role: "belly", parent: "body", at: [14.5, 13.5], pivot: [7.5, 9.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 7.5, ry: 9.5, mat: "c" } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [19.5, 6], pivot: [2.5, 1], rot: -0.35, z: 0.4, shade: 0.7, shape: flipper },
    { name: "wingN", role: "wing", side: 1, parent: "body", at: [7, 6.5], pivot: [2.5, 1], rot: 0.3, z: 1.6, shape: flipper },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9.5, 22], pivot: [1.5, 0.5], z: 0.5, shade: 0.72, shape: foot },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [14.5, 22.5], pivot: [1.5, 0.5], z: 1.5, shape: foot },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [2.5, 19], pivot: [4, 1], rot: 0.5, z: 0.3, shape: { kind: "poly", pts: [[0, 3.5], [4.5, 0], [5, 3.5]], mat: "n" } },

    { name: "head", role: "head", parent: "body", at: [12.5, 4], pivot: [9, 15], z: 3, shape: { kind: "ellipse", rx: 9.5, ry: 8.5, mat: "n" } },
    { name: "mask", role: "detail", parent: "head", at: [5.5, 4.5], pivot: [0, 0], z: 3.01, group: "head", shape: { kind: "ellipse", rx: 6.5, ry: 6, p: 2.2, mat: "c" } },
    { name: "cheek", role: "detail", parent: "head", at: [12, 12], pivot: [0, 0], z: 3.02, group: "head", shape: { kind: "grid", rows: ["rr"] } },
    { name: "eyeF", role: "eye", parent: "head", at: [7, 5.5], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [12.5, 5.5], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "beak", role: "snout", parent: "head", at: [16.5, 10.5], pivot: [1, 2.5], z: 3.1, group: "beak", shape: { kind: "poly", pts: [[0, 0.3], [4, 0.6], [8, 2.6], [4, 5], [0, 5]], mat: "o" } },
    { name: "mouth", role: "mouth", parent: "beak", at: [1, 2], pivot: [0, 0], z: 3.2, group: "beak", shape: MOUTH.smile, variants: MOUTH },
  ],
};
