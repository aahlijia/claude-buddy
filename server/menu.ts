/**
 * Interactive command browser for claude-buddy (`/buddy menu`).
 *
 * Pure: holds the static menu tree and assembles one envelope at a time — a
 * visible `display` card plus a machine-readable `buddy:nav` marker carrying a
 * pre-shaped AskUserQuestion (`ask`) or a single hand-off (`do`). The assistant
 * prints the card, copies `ask` verbatim, or performs `do` (see the MENU
 * NAVIGATION directive in index.ts). `resolveSelect` collapses page-drills and
 * tool-leaves server-side so the assistant copies and echoes rather than
 * reshaping and branching. See docs/game-feel/menu/design-mechanize.md.
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
  /**
   * Short chip (≤12 chars) for the AskUserQuestion `header`. Optional: when
   * absent, `askFor` derives one from `title`. Set explicitly where the derived
   * chip would read poorly.
   */
  header?: string;
  /** INVARIANT: length 2..4 (AskUserQuestion bounds). */
  options: MenuOption[];
}

/** The whole tree, keyed by page id — the single source of truth. */
export const MENU: Record<string, MenuPage> = {
  root: {
    id: "root",
    title: "What would you like to do?",
    header: "Menu",
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
    header: "Shop & Gear",
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
    header: "Progress",
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
    header: "Progress",
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
    header: "Appearance",
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
    header: "Style",
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
    header: "Motion",
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
    header: "Status line",
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
    header: "System",
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
    header: "Identity",
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
    header: "Roster",
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
    header: "Mute",
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
    header: "System",
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
 * One item of AskUserQuestion's `questions[]`, emitted 1:1 so the assistant
 * copies it verbatim instead of reshaping the menu's internal shape.
 */
export interface AskQuestion {
  /** = page.title */
  question: string;
  /** Short chip, ≤12 chars (AskUserQuestion bound). */
  header: string;
  /** Menus are always single-select. */
  multiSelect: false;
  options: { label: string; description: string }[];
}

/**
 * The one instruction the assistant still performs when a pick can't resolve
 * server-side. Tool-leaves run in-process (Phase B); only these remain
 * irreducibly assistant-side: `prompt` (free text), `shell` (user-run),
 * `sequence` (a SKILL.md orchestration).
 */
export type MenuDirective =
  | { kind: "prompt"; tool: string; arg: string; ask: string }
  | { kind: "shell"; command: string }
  | { kind: "sequence"; sequence: "uninstall" };

/** A buddy_menu response, split into a visible half and a machine half. */
export interface MenuEnvelope {
  /** Printed verbatim: the page card, or a routed action's short notice. */
  display: string;
  /** Present when the next step is a picker. Copy straight into AskUserQuestion. */
  ask?: AskQuestion;
  /** Present when the next step needs the assistant. Mutually exclusive with `ask`. */
  do?: MenuDirective;
  /** The page these options belong to — echoed back as `page` on the next select. */
  page: string;
}

/** What selecting an option resolves to (before envelope assembly). */
export type SelectResolution =
  | { kind: "page"; page: MenuPage }
  | { kind: "tool"; tool: string; args?: Record<string, unknown> }
  | { kind: "directive"; do: MenuDirective }
  | { kind: "miss" };

/** Short header chip for a page; derive from the title when not set explicitly. */
function headerFor(page: MenuPage): string {
  if (page.header) return page.header;
  const base = (page.title.split(/[—:]/)[0] || page.title).trim();
  return base.length <= 12 ? base : base.slice(0, 12).trim();
}

/** Build the harness-ready question for a page (improvement #2). */
export function askFor(page: MenuPage): AskQuestion {
  return {
    question: page.title,
    header: headerFor(page),
    multiSelect: false,
    options: page.options.map((o) => ({
      label: o.label,
      description: o.description,
    })),
  };
}

/**
 * Hidden marker carrying only the machine half of an envelope (improvement #3).
 * Replaces the old `buddy:menu` marker; the payload is pre-shaped so the
 * assistant copies `ask`/`do` without reshaping.
 */
export function navMarker(env: MenuEnvelope): string {
  const payload: {
    page: string;
    ask?: AskQuestion;
    do?: MenuDirective;
  } = { page: env.page };
  if (env.ask) payload.ask = env.ask;
  if (env.do) payload.do = env.do;
  return `<!-- buddy:nav ${JSON.stringify(payload)} -->`;
}

/**
 * Resolve a selection on a page to its next step (improvement #1). `select`
 * matches an option by `id` first, then by `label` (AskUserQuestion hands back
 * the label). An unmatched select is a `miss` — the caller re-renders the page.
 */
export function resolveSelect(
  page: MenuPage,
  select: string,
): SelectResolution {
  const key = select.trim();
  const opt =
    page.options.find((o) => o.id === key) ??
    page.options.find((o) => o.label === key);
  if (!opt) return { kind: "miss" };
  const action = opt.action;
  switch (action.kind) {
    case "page": {
      const next = MENU[action.page];
      return next ? { kind: "page", page: next } : { kind: "miss" };
    }
    case "tool":
      return { kind: "tool", tool: action.tool, args: action.args };
    case "prompt":
      return {
        kind: "directive",
        do: {
          kind: "prompt",
          tool: action.tool,
          arg: action.arg,
          ask: action.ask,
        },
      };
    case "shell":
      return {
        kind: "directive",
        do: { kind: "shell", command: action.command },
      };
    case "sequence":
      return {
        kind: "directive",
        do: { kind: "sequence", sequence: action.sequence },
      };
  }
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

/** Short visible notice for a `do` hand-off (the `display` half). */
function directiveCard(d: MenuDirective): string {
  switch (d.kind) {
    case "prompt":
      return `_${d.ask}_`;
    case "shell":
      return `Run this in your terminal: \`! ${d.command}\``;
    case "sequence":
      return `Running the **${d.sequence}** sequence…`;
  }
}

/** Returned by `advance` when the resolved action is a tool-leaf. */
export type RouteResult = { route: { tool: string; args?: Record<string, unknown> } };

/**
 * Pure decision function for the buddy_menu handler. Given a page id, an
 * optional selection, and the companion's name, returns either a
 * `MenuEnvelope` (print and follow) or a `RouteResult` (caller runs the tool
 * in-process via `runTool`).
 *
 * Branch map:
 *   no select           → render `page` with `ask`
 *   select → tool       → `RouteResult`
 *   select → directive  → `MenuEnvelope` with `do`
 *   select → page       → render next page with `ask`
 *   select → miss       → re-render same page with `ask`
 */
export function advance(
  page: string | undefined,
  select: string | undefined,
  name: string,
): MenuEnvelope | RouteResult {
  let node = getMenuPage(page);

  if (select) {
    const r = resolveSelect(node, select);
    if (r.kind === "tool") {
      return { route: { tool: r.tool, args: r.args } };
    }
    if (r.kind === "directive") {
      return { display: directiveCard(r.do), do: r.do, page: node.id };
    }
    if (r.kind === "page") {
      node = r.page;
    }
    // miss → fall through, re-render same page
  }

  return { display: renderMenuCard(node, name), ask: askFor(node), page: node.id };
}
