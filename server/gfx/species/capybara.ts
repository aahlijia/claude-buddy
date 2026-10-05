/**
 * HD capybara — the chill one (H6). A brown capybara facing right: a barrel
 * body on short legs, a big blocky head (boxy superellipses) ending in a
 * long, flat, darker snout with nostrils, tiny round ears, and small,
 * calm, heavy-lidded eyes. No visible tail. A yuzu sits on its head as a
 * detail riding the head's bob. `feel.tempo` keeps it unhurried.
 */

import type { RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: ["kkkk", "kwkk", "kkkk", ".kk."] },
  half: { kind: "grid", rows: ["....", "kkkk", "kkkk", ".kk."] },
  closed: { kind: "grid", rows: ["....", "....", "kkkk", "...."] },
  happy: { kind: "grid", rows: ["....", ".kk.", "k..k", "...."] },
  x: { kind: "grid", rows: ["k..k", ".kk.", ".kk.", "k..k"] },
  angry: { kind: "grid", rows: ["kk..", "kkkk", "kwkk", ".kk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

const leg: Shape = { kind: "ellipse", rx: 2.8, ry: 3.8, p: 2.4, mat: "f" };
const ear: Shape = { kind: "ellipse", rx: 2.2, ry: 2, mat: "d" };

export const CAPYBARA: RigDef = {
  id: "capybara",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 18,
  outline: hex("#1e140c"),
  feel: { tempo: 0.8 },
  materials: {
    f: {
      ramp: ramp("#3e2616", "#6a4428", "#9a6a40", "#c4925e", "#e4b888"),
      shiny: ramp("#34364a", "#565c74", "#8088a2", "#acb4cc", "#dce2f0"),
    },
    d: {
      ramp: ramp("#2a180c", "#4a2e1a", "#6e4628", "#8e5e3a", "#aa7650"),
      shiny: ramp("#20222e", "#383c50", "#545a74", "#707894", "#8e96b0"),
    },
    y: {
      ramp: ramp("#8a3a08", "#c8620e", "#f08e1e", "#ffb840", "#ffe08a"),
      gloss: 0.6,
    },
    g: { ramp: ramp("#1e4a14", "#2e6e1e", "#46962c", "#68bc42", "#96dc6a") },
    k: { ramp: ramp("#1a100a"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c04a4a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [23, 39.5], pivot: [13.5, 9], z: 1, shape: { kind: "ellipse", rx: 13.5, ry: 9, p: 2.5, mat: "f" } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [6, 14], pivot: [2.8, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [20, 14], pivot: [2.8, 1.5], z: 0.5, shade: 0.7, shape: leg },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [8.5, 14.5], pivot: [2.8, 1.5], z: 1.5, shape: leg },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [22.5, 14.5], pivot: [2.8, 1.5], z: 1.5, shape: leg },

    { name: "head", role: "head", parent: "body", at: [21, 6], pivot: [3, 13], z: 2, shape: { kind: "ellipse", rx: 10, ry: 7.4, p: 3.2, mat: "f" } },
    { name: "snout", role: "snout", parent: "head", at: [16.5, 9.6], pivot: [5.5, 4.4], z: 2.05, shape: { kind: "ellipse", rx: 5.5, ry: 4.4, p: 3, mat: "d" } },
    { name: "nostrils", role: "detail", parent: "snout", at: [8.6, 2], pivot: [0, 0], z: 2.3, group: "snout", shape: { kind: "grid", rows: ["kk", ".k"] } },
    { name: "mouth", role: "mouth", parent: "snout", at: [6.5, 5.6], pivot: [2, 0], z: 2.3, group: "snout", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [7.5, 5], pivot: [2, 2], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [13, 5], pivot: [2, 2], z: 2.25, group: "head", shape: EYE.open, variants: EYE },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [2.5, 2], pivot: [2.2, 3.4], rot: -0.3, z: 1.9, shade: 0.8, shape: ear },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [5, 1.2], pivot: [2.2, 3.4], rot: -0.15, z: 2.4, shape: ear },

    { name: "yuzu", role: "detail", parent: "head", at: [10.5, 0.8], pivot: [3.6, 5.8], z: 2.5, shape: { kind: "ellipse", rx: 3.8, ry: 3.3, mat: "y" } },
    { name: "leaf", role: "detail", parent: "yuzu", at: [3.8, 0.6], pivot: [0, 2], z: 2.51, shape: { kind: "grid", rows: ["..gg", ".ggg", "gg.."] } },
  ],
};
