/**
 * Interactive command browser for claude-buddy (`/buddy menu`).
 *
 * Pure: holds the static menu tree and renders one page at a time — a card for
 * the visible header plus a machine-readable `buddy:menu` marker. The assistant
 * turns that marker into an AskUserQuestion and dispatches the pick (see the
 * MENU NAVIGATION directive in index.ts). Mirrors shop.ts's marker pattern one
 * level up: categories instead of items, and a pick can target any buddy tool,
 * a free-text prompt, a shell hint, an orchestration, or another page.
 *
 * AskUserQuestion caps options at 4, so every page holds 2..4 options; deeper
 * surfaces are reached via `kind:"page"` drill-downs. See
 * docs/game-feel/menu/design.md for the full spec.
 */

/** What selecting an option does. Discriminated by `kind`. */
export type MenuAction =
  | { kind: "page"; page: string }
  | { kind: "tool"; tool: string; args?: Record<string, unknown> }
  | { kind: "prompt"; tool: string; arg: string; ask: string }
  | { kind: "shell"; command: string }
  | { kind: "sequence"; sequence: "uninstall" };

export interface MenuOption {
  /** Stable, kebab-case; unique within its page. */
  id: string;
  /** Shown in the picker (may carry an emoji). */
  label: string;
  /** The AskUserQuestion option description line. */
  description: string;
  action: MenuAction;
}

export interface MenuPage {
  /** "root", "gear", … — unique across the tree. */
  id: string;
  /** Becomes the AskUserQuestion question text. */
  title: string;
  /** INVARIANT: length 2..4 (AskUserQuestion bounds). */
  options: MenuOption[];
}

