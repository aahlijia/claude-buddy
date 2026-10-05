/**
 * HD robot — the hard-edges pilot (H6). A boxy steel bot facing right: a
 * rounded-box torso with a chest light panel, a box head with a glass visor
 * and LED eyes, an antenna (the `ear` role, so it twitches), piston arms
 * and legs. Boxy superellipses and polygons keep the corners crisp, and
 * `feel.servo` snaps idle, walk and victory between poses like a servo.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

/** LED eyes on the visor: `e` glows, `v` is the dark glass. */
const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: ["eee", "eWe", "eWe", "eee"] },
  half: { kind: "grid", rows: ["...", "...", "eee", "eee"] },
  closed: { kind: "grid", rows: ["...", "...", "...", "eee"] },
  happy: { kind: "grid", rows: ["...", ".e.", "e.e", "..."] },
  x: { kind: "grid", rows: ["e.e", ".e.", "e.e", "..."] },
  angry: { kind: "grid", rows: ["e..", "ee.", "eee", "eee"] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["e...e", ".eee."] },
  open: { kind: "grid", rows: [".eee.", "e...e", ".eee."] },
  frown: { kind: "grid", rows: [".eee.", "e...e"] },
};

const box = (rx: number, ry: number, mat: string, p = 6): Shape => ({ kind: "ellipse", rx, ry, p, mat });
/** A piston limb: an upper box with a foot or claw (pivot at the top). */
const leg: Shape = { kind: "poly", pts: [[0.5, 0], [4.5, 0], [4.5, 5], [6.5, 5.5], [6.5, 7.5], [0, 7.5], [0, 5], [0.5, 5]], mat: "m" };
const arm: Shape = { kind: "poly", pts: [[0, 0], [4, 0], [4, 7], [4.8, 8], [4.8, 10.5], [3, 9.5], [1.8, 10.5], [0, 9.5]], mat: "m" };

export const ROBOT: RigDef = {
  id: "robot",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 15,
  outline: hex("#10141c"),
  feel: { servo: 10 },
  materials: {
    m: {
      ramp: ramp("#2a3444", "#4a5a70", "#7a8ca4", "#aebdd0", "#e4ecf6"),
      shiny: ramp("#4a3418", "#7a5a24", "#b48a3a", "#e0bc64", "#fff0b0"),
      gloss: 0.9,
    },
    j: {
      ramp: ramp("#1a2230", "#2a3444", "#3a4658", "#4a586c", "#5a6a80"),
      shiny: ramp("#2a1c0c", "#3e2a14", "#56401e", "#6c522a", "#826636"),
    },
    v: { ramp: ramp("#0a1420", "#122030", "#1a2c40", "#24384e", "#30485e"), gloss: 1 },
    e: { ramp: ramp("#5ef2ff"), flat: true },
    W: { ramp: ramp("#e8ffff"), flat: true },
    r: { ramp: ramp("#ff4a5a"), flat: true },
    y: { ramp: ramp("#ffd23a"), flat: true },
    g: { ramp: ramp("#5aff8a"), flat: true },
    k: { ramp: ramp("#10141c"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 37], pivot: [12, 7.5], z: 1, shape: box(12, 7.5, "m", 5) },
    { name: "panel", role: "detail", parent: "body", at: [12, 3.5], pivot: [0, 0], z: 1.05, group: "body", shape: { kind: "grid", rows: ["jjjjjjj", "jrjyjgj", "jjjjjjj", "j.....j", "jkkkkkj", "jjjjjjj"].map((r) => r.replace(/\./g, "j")) } },
    { name: "bolts", role: "detail", parent: "body", at: [2, 3], pivot: [0, 0], z: 1.04, group: "body", shape: { kind: "grid", rows: ["j...................j", ".....................", ".....................", ".....................", ".....................", ".....................", ".....................", ".....................", "j...................j"] } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [7, 13.5], pivot: [2.5, 0.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [14, 14], pivot: [2.5, 0.5], z: 1.5, shape: leg },
    { name: "armF", role: "legF", side: -1, parent: "body", at: [19, 4], pivot: [2, 1], rot: -0.15, z: 0.4, shade: 0.7, shape: arm },
    { name: "armN", role: "legF", side: 1, parent: "body", at: [6, 5], pivot: [2, 1], rot: -0.1, z: 1.6, shape: arm },

    { name: "neck", role: "detail", parent: "body", at: [13, 0.5], pivot: [3, 2], z: 0.9, shape: box(3, 2, "j", 8) },
    { name: "head", role: "head", parent: "body", at: [13.5, 0.5], pivot: [10, 15], z: 3, shape: box(11, 7.5, "m", 7) },
    { name: "visor", role: "detail", parent: "head", at: [8.5, 2.5], pivot: [0, 0], z: 3.05, group: "head", shape: box(6.8, 5, "v", 5) },
    { name: "eyeF", role: "eye", parent: "head", at: [11, 4.5], pivot: [1.5, 1.5], z: 3.2, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [16.5, 4.5], pivot: [1.5, 1.5], z: 3.2, group: "head", shape: EYE.open, variants: EYE },
    { name: "mouth", role: "mouth", parent: "head", at: [13, 9.5], pivot: [2.5, 0], z: 3.2, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "ear", role: "detail", parent: "head", at: [2, 6.5], pivot: [0, 0], z: 3.04, group: "head", shape: { kind: "grid", rows: ["jj", "jj", "jj", "jj"] } },

    { name: "antenna", role: "ear", side: 1, parent: "head", at: [8, 0.5], pivot: [1, 5], rot: -0.2, z: 2.9, shape: { kind: "poly", pts: [[0.3, 0], [1.7, 0], [1.7, 5], [0.3, 5]], mat: "j" } },
    { name: "bulb", role: "detail", parent: "antenna", at: [1, 0], pivot: [1.6, 1.6], z: 2.95, shape: { kind: "ellipse", rx: 1.6, ry: 1.6, mat: "r" } },
  ],
};
