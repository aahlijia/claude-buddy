/**
 * The 15 buddy-shell biomes as pixel dioramas (H4,
 * docs/game-feel/hd-overhaul/h4-diorama.md). Same names as cli/biomes.ts
 * (the ASCII panel), so `--biome volcano` picks the same place in both.
 *
 * Each biome is data: three sky palettes (day, dusk, night), a far and a mid
 * parallax layer of strokes, the near ground, a landmark built from unit
 * rectangles, and an ambient particle field. scenery.ts paints it.
 */

import { hex } from "./framebuffer.ts";
import type { FieldKind } from "./particles.ts";
import type { Ground, Stroke, Structure } from "./scenery.ts";
import type { SkyPalette } from "./sky.ts";

export interface BiomeScene {
  name: string;
  sky: SkyPalette;
  sun: boolean;
  moon: boolean;
  /** Star density at night (0 = none). */
  stars: number;
  /** Ignore the clock and always show this hour (space, dungeon, matrix). */
  hour?: number;
  far: readonly Stroke[];
  mid: readonly Stroke[];
  ground: Ground;
  /** Small props on the near ground (rocks, tufts of flowers). */
  props?: readonly Stroke[];
  structure: Structure;
  /** Biome ambience, always on: drifting petals, embers, bubbles… */
  ambient?: { kind: FieldKind; density?: number; colors?: readonly string[]; nightOnly?: boolean };
}

const sky = (day: [string, string], dusk: [string, string], night: [string, string]): SkyPalette => ({
  day: [hex(day[0]), hex(day[1])],
  dusk: [hex(dusk[0]), hex(dusk[1])],
  night: [hex(night[0]), hex(night[1])],
});

const STD_DUSK: [string, string] = ["#3a3a78", "#ff9a6a"];
const STD_NIGHT: [string, string] = ["#0a0c24", "#28305a"];

