/**
 * HD cactus — the potted rig (H6). A saguaro buddy facing right: a tall
 * rounded trunk is the body (pivoting low, inside the pot, so it sways like
 * a plant), with ribs and spine dots as a detail grid and the face on the
 * trunk. Two saguaro arms curve upward from the trunk as `legF` (they swing
 * while it walks and punch on attack), a pink flower on top is the `head` so
 * it bobs, and a terracotta pot rides along at the bottom. No legs: `feel`
 * rocks the pot side to side as it scoots.
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

/** A saguaro arm reaching right: out from the trunk, then up. Pivot at its base. */
const ARM_PTS: [number, number][] = [[0, 5], [4.5, 5], [4.5, 1.4], [5.8, 0], [7.8, 0], [9, 1.4], [9, 7.8], [7.4, 9.6], [0, 9.6]];
const armNear: Shape = { kind: "poly", pts: ARM_PTS, mat: "g" };
/** The far arm mirrors it, reaching left. */
const armFar: Shape = { kind: "poly", pts: ARM_PTS.map(([x, y]) => [9 - x, y] as [number, number]), mat: "g" };

export const CACTUS: RigDef = {
  id: "cactus",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 12,
  outline: hex("#10200f"),
  // A hat replaces the flower and sits on the trunk.
  anchors: { hat: { part: "body", hides: ["head"] } },
  feel: { waddle: 0.07 },
  materials: {
    g: {
      ramp: ramp("#163a1c", "#25602a", "#3c8a38", "#66b450", "#a4dc78"),
      shiny: ramp("#1a2e4a", "#2a4e72", "#3e7aa0", "#68a8c8", "#a8dcec"),
    },
    d: {
      ramp: ramp("#0e2814", "#18401e", "#225828", "#2e6e32", "#3a823c"),
      shiny: ramp("#101e34", "#18304e", "#22466a", "#2e5a82", "#3a6e98"),
    },
    n: { ramp: ramp("#fff4c8"), flat: true },
    q: {
      ramp: ramp("#7a1e4a", "#b8346c", "#ec5c94", "#ff90b8", "#ffc8dc"),
      shiny: ramp("#6a3a0e", "#a8601a", "#e09030", "#ffc05a", "#ffe6a0"),
    },
    y: { ramp: ramp("#ffd84a"), flat: true },
    t: {
      ramp: ramp("#4e1e10", "#7e3418", "#b0522a", "#d47a44", "#eeaa72"),
      shiny: ramp("#3a2a44", "#5a4266", "#7e6290", "#a68ab4", "#cebadc"),
    },
    o: { ramp: ramp("#1e120c", "#2e1c12", "#3e281a", "#4e3422", "#5e402a") },
    c: { ramp: ramp("#ff9ab0"), flat: true },
    k: { ramp: ramp("#10200f"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c8304a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 45], pivot: [8, 26], z: 1, shape: { kind: "ellipse", rx: 8, ry: 14, p: 2.4, mat: "g" } },
    {
      name: "ribs",
      role: "detail",
      parent: "body",
      at: [2, 4],
      pivot: [0, 0],
      z: 1.05,
      group: "body",
      shape: {
        kind: "grid",
        rows: [
          "d...........d",
          "d...........d",
          "n...........n",
          "d...........d",
          "d............",
          "d...........d",
          "n...........n",
          "d...........d",
          "d...........d",
          "d............",
          "n...........n",
          "d...........d",
          "d...n...n...d",
          "d...d...d...d",
          "n...d...d...n",
          "d...d...d...d",
          "d...n...n...d",
          "d...d...d...d",
          "n...d...d...n",
          "d...d...d...d",
        ],
      },
    },

    { name: "armF", role: "legF", side: -1, parent: "body", at: [2, 13], pivot: [8.5, 7.4], rot: 0.1, z: 0.5, shade: 0.72, shape: armFar },
    { name: "armN", role: "legF", side: 1, parent: "body", at: [14.5, 16], pivot: [0.5, 7.4], rot: -0.08, z: 1.6, shape: armNear },
    { name: "spinesN", role: "detail", parent: "armN", at: [9.5, 2], pivot: [0, 0], z: 1.61, group: "armN", shape: { kind: "grid", rows: ["n", ".", ".", "n"] } },

    { name: "eyeF", role: "eye", parent: "body", at: [7, 11], pivot: [2, 3], z: 1.3, group: "body", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "body", at: [12.5, 11], pivot: [2, 3], z: 1.3, group: "body", shape: EYE.open, variants: EYE },
    { name: "cheek", role: "detail", parent: "body", at: [13.5, 14.5], pivot: [0, 0], z: 1.2, group: "body", shape: { kind: "grid", rows: ["cc"] } },
    { name: "mouth", role: "mouth", parent: "body", at: [10, 15.5], pivot: [2, 0], z: 1.3, group: "body", shape: MOUTH.smile, variants: MOUTH },

    {
      name: "head",
      role: "head",
      parent: "body",
      at: [8.5, 2],
      pivot: [5, 6],
      z: 2,
      shape: { kind: "grid", rows: ["..q...q...", ".qqq.qqq..", "qqqqqqqqq.", "qqqqyyqqqq", ".qqyyyyqq.", "..qqqqqq.."] },
    },

    { name: "soil", role: "detail", parent: "body", at: [8, 24.5], pivot: [9, 1.5], z: 1.8, group: "pot", shape: { kind: "ellipse", rx: 9, ry: 1.5, mat: "o" } },
    { name: "pot", role: "detail", parent: "body", at: [8, 25], pivot: [9, 0], z: 2.5, group: "pot", shape: { kind: "poly", pts: [[0, 0], [18, 0], [16, 7.5], [2, 7.5]], mat: "t" } },
    { name: "rim", role: "detail", parent: "body", at: [8, 25.5], pivot: [10.5, 2], z: 2.6, group: "pot", shape: { kind: "ellipse", rx: 10.5, ry: 2, p: 5, mat: "t" } },
  ],
};
