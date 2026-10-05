/**
 * HD octopus — the many-limbs pilot (H6). A plum octopus facing right: a big
 * domed mantle on a short skirt, and eight tentacles as four-segment chains
 * (the far four in shade). Every tentacle is a `tail` chain with its own
 * phase, so the shared sway becomes a ripple with no octopus-only motion.
 */

import type { PartDef, RigDef, Shape } from "../rig.ts";
import { ramp } from "../rig.ts";
import { hex } from "../framebuffer.ts";

const EYE: Record<string, Shape> = {
  open: { kind: "grid", rows: [".kkk.", "kwkkk", "kkkkk", "kkkgk", "kkkkk", ".kkk."] },
  half: { kind: "grid", rows: [".....", ".....", "kkkkk", "kkkkk", "kkkgk", ".kkk."] },
  closed: { kind: "grid", rows: [".....", ".....", ".....", ".....", "kkkkk", "....."] },
  happy: { kind: "grid", rows: [".....", ".....", ".kkk.", "k...k", ".....", "....."] },
  x: { kind: "grid", rows: [".....", "k...k", ".k.k.", "..k..", ".k.k.", "k...k"] },
  angry: { kind: "grid", rows: ["kk...", ".kkk.", "kwkkk", "kkkkk", "kkkgk", ".kkk."] },
};

const MOUTH: Record<string, Shape> = {
  smile: { kind: "grid", rows: ["k..k", ".kk."] },
  open: { kind: "grid", rows: [".kk.", "kppk", ".kk."] },
  frown: { kind: "grid", rows: [".kk.", "k..k"] },
};

const seg = (r: number, mat = "o"): Shape => ({ kind: "ellipse", rx: r, ry: 3, p: 2.8, mat });
const RADII = [2.6, 2.2, 1.8, 1.4];

/** A four-segment tentacle hanging from the skirt; `rots` curl it. */
function tentacle(id: string, at: readonly [number, number], rots: readonly number[], z: number, far: boolean, phase: number): PartDef[] {
  return RADII.map((r, i) => ({
    name: `${id}${i}`,
    role: "tail" as const,
    seg: i,
    parent: i ? `${id}${i - 1}` : "body",
    at: i ? ([RADII[i - 1], 4.6] as const) : at,
    pivot: [r, 1] as const,
    rot: rots[i],
    z: z + i * 0.001,
    group: id,
    phase,
    ...(far ? { shade: 0.68 } : {}),
    shape: seg(r),
  }));
}

export const OCTOPUS: RigDef = {
  id: "octopus",
  width: 64,
  height: 56,
  ground: 51,
  shadowRx: 19,
  outline: hex("#1a0c20"),
  materials: {
    o: {
      ramp: ramp("#3e1440", "#6e2464", "#a83c88", "#d868a8", "#f8a8cc"),
      shiny: ramp("#103a40", "#1c6466", "#2e9a92", "#58ccb8", "#a6f2dc"),
      gloss: 0.45,
    },
    d: {
      ramp: ramp("#2a0c30", "#4e1650", "#7a2a70", "#9a3c88", "#b4529e"),
      shiny: ramp("#0a2a30", "#124448", "#1e6a6a", "#2c8a84", "#3ea69c"),
    },
    s: { ramp: ramp("#9a5a78", "#d088a8", "#f4b8cc", "#ffd8e4", "#fff0f6") },
    k: { ramp: ramp("#180a1c"), flat: true },
    w: { ramp: ramp("#ffffff"), flat: true },
    g: { ramp: ramp("#ffd84a"), flat: true },
    p: { ramp: ramp("#e8506a"), flat: true },
  },
  parts: [
    { name: "body", role: "body", at: [31, 39], pivot: [11, 4.5], z: 1, shape: { kind: "ellipse", rx: 11, ry: 4.5, mat: "o" } },

    ...tentacle("tf0", [3, 4], [1.15, 0.35, 0.4, 0.55], 0.4, true, 0.0),
    ...tentacle("tf1", [8, 5], [0.5, 0.45, 0.5, 0.6], 0.41, true, 1.7),
    ...tentacle("tf2", [14, 5], [-0.45, -0.45, -0.5, -0.6], 0.42, true, 3.1),
    ...tentacle("tf3", [19, 4], [-1.05, -0.35, -0.4, -0.55], 0.43, true, 4.4),
    ...tentacle("tn0", [2, 5.5], [0.85, 0.4, 0.45, 0.6], 1.5, false, 0.9),
    ...tentacle("tn1", [8, 6.5], [0.3, 0.4, 0.5, 0.6], 1.51, false, 2.4),
    ...tentacle("tn2", [14, 6.5], [-0.3, -0.4, -0.5, -0.6], 1.52, false, 3.8),
    ...tentacle("tn3", [20, 5.5], [-0.8, -0.4, -0.45, -0.6], 1.53, false, 5.3),

    { name: "head", role: "head", parent: "body", at: [11, 2.5], pivot: [12, 21], rot: -0.08, z: 2, shape: { kind: "ellipse", rx: 12, ry: 11.5, p: 2.1, mat: "o" } },
    { name: "spots", role: "detail", parent: "head", at: [4, 3], pivot: [0, 0], z: 2.02, group: "head", shape: { kind: "grid", rows: ["...dd.....", "...dd..d..", ".........", "dd....dd.", "dd....dd.", "....d....", ".........", ".dd......", ".dd......"] } },
    { name: "eyeF", role: "eye", parent: "head", at: [12.5, 13.5], pivot: [2.5, 3], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "eyeN", role: "eye", parent: "head", at: [19.5, 13.5], pivot: [2.5, 3], z: 2.25, group: "head", shape: EYE.open, variants: EYE },
    { name: "cheek", role: "detail", parent: "head", at: [21, 18.5], pivot: [0, 0], z: 2.2, group: "head", shape: { kind: "grid", rows: ["sss"] } },
    { name: "mouth", role: "mouth", parent: "head", at: [17, 20], pivot: [2, 0], z: 2.3, group: "head", shape: MOUTH.smile, variants: MOUTH },
  ],
};
