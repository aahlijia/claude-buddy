/**
 * HD rabbit — the hopper (H6). A cream bunny in 3/4 view facing right: a
 * round body sitting on big hind feet (`legB`, a haunch with a long foot),
 * small front paws (`legF`), a fluffy tail puff (`tail`), and a big round
 * head with two long upright ears (`ear`, pink inside) that twitch and pin
 * back on a hit. `feel.hop` turns the walk into a run of hops.
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
  smile: { kind: "grid", rows: ["k.k.k", ".k.k."] },
  open: { kind: "grid", rows: [".kkk.", "kpppk", ".kkk."] },
  frown: { kind: "grid", rows: [".kkk.", "k...k"] },
};

const ear: Shape = { kind: "ellipse", rx: 3.2, ry: 6.8, p: 2.2, mat: "f" };
const earInner: Shape = { kind: "ellipse", rx: 1.4, ry: 4.5, mat: "q" };
const haunch: Shape = { kind: "ellipse", rx: 5, ry: 5.5, mat: "f" };
const hindFoot: Shape = { kind: "ellipse", rx: 5, ry: 2, p: 2.4, mat: "f" };
const paw: Shape = { kind: "ellipse", rx: 2.2, ry: 3.4, mat: "f" };

export const RABBIT: RigDef = {
  id: "rabbit",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 15,
  outline: hex("#2a1a24"),
  feel: { hop: 6 },
  materials: {
    f: {
      ramp: ramp("#7a6460", "#b49e94", "#e0d0c2", "#f6ece0", "#fffaf2"),
      shiny: ramp("#4a2a18", "#7a4a2a", "#ad7444", "#d8a06a", "#f4cc9a"),
    },
    c: {
      ramp: ramp("#9a9096", "#ccc4c8", "#f0eaec", "#fcf8f8", "#ffffff"),
      shiny: ramp("#8a7460", "#c0a688", "#e8d2b2", "#f8eacc", "#fff8e8"),
    },
    q: {
      ramp: ramp("#8a3a50", "#c45a76", "#ec8aa2", "#ffb4c6", "#ffdce6"),
    },
    n: { ramp: ramp("#ff7a9a"), flat: true },
    k: { ramp: ramp("#24141e"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    p: { ramp: ramp("#c8304a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [28, 41], pivot: [11, 8.5], z: 1, shape: { kind: "ellipse", rx: 11, ry: 8.5, mat: "f" } },
    { name: "belly", role: "belly", parent: "body", at: [15.5, 11], pivot: [6, 4.5], z: 1.1, group: "body", shape: { kind: "ellipse", rx: 6, ry: 4.5, mat: "c" } },

    { name: "tail", role: "tail", seg: 0, parent: "body", at: [1.5, 7], pivot: [5, 3.8], z: 0.4, shape: { kind: "ellipse", rx: 4, ry: 3.8, mat: "c" } },

    { name: "legBF", role: "legB", side: -1, parent: "body", at: [9, 9], pivot: [4, 3], z: 0.5, shade: 0.72, shape: haunch },
    { name: "footBF", role: "detail", parent: "legBF", at: [5, 9], pivot: [3, 2], z: 0.51, group: "legBF", shade: 0.72, shape: hindFoot },
    { name: "legBN", role: "legB", side: 1, parent: "body", at: [5, 10], pivot: [4, 3], z: 1.5, shape: haunch },
    { name: "footBN", role: "detail", parent: "legBN", at: [5, 9], pivot: [3, 2], z: 1.51, group: "legBN", shape: hindFoot },
    { name: "legFF", role: "legF", side: -1, parent: "body", at: [16, 13], pivot: [2.2, 1.5], z: 0.5, shade: 0.72, shape: paw },
    { name: "legFN", role: "legF", side: 1, parent: "body", at: [19, 13.5], pivot: [2.2, 1.5], z: 1.6, shape: paw },

    { name: "head", role: "head", parent: "body", at: [18, 4], pivot: [9.5, 14], z: 3, shape: { kind: "ellipse", rx: 9.5, ry: 8.5, p: 2.1, mat: "f" } },
    { name: "muzzle", role: "snout", parent: "head", at: [15, 12.5], pivot: [4, 2.8], z: 3.05, group: "head", shape: { kind: "ellipse", rx: 4, ry: 2.8, mat: "c" } },
    { name: "nose", role: "detail", parent: "head", at: [15.5, 9.8], pivot: [1, 0], z: 3.3, group: "head", shape: { kind: "grid", rows: ["nnn", ".n."] } },
    { name: "mouth", role: "mouth", parent: "head", at: [15.5, 11.8], pivot: [2.5, 0], z: 3.3, group: "head", shape: MOUTH.smile, variants: MOUTH },
    { name: "eyeF", role: "eye", parent: "head", at: [8.5, 7.5], pivot: [2, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [15, 7.5], pivot: [2, 3], z: 3.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "cheek", role: "detail", parent: "head", at: [17.5, 12], pivot: [0, 0], z: 3.2, group: "head", shape: { kind: "grid", rows: ["nn"] } },

    { name: "earF", role: "ear", side: -1, parent: "head", at: [6.5, 3.5], pivot: [3.2, 12.6], rot: -0.22, z: 2.9, shade: 0.8, shape: ear },
    { name: "earFin", role: "detail", parent: "earF", at: [3.4, 7.4], pivot: [1.4, 4.5], z: 2.91, group: "earF", shade: 0.8, shape: earInner },
    { name: "earN", role: "ear", side: 1, parent: "head", at: [11.5, 3], pivot: [3.2, 12.6], rot: 0.08, z: 3.1, shape: ear },
    { name: "earNin", role: "detail", parent: "earN", at: [3.4, 7.4], pivot: [1.4, 4.5], z: 3.11, group: "earN", shape: earInner },
  ],
};