export const BIOME_SCENES: Record<string, BiomeScene> = {
  meadow: {
    name: "meadow",
    sky: sky(["#4aa8f0", "#c8ecff"], STD_DUSK, STD_NIGHT),
    sun: true, moon: true, stars: 1,
    far: [{ type: "ridge", base: 1, amp: 5, scale: 14, jag: 0.15, color: "#5a8ab8" }],
    mid: [
      { type: "ridge", base: 0, amp: 2.5, scale: 9, jag: 0, color: "#4a9a4a" },
      { type: "props", kind: "round", spacing: 9, size: 5.5, colors: ["#3a8a3a", "#6a4a2a"], odds: 0.6, base: 0.5 },
    ],
    ground: { colors: ["#7acc5a", "#4a9a3a", "#2e6a2a"], texture: "grass", specks: ["#f0e060", "#ffffff", "#f08ab0"] },
    structure: {
      at: 0.12,
      ops: [
        ["rect", 0.5, 6, 9, 6, "#d8c8a8"],
        ["roof", -0.5, 10, 11, 4.2, "#b84a3a"],
        ["rect", 7, 10, 1.4, 2.5, "#7a5a4a"],
        ["rect", 4, 3.4, 2, 3.4, "#6a4028"],
        ["win", 1.6, 4.6, 1.6, 1.6],
        ["win", 6.8, 4.6, 1.6, 1.6],
      ],
    },
    ambient: { kind: "fireflies", density: 0.8, nightOnly: true },
  },

  forest: {
    name: "forest",
    sky: sky(["#5aa0c8", "#d8f0e0"], ["#3a3a68", "#f0a070"], ["#081814", "#1c3a30"]),
    sun: true, moon: true, stars: 0.7,
    far: [
      { type: "ridge", base: 2, amp: 4, scale: 10, jag: 0.4, color: "#3a6a5a" },
      { type: "props", kind: "pine", spacing: 3, size: 6, colors: ["#2a5a48", "#2a4a3a"], base: 2.5 },
    ],
    mid: [{ type: "props", kind: "pine", spacing: 4.5, size: 9, colors: ["#1e5a32", "#4a3020"], odds: 0.85 }],
    ground: { colors: ["#4a8a3a", "#2e5a28", "#1a3a1a"], texture: "moss", specks: ["#c8402a", "#e8d070", "#6aa850"] },
    props: [{ type: "props", kind: "mushroom", spacing: 23, size: 3.4, colors: ["#c8402a", "#f0e8d8", "#ffffff"], odds: 0.7, base: -1.2 }],
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0.5, 6.5, 8.5, 6.5, "#6a4a2a"],
        ["rect", 0.5, 6.5, 8.5, 0.6, "#4a3018"],
        ["rect", 0.5, 4.4, 8.5, 0.4, "#4a3018"],
        ["rect", 0.5, 2.2, 8.5, 0.4, "#4a3018"],
        ["roof", -0.8, 10.5, 11, 4.4, "#2e5a28"],
        ["rect", 3.8, 3.2, 2, 3.2, "#3a2414"],
        ["win", 1.4, 5.4, 1.6, 1.4],
        ["win", 6.6, 5.4, 1.6, 1.4],
      ],
    },
    ambient: { kind: "leaves", density: 0.8 },
  },

  ocean: {
    name: "ocean",
    sky: sky(["#3a98e8", "#c0e8ff"], ["#40387a", "#ffa070"], ["#06102a", "#1a2c58"]),
    sun: true, moon: true, stars: 1,
    far: [{ type: "ridge", base: 0.2, amp: 2.4, scale: 18, jag: 0.2, color: "#5a7aa0" }],
    mid: [{ type: "water", depth: 2, top: 1.4, color: "#2a78c0", deep: "#1a5a9a", glint: "#c8f0ff" }],
    ground: { colors: ["#f0dca0", "#e0c080", "#b8945a"], texture: "sand", specks: ["#ffffff", "#c89060", "#f0a0a0"] },
    props: [{ type: "props", kind: "palm", spacing: 30, size: 9, colors: ["#3a9a4a", "#8a6a3a"], odds: 0.6, base: -0.6 }],
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0, 1.6, 8, 1.6, "#8a8a8a"],
        ["rect", 2.2, 10, 3.6, 8.4, "#f0f0f0"],
        ["rect", 2.2, 7.6, 3.6, 1.2, "#d03a3a"],
        ["rect", 2.2, 4.4, 3.6, 1.2, "#d03a3a"],
        ["rect", 1.8, 10.8, 4.4, 0.8, "#3a3a4a"],
        ["neon", 2.8, 12.2, 2.4, 1.4, "#ffe890"],
        ["roof", 2, 13.6, 4, 1.4, "#d03a3a"],
        ["win", 3.5, 6, 1, 1],
        ["beam", 4, 11.5, "#fff0b0"],
      ],
    },
  },

  cyberpunk: {
    name: "cyberpunk",
    sky: sky(["#6a3a8a", "#e070a0"], ["#3a1a5a", "#ff6a8a"], ["#0c0418", "#3a1440"]),
    sun: false, moon: true, stars: 0.2,
    far: [{ type: "skyline", minH: 5, maxH: 11, minW: 3, maxW: 6, color: "#3a2858", windows: "#ff4aa8", neon: true }],
    mid: [{ type: "skyline", minH: 3, maxH: 7, minW: 4, maxW: 8, color: "#1e1430", windows: "#40f0e0", neon: true, base: -0.2 }],
    ground: { colors: ["#ff3aa0", "#2a2040", "#140c20"], texture: "street", specks: ["#40f0e0"] },
    props: [{ type: "props", kind: "lamp", spacing: 26, size: 5, colors: ["#ff3aa0", "#3a3050"], base: -0.6 }],
    structure: {
      at: 0.08,
      ops: [
        ["rect", 1, 12, 6, 12, "#2a2040"],
        ["rect", 2, 13.5, 4, 1.5, "#3a2a58"],
        ["rect", 3.6, 15.5, 0.6, 2, "#5a4a78"],
        ["neon", 1.6, 10.6, 4.8, 1.2, "#40f0e0"],
        ["neon", 2.2, 8, 0.8, 0.8, "#ff3aa0"],
        ["neon", 4.6, 8, 0.8, 0.8, "#ffd040"],
        ["neon", 2.2, 6, 0.8, 0.8, "#ffd040"],
        ["neon", 4.6, 6, 0.8, 0.8, "#ff3aa0"],
        ["neon", 2.2, 4, 0.8, 0.8, "#40f0e0"],
        ["neon", 4.6, 4, 0.8, 0.8, "#40f0e0"],
        ["neon", 3.4, 2.2, 1.2, 2.2, "#ffd040"],
      ],
    },
    ambient: { kind: "rain", density: 0.25, colors: ["#c080ff", "#80e0ff"] },
  },

  space: {
    name: "space",
    sky: sky(["#05030f", "#1a1238"], ["#05030f", "#1a1238"], ["#05030f", "#1a1238"]),
    sun: false, moon: false, stars: 2.4, hour: 0,
    far: [
      { type: "planet", at: 0.72, y: 4.5, r: 3.2, color: "#e8a070", shadow: "#5a2a3a", ring: "#f0d8b0" },
      { type: "ridge", base: 0.5, amp: 3.5, scale: 12, jag: 0.6, color: "#5a4a7a", rim: "#8a7ab0" },
    ],
    mid: [{ type: "props", kind: "crystal", spacing: 14, size: 5, colors: ["#c090ff", "#8050e0"], odds: 0.7 }],
    ground: { colors: ["#8a7aa8", "#5a4a78", "#3a2a52"], texture: "crater", specks: ["#3a2a52", "#a898c8"] },
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0.5, 4, 9, 4, "#8a88a8"],
        ["dome", 5, 4, 4.2, "#c8c8e0"],
        ["rect", 4.6, 8.8, 4.8, 1.2, "#3a3a58"],
        ["rect", 8.4, 9.6, 1.4, 1.2, "#5a5a78"],
        ["win", 1.6, 2.6, 1.4, 1.2],
        ["win", 6.8, 2.6, 1.4, 1.2],
        ["neon", 4.4, 1.6, 1.2, 1.6, "#ffd040"],
      ],
    },
    ambient: { kind: "sparkles", density: 1.4, colors: ["#ffffff", "#ffe080", "#a0c8ff"] },
  },

  volcano: {
    name: "volcano",
    sky: sky(["#a04a30", "#f0a060"], ["#5a1a1a", "#ff6030"], ["#1a0606", "#4a140a"]),
    sun: true, moon: false, stars: 0.3,
    far: [
      { type: "ridge", base: 0, amp: 2.5, scale: 9, jag: 0.6, color: "#4a2418" },
      { type: "peak", at: 0.62, height: 10.5, width: 34, color: "#3a1a14", lava: "#ff7020" },
    ],
    mid: [{ type: "ridge", base: 0, amp: 3, scale: 7, jag: 0.8, color: "#2a1410", rim: "#5a2418" }],
    ground: { colors: ["#5a2a1a", "#3a1a12", "#200c08"], texture: "magma", specks: ["#ff6a20"] },
    props: [{ type: "props", kind: "rock", spacing: 16, size: 3, colors: ["#4a2418"], odds: 0.6, base: -0.8 }],
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0.5, 5, 8, 5, "#4a3a3a"],
        ["roof", 0, 7.5, 9, 2.5, "#2a1a1a"],
        ["rect", 6.5, 9, 1.4, 2.5, "#2a1a1a"],
        ["neon", 3.2, 3.4, 2.2, 3.4, "#ff7020"],
        ["neon", 1.2, 4, 1.2, 1, "#ffb040"],
      ],
    },
    ambient: { kind: "embers", density: 1.2 },
  },

  arctic: {
    name: "arctic",
    sky: sky(["#88c8f0", "#e8f6ff"], ["#4a5a98", "#f0b0c0"], ["#060c22", "#1c3058"]),
    sun: true, moon: true, stars: 1.2,
    far: [{ type: "ridge", base: 1, amp: 7, scale: 13, jag: 0.85, color: "#6a88b0", cap: "#f0f8ff", capAt: 5.5 }],
    mid: [{ type: "props", kind: "snowpine", spacing: 6, size: 7, colors: ["#2a5a5a", "#4a3a2a", "#f0f8ff"], odds: 0.75 }],
    ground: { colors: ["#ffffff", "#dce8f4", "#a8c0dc"], texture: "snow", specks: ["#b8d0e8", "#ffffff"] },
    structure: {
      at: 0.12,
      ops: [
        ["dome", 4.5, 0, 4.5, "#f0f6ff"],
        ["rect", 0.6, 1.6, 7.8, 0.25, "#c0d4e8"],
        ["rect", 1.4, 3.1, 6.2, 0.25, "#c0d4e8"],
        ["dome", 8.4, 0, 1.8, "#e0ecf8"],
        ["dome", 8.4, 0, 1, "#1a2a40"],
        ["win", 3.8, 3, 1.4, 1],
      ],
    },
    ambient: { kind: "snow", density: 0.35 },
  },

  desert: {
    name: "desert",
    sky: sky(["#5ab0f0", "#fff0c8"], ["#5a3a78", "#ffa050"], ["#0c0a24", "#38284a"]),
    sun: true, moon: true, stars: 1.6,
    far: [{ type: "ridge", base: 0, amp: 3, scale: 20, jag: 0, color: "#d0a060" }],
    mid: [
      { type: "ridge", base: 0, amp: 1.6, scale: 11, jag: 0, color: "#e0b070" },
      { type: "props", kind: "cactus", spacing: 13, size: 5.5, colors: ["#4a9a4a"], odds: 0.6 },
    ],
    ground: { colors: ["#f8d898", "#e8c078", "#c89a58"], texture: "sand", specks: ["#c89a58", "#fff0c8"] },
    structure: {
      at: 0.08,
      ops: [
        ["roof", 0, 9, 13, 9, "#e8c080"],
        ["roof", 6.5, 9, 6.5, 9, "#c89a58"],
        ["rect", 5.6, 2.2, 1.8, 2.2, "#6a4a2a"],
      ],
    },
  },

  haunted: {
    name: "haunted",
    sky: sky(["#5a5a7a", "#a8a0b8"], ["#2a1a3a", "#a0508a"], ["#06040c", "#241830"]),
    sun: false, moon: true, stars: 0.8,
    far: [
      { type: "ridge", base: 0.5, amp: 3, scale: 12, jag: 0.5, color: "#2a2438" },
      { type: "props", kind: "dead", spacing: 5, size: 6, colors: ["#1e1a28"], odds: 0.6, base: 1.5 },
    ],
    mid: [{ type: "props", kind: "grave", spacing: 7, size: 4, colors: ["#5a5868", "#2a2838"], odds: 0.7 }],
    ground: { colors: ["#3a3448", "#26202e", "#14101a"], texture: "moss", specks: ["#4a4058", "#6a8a5a"] },
    structure: {
      at: 0.08,
      ops: [
        ["rect", 0.5, 7, 9, 7, "#3a3040"],
        ["roof", -0.5, 11, 11, 4, "#1e1828"],
        ["rect", 7, 13, 2, 6, "#2a2234"],
        ["roof", 6.6, 15, 2.8, 2, "#1e1828"],
        ["rect", 4.2, 3, 1.8, 3, "#140e18"],
        ["win", 1.6, 5.4, 1.4, 1.6],
        ["win", 7.6, 10.6, 0.9, 1.4],
        ["rect", 6.4, 5.4, 1.6, 1.6, "#140e18"],
      ],
    },
    ambient: { kind: "fireflies", density: 0.8, colors: ["#a0ffd0", "#c0a0ff", "#80e0c0"] },
  },

  sakura: {
    name: "sakura",
    sky: sky(["#8ac8f0", "#ffe0ec"], ["#5a4a8a", "#ffa0a8"], ["#100a24", "#3a2448"]),
    sun: true, moon: true, stars: 1,
    far: [
      { type: "ridge", base: 0, amp: 2, scale: 12, jag: 0, color: "#9aa0c8" },
      { type: "peak", at: 0.55, height: 10, width: 40, color: "#7a80b8", cap: "#ffffff", capAt: 7.4 },
    ],
    mid: [{ type: "props", kind: "blossom", spacing: 8, size: 6.5, colors: ["#f8a0c0", "#5a3a3a", "#ffffff"], odds: 0.75 }],
    ground: { colors: ["#a8c870", "#7aa050", "#4a7038"], texture: "grass", specks: ["#ffc0d8", "#ffffff"] },
    structure: {
      at: 0.1,
      ops: [
        ["rect", 1.5, 3.2, 6, 3.2, "#c8402a"],
        ["roof", -0.5, 5, 10, 1.8, "#3a3040"],
        ["rect", 2.2, 6.8, 4.6, 1.8, "#c8402a"],
        ["roof", 0.5, 8.4, 8, 1.6, "#3a3040"],
        ["rect", 3, 10, 3, 1.6, "#c8402a"],
        ["roof", 1.6, 11.6, 5.8, 1.6, "#3a3040"],
        ["rect", 4.3, 12.6, 0.4, 1, "#d0a040"],
        ["win", 3.8, 2.4, 1.4, 1.4],
        ["win", 4, 6.2, 1, 1],
      ],
    },
    ambient: { kind: "leaves", density: 1, colors: ["#ffb0c8", "#ff90b0", "#fff0f4"] },
  },

  underwater: {
    name: "underwater",
    sky: sky(["#1a78b8", "#4ab8d8"], ["#1a4a88", "#3a8ab0"], ["#04122a", "#0a2a48"]),
    sun: false, moon: false, stars: 0,
    far: [
      { type: "rays", color: "#c0f0ff", spacing: 9 },
      { type: "ridge", base: 0, amp: 4, scale: 9, jag: 0.5, color: "#1a5a7a" },
    ],
    mid: [
      { type: "props", kind: "kelp", spacing: 5, size: 8, colors: ["#2a8a5a", "#3aa86a"], odds: 0.7 },
      { type: "props", kind: "coral", spacing: 9, size: 4, colors: ["#f07a6a", "#ffb0a0"], odds: 0.7 },
    ],
    ground: { colors: ["#e8d8a0", "#c8b880", "#8a7a58"], texture: "sand", specks: ["#ffffff", "#f0a0b0"] },
    structure: {
      at: 0.08,
      ops: [
        ["rect", 0.5, 4, 10, 4, "#6a5040"],
        ["rect", 0.5, 4, 10, 0.5, "#4a3428"],
        ["roof", 6, 7, 6, 3, "#6a5040"],
        ["rect", 3.2, 9.5, 0.6, 5.5, "#4a3428"],
        ["rect", 1.2, 8.6, 4.2, 2.6, "#d8d0c0"],
        ["win", 2, 2.6, 1.2, 1.2],
        ["win", 5, 2.6, 1.2, 1.2],
        ["win", 8, 2.6, 1.2, 1.2],
      ],
    },
    ambient: { kind: "bubbles", density: 1.2 },
  },

  candyland: {
    name: "candyland",
    sky: sky(["#ffa8d8", "#fff0f8"], ["#8a4aa8", "#ffa0c0"], ["#2a0c38", "#5a2858"]),
    sun: true, moon: true, stars: 1.2,
    far: [{ type: "ridge", base: 0.5, amp: 4, scale: 10, jag: 0, color: "#e880c0", cap: "#ffffff", capAt: 3.6 }],
    mid: [{ type: "props", kind: "lollipop", spacing: 7, size: 6, colors: ["#ff5a8a", "#ffffff"], odds: 0.75 }],
    ground: { colors: ["#ffffff", "#ff9ac8", "#d0609a"], texture: "stripes", specks: ["#ffffff"] },
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0.5, 6, 9, 6, "#b07040"],
        ["roof", -0.5, 10, 11, 4.2, "#ffffff"],
        ["roof", 0.3, 9.2, 9.4, 3.2, "#f070a0"],
        ["rect", 3.8, 3.4, 2.4, 3.4, "#ff5a8a"],
        ["win", 1.4, 4.6, 1.6, 1.6],
        ["win", 7, 4.6, 1.6, 1.6],
        ["disc", 1, 6.4, 0.6, "#40c8f0"],
        ["disc", 5, 6.4, 0.6, "#ffe040"],
        ["disc", 9, 6.4, 0.6, "#70e080"],
      ],
    },
    ambient: { kind: "sparkles", density: 1.2, colors: ["#ffffff", "#ffc0e0", "#c0f0ff"] },
  },

  dungeon: {
    name: "dungeon",
    sky: sky(["#2a2620", "#3a342a"], ["#2a2620", "#3a342a"], ["#1a1814", "#2a2620"]),
    sun: false, moon: false, stars: 0, hour: 12,
    far: [{ type: "skyline", minH: 14, maxH: 15, minW: 3.5, maxW: 4, color: "#3a3428", windows: "", base: 0 }],
    mid: [
      { type: "props", kind: "pillar", spacing: 12, size: 11, colors: ["#5a5244", "#6a6252"] },
      { type: "props", kind: "lamp", spacing: 12, size: 7, colors: ["#ffb040", "#4a4234"], base: 0 },
    ],
    ground: { colors: ["#6a6252", "#4a4438", "#2a2620"], texture: "stone", specks: ["#2a2620"] },
    structure: {
      at: 0.08,
      ops: [
        ["rect", 0, 9, 10, 9, "#4a4438"],
        ["rect", 2.5, 6.5, 5, 6.5, "#14100c"],
        ["dome", 5, 6.5, 2.5, "#14100c"],
        ["rect", 3, 6, 0.4, 6, "#5a5244"],
        ["rect", 4.2, 6, 0.4, 6, "#5a5244"],
        ["rect", 5.4, 6, 0.4, 6, "#5a5244"],
        ["rect", 6.6, 6, 0.4, 6, "#5a5244"],
        ["neon", 0.6, 7.4, 0.8, 1, "#ffa030"],
        ["neon", 8.6, 7.4, 0.8, 1, "#ffa030"],
      ],
    },
    ambient: { kind: "embers", density: 0.5 },
  },

  cloudkingdom: {
    name: "cloudkingdom",
    sky: sky(["#6ab8ff", "#e8f4ff"], ["#6a5aa8", "#ffc0a0"], ["#0c1238", "#3a4078"]),
    sun: true, moon: true, stars: 1.4,
    far: [{ type: "clouds", y: 9, size: 2.4, spacing: 12, color: "#e8f0ff", shade: "#b8c8e8" }, { type: "rays", color: "#fff8e0", spacing: 14 }],
    mid: [{ type: "clouds", y: 13.2, size: 2.6, spacing: 8, color: "#ffffff", shade: "#d0dcf0" }],
    ground: { colors: ["#ffffff", "#e8eef8", "#c8d4e8"], texture: "cloud", specks: ["#ffffff"] },
    structure: {
      at: 0.08,
      ops: [
        ["rect", 0.5, 6, 10, 6, "#f0e8d8"],
        ["rect", 0, 10, 2.6, 10, "#f8f0e0"],
        ["rect", 8.4, 10, 2.6, 10, "#f8f0e0"],
        ["roof", -0.3, 12.6, 3.2, 2.6, "#5a7ad8"],
        ["roof", 8.1, 12.6, 3.2, 2.6, "#5a7ad8"],
        ["rect", 4, 9, 3, 3, "#f8f0e0"],
        ["roof", 3.7, 11.4, 3.6, 2.4, "#5a7ad8"],
        ["rect", 4.4, 3.4, 2.2, 3.4, "#d0a040"],
        ["win", 0.9, 7.6, 0.8, 1.2],
        ["win", 9.3, 7.6, 0.8, 1.2],
        ["win", 5.1, 7.6, 0.8, 1.2],
      ],
    },
    ambient: { kind: "sparkles", density: 0.8 },
  },

  matrix: {
    name: "matrix",
    sky: sky(["#000400", "#001a04"], ["#000400", "#001a04"], ["#000400", "#001a04"]),
    sun: false, moon: false, stars: 0, hour: 0,
    far: [{ type: "props", kind: "code", spacing: 2.2, size: 13, colors: ["#0a5a1a", "#020a02"], odds: 0.55, base: -1 }],
    mid: [{ type: "skyline", minH: 3, maxH: 8, minW: 3, maxW: 6, color: "#021404", windows: "#20e040", neon: true }],
    ground: { colors: ["#20e040", "#021404", "#000800"], texture: "grid", specks: ["#0a6a1a"] },
    structure: {
      at: 0.1,
      ops: [
        ["rect", 0.5, 8, 7, 8, "#041a06"],
        ["neon", 1, 7.4, 6, 4.4, "#062a0a"],
        ["neon", 1.6, 6.6, 3, 0.5, "#40ff60"],
        ["neon", 1.6, 5.4, 4.4, 0.5, "#20c040"],
        ["neon", 1.6, 4.2, 2, 0.5, "#40ff60"],
        ["rect", 3, 2.4, 2, 1.2, "#041a06"],
        ["rect", 1.5, 1.2, 5, 1.2, "#041a06"],
      ],
    },
    ambient: { kind: "rain", density: 0.6, colors: ["#40ff60", "#20c040", "#a0ffb0"] },
  },
};

export const BIOME_NAMES = Object.keys(BIOME_SCENES);

/** Default biome per rarity — the same mapping as the ASCII panel. */
const RARITY_BIOME: Record<string, string> = {
  common: "meadow",
  uncommon: "forest",
  rare: "ocean",
  epic: "cyberpunk",
  legendary: "space",
};

export function biomeScene(rarity: string, override?: string): BiomeScene {
  if (override && BIOME_SCENES[override]) return BIOME_SCENES[override];
  return BIOME_SCENES[RARITY_BIOME[rarity] ?? "meadow"];
}
