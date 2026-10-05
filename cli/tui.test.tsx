import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { generateBones, type Species } from "../server/engine.ts";
import { detectTier } from "../server/gfx/detect.ts";
import { BuddyCardPane } from "./tui.tsx";

// The dashboard follows the terminal: plain terminals (NO_COLOR, dumb) keep ASCII.
const pixels = detectTier(process.env).tier !== "ascii";

const card = (species: Species) =>
  renderToString(
    <BuddyCardPane companion={{ bones: { ...generateBones("x"), species, rarity: "epic", shiny: false }, name: "Pip", personality: "Curious." } as never} slot="pip" isActive />,
    { columns: 60 },
  );

describe("dashboard buddy card", () => {
  test("HD species show a portrait (ASCII on plain terminals)", () => {
    if (pixels) expect(card("dragon")).toContain("▀");
    else expect(card("dragon")).not.toContain("▀");
  });

  test("every species gets a portrait (H6)", () => {
    if (pixels) expect(card("duck")).toContain("▀");
    else expect(card("duck")).not.toContain("▀");
    expect(card("duck")).toContain("Pip");
  });
});