/** The whole tree, keyed by page id — the single source of truth. */
export const MENU: Record<string, MenuPage> = {
  root: {
    id: "root",
    title: "What would you like to do?",
    options: [
      {
        id: "gear",
        label: "🛒 Shop & Gear",
        description: "Buy items, equip gear, spend skill points",
        action: { kind: "page", page: "gear" },
      },
      {
        id: "progress",
        label: "📊 Stats & Progress",
        description: "Stats, XP, achievements, mood, memory",
        action: { kind: "page", page: "progress" },
      },
      {
        id: "appearance",
        label: "🎨 Appearance & Behavior",
        description: "Theme, style, motion, status-line bits",
        action: { kind: "page", page: "appearance" },
      },
      {
        id: "system",
        label: "⚙️ Manage & System",
        description: "Identity, saves, mute, help, uninstall",
        action: { kind: "page", page: "system" },
      },
    ],
  },

  gear: {
    id: "gear",
    title: "Shop & gear — what next?",
    options: [
      {
        id: "shop",
        label: "🛒 Visit the shop",
        description: "Browse the merchant and buy equipment",
        action: { kind: "tool", tool: "buddy_shop" },
      },
      {
        id: "equip",
        label: "🎽 Equip / loadout",
        description: "Manage equipped gear and inventory",
        action: { kind: "tool", tool: "buddy_equip" },
      },
      {
        id: "upgrades",
        label: "⬆️ Upgrades & titles",
        description: "Spend points on upgrades, set a title, ascend",
        action: { kind: "tool", tool: "buddy_upgrades" },
      },
    ],
  },

  progress: {
    id: "progress",
    title: "Stats & progress",
    options: [
      {
        id: "stats",
        label: "📊 Stats",
        description: "Current stat block and leveling",
        action: { kind: "tool", tool: "buddy_stats" },
      },
      {
        id: "xp",
        label: "✨ XP & level",
        description: "XP bar, level, and point balance",
        action: { kind: "tool", tool: "buddy_xp" },
      },
      {
        id: "achievements",
        label: "🏆 Achievements",
        description: "Unlocked and locked achievements",
        action: { kind: "tool", tool: "buddy_achievements" },
      },
      {
        id: "more",
        label: "⋯ More",
        description: "Mood, brag card, memory",
        action: { kind: "page", page: "progress2" },
      },
    ],
  },

  progress2: {
    id: "progress2",
    title: "More progress",
    options: [
      {
        id: "mood",
        label: "🎭 Mood",
        description: "Current mood and what shifts it",
        action: { kind: "tool", tool: "buddy_mood" },
      },
      {
        id: "brag",
        label: "📣 Brag card",
        description: "Paste-able markdown brag card",
        action: { kind: "tool", tool: "buddy_brag" },
      },
      {
        id: "memory",
        label: "🧠 Memory",
        description: "Remembered projects, bugs, preferences",
        action: { kind: "tool", tool: "buddy_memory" },
      },
    ],
  },

  appearance: {
    id: "appearance",
    title: "Appearance & behavior",
    options: [
      {
        id: "theme",
        label: "🎨 Theme",
        description: "Dark, light, or auto",
        action: { kind: "tool", tool: "buddy_theme" },
      },
      {
        id: "style",
        label: "🧩 Style & position",
        description: "Frame style, position, rainbow, rarity",
        action: { kind: "page", page: "style" },
      },
      {
        id: "motion",
        label: "✨ Motion & game-feel",
        description: "Game-feel intensity and idle wander",
        action: { kind: "page", page: "motion" },
      },
      {
        id: "statusbits",
        label: "📊 Status-line bits",
        description: "Status-line, stat panel, badge, frequency",
        action: { kind: "page", page: "statusbits" },
      },
    ],
  },

  style: {
    id: "style",
    title: "Style & position",
    options: [
      {
        id: "frame",
        label: "🔲 Style (classic/round)",
        description: "Switch the frame style",
        action: { kind: "tool", tool: "buddy_style" },
      },
      {
        id: "position",
        label: "📍 Position (top/left)",
        description: "Where the buddy sits in the status line",
        action: { kind: "tool", tool: "buddy_style" },
      },
      {
        id: "rainbow",
        label: "🌈 Rainbow colors",
        description: "Set or reset the shiny gradient",
        action: { kind: "tool", tool: "buddy_style" },
      },
      {
        id: "rarity",
        label: "💎 Rarity badge",
        description: "Toggle the rarity badge",
        action: { kind: "tool", tool: "buddy_style" },
      },
    ],
  },

  motion: {
    id: "motion",
    title: "Motion & game-feel",
    options: [
      {
        id: "gamefeel",
        label: "🎚️ Game-feel intensity",
        description: "Off, subtle, or full",
        action: { kind: "tool", tool: "buddy_gamefeel" },
      },
      {
        id: "wander",
        label: "🚶 Wander on/off",
        description: "Toggle idle wandering",
        action: { kind: "tool", tool: "buddy_wander" },
      },
      {
        id: "wander-modes",
        label: "🤸 Wander modes",
        description: "Hop, wide roam, bubble-follow",
        action: { kind: "tool", tool: "buddy_wander" },
      },
    ],
  },

  statusbits: {
    id: "statusbits",
    title: "Status-line bits",
    options: [
      {
        id: "statusline",
        label: "📺 Status-line on/off",
        description: "Show the buddy in the status line",
        action: { kind: "tool", tool: "buddy_statusline" },
      },
      {
        id: "panel",
        label: "📊 Stat-bar panel",
        description: "Toggle the live stat-bar panel",
        action: { kind: "tool", tool: "buddy_stats_panel" },
      },
      {
        id: "badge",
        label: "🏅 Prestige badge",
        description: "Toggle the prestige/streak badge",
        action: { kind: "tool", tool: "buddy_prestige_badge" },
      },
      {
        id: "frequency",
        label: "⏱️ Frequency",
        description: "Set the reaction cooldown in seconds",
        action: {
          kind: "prompt",
          tool: "buddy_frequency",
          arg: "cooldown",
          ask: "Cooldown in seconds?",
        },
      },
    ],
  },

  system: {
    id: "system",
    title: "Manage & system",
    options: [
      {
        id: "identity",
        label: "🪪 Identity",
        description: "Rename or set personality",
        action: { kind: "page", page: "identity" },
      },
      {
        id: "roster",
        label: "💾 Saves & roster",
        description: "Save, list, summon, dismiss buddies",
        action: { kind: "page", page: "roster" },
      },
      {
        id: "mute",
        label: "🔇 Mute / unmute",
        description: "Silence or re-enable the buddy",
        action: { kind: "page", page: "mute" },
      },
      {
        id: "more",
        label: "⋯ More",
        description: "Help, pick (terminal TUI), uninstall",
        action: { kind: "page", page: "system2" },
      },
    ],
  },

  identity: {
    id: "identity",
    title: "Identity",
    options: [
      {
        id: "rename",
        label: "✏️ Rename",
        description: "Give the buddy a new name",
        action: {
          kind: "prompt",
          tool: "buddy_rename",
          arg: "name",
          ask: "New name?",
        },
      },
      {
        id: "personality",
        label: "🎭 Personality",
        description: "Rewrite the buddy's personality",
        action: {
          kind: "prompt",
          tool: "buddy_set_personality",
          arg: "personality",
          ask: "Describe the personality:",
        },
      },
    ],
  },

  roster: {
    id: "roster",
    title: "Saves & roster",
    options: [
      {
        id: "save",
        label: "💾 Save current",
        description: "Save the active buddy to a slot",
        action: { kind: "tool", tool: "buddy_save" },
      },
      {
        id: "list",
        label: "📜 List saved",
        description: "Show the saved roster",
        action: { kind: "tool", tool: "buddy_list" },
      },
      {
        id: "summon",
        label: "🔮 Summon",
        description: "Bring back a saved buddy",
        action: { kind: "tool", tool: "buddy_summon" },
      },
      {
        id: "dismiss",
        label: "🗑️ Dismiss",
        description: "Remove a buddy from a slot",
        action: { kind: "tool", tool: "buddy_dismiss" },
      },
    ],
  },

  mute: {
    id: "mute",
    title: "Mute / unmute",
    options: [
      {
        id: "mute",
        label: "🔇 Mute",
        description: "Silence the buddy",
        action: { kind: "tool", tool: "buddy_mute" },
      },
      {
        id: "unmute",
        label: "🔊 Unmute",
        description: "Re-enable the buddy",
        action: { kind: "tool", tool: "buddy_unmute" },
      },
    ],
  },

  system2: {
    id: "system2",
    title: "More system",
    options: [
      {
        id: "help",
        label: "❓ Help",
        description: "List every buddy command",
        action: { kind: "tool", tool: "buddy_help" },
      },
      {
        id: "pick",
        label: "🕹️ Pick (terminal TUI)",
        description: "Launch the interactive picker in your terminal",
        action: { kind: "shell", command: "bun run pick" },
      },
      {
        id: "uninstall",
        label: "🧨 Uninstall",
        description: "Remove the plugin (keeps your buddy data)",
        action: { kind: "sequence", sequence: "uninstall" },
      },
    ],
  },
};

/** Fetch a page by id; unknown/empty falls back to root. */
export function getMenuPage(id?: string): MenuPage {
  return (id && MENU[id]) || MENU.root;
}

/**
 * The hidden, machine-readable marker the assistant turns into an
 * AskUserQuestion (design menu §6). Mirrors shop.ts's `choicesMarker`.
 */
export function menuMarker(page: MenuPage): string {
  const payload = {
    page: page.id,
    title: page.title,
    options: page.options,
  };
  return `<!-- buddy:menu ${JSON.stringify(payload)} -->`;
}

/** Markdown card — the visible header shown above the interactive picker. */
export function renderMenuCard(page: MenuPage, name: string): string {
  const lines: string[] = [];
  lines.push(`### 🧭 ${name}'s menu — ${page.title}`);
  lines.push("");
  for (const opt of page.options) {
    lines.push(`- ${opt.label} — ${opt.description}`);
  }
  lines.push("");
  lines.push("_Pick an option, or type any command (or `back`) under Other._");
  return lines.join("\n");
}
