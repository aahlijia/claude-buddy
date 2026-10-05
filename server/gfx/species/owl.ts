/**
 * HD owl — the big-eyed one (H6). A round tawny owl sitting upright and
 * facing right: an egg body with a pale speckled breast, a big round head
 * whose light facial disk carries two huge amber eyes and a tiny hooked
 * beak, feathered ear tufts on the `ear` role (they twitch and pin back),
 * folded wings down both flanks, and small yellow talons poking out below.
 * No neck to speak of: the head sits on the shoulders and bobs from there.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

/** Huge owl eyes: an amber iris ring around a big pupil. */
const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: ["..yyy..", ".ykkky.", "ykwkkky", "ykkkkky", "ykkkkky", ".ykkky.", "..yyy.."] },
  half: { kind: "grid", rows: [".......", ".......", "kkkkkkk", "ykkkkky", "ykkkkky", ".ykkky.", "..yyy.."] },
  closed: { kind: "grid", rows: [".......", ".......", ".......", "k.....k", ".kkkkk.", ".......", "......."] },
  happy: { kind: "grid", rows: [".......", "..kkk..", ".k...k.", "k.....k", ".......", ".......", "......."] },
  x: { kind: "grid", rows: [".......", ".k...k.", "..k.k..", "...k...", "..k.k..", ".k...k.", "......."] },
  angry: { kind: "grid", rows: ["kk.....", ".kkkk..", "ykkkkky", "ykwkkky", "ykkkkky", ".ykkky.", "..yyy.."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

/** Folded wing hanging from the shoulder (pivot at the top). */
const wing: Shape = { kind: "poly", pts: [[3, 0], [8, 0.5], [9.5, 8], [7, 15.5], [3.5, 17], [0, 9]], mat: "d" };
const tuft: Shape = { kind: "poly", pts: [[0, 6.5], [1.2, 0], [5.5, 6.5]], mat: "d" };
/** Three little claws under a feathered toe pad; pivot at the top. */
const talon: Shape = { kind: "grid", rows: [".ttt.", "ttttt", "t.t.t"] };

export const OWL: RigDef = {
  id: "owl",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 14,
  outline: hex("#1a100a"),
  materials: {
    f: {
      ramp: ramp("#3a2214", "#663e22", "#966236", "#c48e54", "#e8bc80"),
      shiny: ramp("#3e4250", "#6a7080", "#9ca2b2", "#c8ced8", "#f0f4f8"),
    },
    d: {
      ramp: ramp("#2a180e", "#4a2c18", "#70462a", "#94643e", "#b88656"),
      shiny: ramp("#2a2e3a", "#464c5c", "#6a7284", "#9098a8", "#b8c0cc"),
    },
    c: {
      ramp: ramp("#7a5a3a", "#b8956a", "#e2c49a", "#f6e2c0", "#fff6e4"),
      shiny: ramp("#8a8e9a", "#bcc0ca", "#e0e4ea", "#f4f6fa", "#ffffff"),
    },
    b: {
      ramp: ramp("#6a4a2c", "#a07a50", "#d0aa78", "#ecce9e", "#fbe8c4"),
      shiny: ramp("#7a7e8a", "#aaaeba", "#d4d8e0", "#eceef4", "#ffffff"),
    },
    o: { ramp: ramp("#3a2a1e", "#5a4430", "#7a6248", "#9a8264", "#b8a284"), gloss: 0.4 },
    t: { ramp: ramp("#5a4a1a", "#8a7430", "#c0a44a", "#e0c86a", "#f4e49c") },
    s: { ramp: ramp("#7a5030"), flat: true },
    y: { ramp: ramp("#ffb428"), flat: true },
    k: { ramp: ramp("#160e0a"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#8a2a3a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [30, 39], pivot: [12, 10.5], z: 1, shape: { kind: "ellipse", rx: 12, ry: 10.5, mat: "f" } },
    { name: "belly", role: "belly", parent: "body", at: [14.5, 13], pivot: [7.5, 7], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 7.5, ry: 7, mat: "b" } },
    { name: "speckles", role: "detail", parent: "belly", at: [3, 3], pivot: [0, 0], z: 1.12, group: "body", shape: { kind: "grid", rows: ["s.s.s.s.s", ".........", ".s.s.s.s.", ".........", "..s.s.s.."] } },

    { name: "wingF", role: "wing", side: -1, parent: "body", at: [21, 3], pivot: [5, 1], rot: -0.2, z: 0.4, shade: 0.7, shape: wing },
    { name: "wingN", role: "wing", side: 1, parent: "body", at: [5, 3.5], pivot: [5, 1], rot: 0.15, z: 1.6, shape: wing },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [11, 19.5], pivot: [2, 0], z: 1.15, shade: 0.8, shape: talon },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [17, 19.5], pivot: [2, 0], z: 1.5, shape: talon },

    { name: "head", role: "head", parent: "body", at: [13, 6], pivot: [11, 17.5], z: 3, shape: { kind: "ellipse", rx: 12, ry: 9.8, p: 2.2, mat: "f" } },
    { name: "disk", role: "detail", parent: "head", at: [4.5, 2.5], pivot: [0, 0], z: 3.01, group: "disk", shape: { kind: "ellipse", rx: 9.8, ry: 7.8, p: 2.3, mat: "c" } },
    { name: "eyeF", role: "eye", parent: "disk", at: [2.5, 2.5], pivot: [0, 0], z: 3.25, group: "disk", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "disk", at: [10.5, 2.5], pivot: [0, 0], z: 3.25, group: "disk", shape: EYE.open, variants: EYE },
    { name: "beak", role: "snout", parent: "disk", at: [9, 8], pivot: [1, 0], z: 3.3, group: "disk", shape: { kind: "grid", rows: ["ooo", ".oo", ".o."] } },
    { name: "mouth", role: "mouth", parent: "disk", at: [8, 11.5], pivot: [0, 0], z: 3.2, group: "disk", shape: MOUTH.smile, variants: MOUTH },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [6, 3], pivot: [2.5, 6.5], rot: -0.35, z: 2.9, shade: 0.8, shape: tuft },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [17.5, 2.5], pivot: [2.5, 6.5], rot: 0.15, z: 3.1, shape: tuft },
  ],
};
