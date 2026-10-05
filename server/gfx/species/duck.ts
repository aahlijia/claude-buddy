/**
 * HD duck — the waddler (H6). A plump cream-white duck facing right: a round
 * egg body, a big round head on top with a flat orange bill (the mouth line
 * lives on the bill), folded wings on both sides (the far one peeks over the
 * back in shade), a little upturned tail tuft, and short orange webbed feet.
 * `feel.waddle` rolls the body side to side as it walks.
 */

import type { RigDef, Shape } from "../rig.ts";
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

/** The bill's parting line: it curls up at the corner for a smile. */
const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k.....", ".kkkkk"] },
  open: { kind: "grid", rows: ["kkkkkk", "kpppk.", ".kkk.."] },
  frown: { kind: "grid", rows: [".kkkkk", "k....."] },
};

/** A short shank and a webbed foot pointing forward; pivot at the hip. */
const foot: Shape = { kind: "poly", pts: [[0.5, 0], [3.5, 0], [3.5, 3.5], [7.5, 3.6], [8.5, 6], [0, 6], [0, 3.5]], mat: "o" };
/** Folded wing: rounded at the shoulder, tapering to the tips at the back. */
const wing: Shape = { kind: "poly", pts: [[13, 0.5], [15.5, 3], [14.5, 7], [10, 9.5], [4, 9.5], [0, 7.5], [3, 5], [8, 1.5]], mat: "f" };
const tuft = (rx: number, ry: number): Shape => ({ kind: "ellipse", rx, ry, mat: "f" });

export const DUCK: RigDef = {
  id: "duck",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 16,
  outline: hex("#2a1e14"),
  feel: { waddle: 0.12 },
  materials: {
    f: {
      ramp: ramp("#7a6a52", "#b8a682", "#e4d4b0", "#f8eed4", "#fffbee"),
      shiny: ramp("#8a6408", "#c89418", "#f0c434", "#ffe270", "#fff6b8"),
    },
    o: {
      ramp: ramp("#7a3410", "#c05818", "#ee8a26", "#ffb04c", "#ffd88c"),
      shiny: ramp("#7a2440", "#b83c62", "#e86890", "#ff9ab8", "#ffd0e0"),
      gloss: 0.3,
    },
    c: { ramp: ramp("#ffa8b0"), flat: true },
    k: { ramp: ramp("#1e1620"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#8a2a3a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [23, 38.5], pivot: [12.5, 9.5], z: 1, shape: { kind: "ellipse", rx: 12.5, ry: 9.5, mat: "f" } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [21, 4], pivot: [14, 2], rot: -0.3, z: 0.4, shade: 0.7, shape: wing },
    { name: "wingN", role: "wing", side: 1, parent: "body", at: [20.5, 8], pivot: [14, 2], rot: -0.05, z: 1.6, shape: wing },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9, 16.5], pivot: [2, 0.5], z: 0.5, shade: 0.72, shape: foot },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [14.5, 17], pivot: [2, 0.5], z: 1.5, shape: foot },

    { name: "tail0", role: "tail", seg: 0, parent: "body", at: [3, 7], pivot: [2.6, 6], rot: -1.0, z: 0.3, group: "tail", shape: tuft(2.6, 3.6) },
    { name: "tail1", role: "tail", seg: 1, parent: "tail0", at: [2.6, 1.5], pivot: [1.8, 4.5], rot: 0.55, z: 0.31, group: "tail", shape: tuft(1.8, 2.6) },

    { name: "head", role: "head", parent: "body", at: [22, 2.5], pivot: [8, 16], z: 3, shape: { kind: "ellipse", rx: 9, ry: 8.5, mat: "f" } },
    { name: "cheek", role: "detail", parent: "head", at: [10, 10], pivot: [0, 0], z: 3.02, group: "head", shape: { kind: "grid", rows: ["ccc"] } },
    { name: "eyeF", role: "eye", parent: "head", at: [5, 4], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [10.5, 4], pivot: [0, 0], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "bill", role: "snout", parent: "head", at: [15, 12], pivot: [1, 2.8], z: 3.1, group: "bill", shape: { kind: "ellipse", rx: 5, ry: 2.8, p: 2.6, mat: "o" } },
    { name: "nostril", role: "detail", parent: "bill", at: [7, 1], pivot: [0, 0], z: 3.15, group: "bill", shape: { kind: "grid", rows: ["k"] } },
    { name: "mouth", role: "mouth", parent: "bill", at: [2.5, 2.5], pivot: [0, 0], z: 3.2, group: "bill", shape: MOUTH.smile, variants: MOUTH },
  ],
};
