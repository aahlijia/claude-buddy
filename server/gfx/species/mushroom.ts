/**
 * HD mushroom — the big-hat rig (H6). A toadstool facing right: a wide red
 * cap with white spots (the `head`, pivoting at the top of the stem so it
 * bobs and tips like a hat), a darker gill band peeking out under its rim,
 * and a cream stem that is the body. Like the ASCII buddy, the face sits on
 * the stem, under the cap; two little brown feet (`legB`) poke out on either side and shuffle.
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
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

/** A dome: the top half of a superellipse over a gently curled rim. */
function dome(rx: number, ry: number, mat: string): Shape {
  const pts: [number, number][] = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI * (1 - i / N);
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([rx + rx * Math.sign(c) * Math.pow(Math.abs(c), 0.8), ry - ry * Math.pow(s, 0.85)]);
  }
  // Rim: curls under at the edges, lifts a little in the middle.
  pts.push([rx * 2 - 1.5, ry + 1.5], [rx + 4, ry + 0.6], [rx - 4, ry + 0.6], [1.5, ry + 1.5]);
  return { kind: "poly", pts, mat };
}

/** A little brown boot-foot, wider than tall. */
const foot: Shape = { kind: "ellipse", rx: 3.8, ry: 2.4, p: 2.4, mat: "f" };

export const MUSHROOM: RigDef = {
  id: "mushroom",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 13,
  outline: hex("#24101a"),
  materials: {
    r: {
      ramp: ramp("#5a1018", "#981c24", "#d4343a", "#f2665a", "#ffa08a"),
      shiny: ramp("#16205a", "#22388e", "#3a5cc8", "#6a8cf0", "#aac4ff"),
      gloss: 0.35,
    },
    s: {
      ramp: ramp("#9a8a90", "#cfc2c4", "#efe6e2", "#fff8f2", "#ffffff"),
      shiny: ramp("#9a9488", "#d4cfbe", "#f2eedc", "#fffbe8", "#ffffff"),
    },
    c: {
      ramp: ramp("#7a5e48", "#b8977a", "#e4cba8", "#f8e6c8", "#fff8e8"),
      shiny: ramp("#5e6a78", "#94a2b0", "#c8d4dc", "#e6eef2", "#ffffff"),
    },
    g: {
      ramp: ramp("#4a2c22", "#6e4634", "#946450", "#b08068", "#c89c84"),
      shiny: ramp("#2a2c48", "#3e4266", "#565c88", "#7076a4", "#8a90bc"),
    },
    f: {
      ramp: ramp("#3a2016", "#5e3624", "#865036", "#a86c4a", "#c88c64"),
      shiny: ramp("#262c44", "#3a4466", "#54608a", "#727eaa", "#949ec8"),
    },
    q: { ramp: ramp("#ff9ab0"), flat: true },
    k: { ramp: ramp("#24101a"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c8304a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [30.5, 47], pivot: [8.5, 19], z: 1, shape: { kind: "ellipse", rx: 8.5, ry: 10, p: 2.8, mat: "c" } },

    { name: "footF", role: "legB", side: -1, parent: "body", at: [3.5, 19.2], pivot: [3.8, 0.6], z: 0.5, shade: 0.72, shape: foot },
    { name: "footN", role: "legB", side: 1, parent: "body", at: [13.5, 19.6], pivot: [3.8, 0.6], z: 1.5, shape: foot },

    { name: "eyeF", role: "eye", parent: "body", at: [6.5, 8.5], pivot: [2, 3], z: 1.3, group: "body", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "body", at: [12.5, 8.5], pivot: [2, 3], z: 1.3, group: "body", shape: EYE.open, variants: EYE },
    { name: "cheekF", role: "detail", parent: "body", at: [3, 12], pivot: [0, 0], z: 1.2, group: "body", shape: { kind: "grid", rows: ["qq"] } },
    { name: "cheekN", role: "detail", parent: "body", at: [14.5, 12], pivot: [0, 0], z: 1.2, group: "body", shape: { kind: "grid", rows: ["qq"] } },
    { name: "mouth", role: "mouth", parent: "body", at: [10, 13], pivot: [2, 0], z: 1.3, group: "body", shape: MOUTH.smile, variants: MOUTH },

    { name: "head", role: "head", parent: "body", at: [9, 1.5], pivot: [18, 16], z: 3, shape: dome(18, 15, "r") },
    { name: "gills", role: "detail", parent: "head", at: [18, 15.4], pivot: [14.5, 3], z: 2.9, shape: { kind: "ellipse", rx: 14.5, ry: 3, mat: "g" } },
    {
      name: "spots",
      role: "detail",
      parent: "head",
      at: [6, 2],
      pivot: [0, 0],
      z: 3.05,
      group: "head",
      shape: {
        kind: "grid",
        rows: [
          "...........ssss........",
          "..........ssssss.......",
          "..........ssssss.......",
          "...sss.....ssss....ss..",
          "..sssss...........ssss.",
          "..sssss...........ssss.",
          "...sss.............ss..",
          "............sss........",
          "...........sssss.......",
          "ss.........sssss.....ss",
          "ss..........sss......ss",
        ],
      },
    },
  ],
};
