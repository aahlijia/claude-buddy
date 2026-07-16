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
  | {
      /**
       * A fixed-set setter: picking the option opens a second picker of
       * `options`, then calls `tool` with `{ [arg]: chosen.value }`. The chosen
       * value rides the nav channel's *validated* assistant tool-call path (not
       * `runTool`), so `value` may be a real boolean/string the tool's Zod schema
       * already accepts — no coercion needed.
       */
      kind: "choice";
      tool: string;
      arg: string;
      question: string;
      /** Short chip (≤12 chars) for the second picker; derived from `question` when absent. */
      header?: string;
      options: ChoiceValue[];
    }
  | { kind: "shell"; command: string }
  | { kind: "sequence"; sequence: "uninstall" };

/** One value in a `kind:"choice"` setter. `value` is passed to the tool as-is. */
export interface ChoiceValue {
  label: string;
  description: string;
  /** The exact arg value (string or boolean) the target tool's schema expects. */
  value: string | boolean;
}

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
        action: {
          kind: "choice",
          tool: "buddy_theme",
          arg: "theme",
          question: "Set the color theme",
          header: "Theme",
          options: [
            { label: "Dark", value: "dark", description: "Bright colors for dark terminals" },
            { label: "Light", value: "light", description: "Dark colors for light terminals" },
            { label: "Auto", value: "auto", description: "Follow the system" },
          ],
        },
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
        action: {
          kind: "choice",
          tool: "buddy_style",
          arg: "style",
          question: "Bubble frame style",
          header: "Style",
          options: [
            { label: "Classic", value: "classic", description: "Pipes and dashes" },
            { label: "Round", value: "round", description: "Parens and tildes" },
          ],
        },
      },
      {
        id: "position",
        label: "📍 Position (top/left)",
        description: "Where the buddy sits in the status line",
        action: {
          kind: "choice",
          tool: "buddy_style",
          arg: "position",
          question: "Bubble position",
          header: "Position",
          options: [
            { label: "Top", value: "top", description: "Above the buddy" },
            { label: "Left", value: "left", description: "Beside the buddy" },
          ],
        },
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
        action: {
          kind: "choice",
          tool: "buddy_style",
          arg: "showRarity",
          question: "Show the rarity badge?",
          header: "Rarity",
          options: [
            { label: "Show", value: true, description: "Show stars + rarity line" },
            { label: "Hide", value: false, description: "Hide the rarity line" },
          ],
        },
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
        action: {
          kind: "choice",
          tool: "buddy_gamefeel",
          arg: "level",
          question: "Game-feel intensity",
          header: "Game-feel",
          options: [
            { label: "Off", value: "off", description: "Silent — classic status line" },
            { label: "Subtle", value: "subtle", description: "Brief toasts only" },
            { label: "Full", value: "full", description: "Toasts + animation + surprises" },
          ],
        },
      },
      {
        id: "wander",
        label: "🚶 Wander on/off",
        description: "Toggle idle wandering",
        action: {
          kind: "choice",
          tool: "buddy_wander",
          arg: "enabled",
          question: "Idle wander",
          header: "Wander",
          options: [
            { label: "On", value: true, description: "Buddy ambles when idle" },
            { label: "Off", value: false, description: "Buddy stays put" },
          ],
        },
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
        action: {
          kind: "choice",
          tool: "buddy_statusline",
          arg: "enabled",
          question: "Buddy status line",
          header: "Status line",
          options: [
            { label: "On", value: true, description: "Show the buddy in the status line" },
            { label: "Off", value: false, description: "Hide it" },
          ],
        },
      },
      {
        id: "panel",
        label: "📊 Stat-bar panel",
        description: "Toggle the live stat-bar panel",
        action: {
          kind: "choice",
          tool: "buddy_stats_panel",
          arg: "enabled",
          question: "Stat-bar panel",
          header: "Stat panel",
          options: [
            { label: "On", value: true, description: "Show the stat bars" },
            { label: "Off", value: false, description: "Hide them" },
          ],
        },
      },
      {
        id: "badge",
        label: "🏅 Prestige badge",
        description: "Toggle the prestige/streak badge",
        action: {
          kind: "choice",
          tool: "buddy_prestige_badge",
          arg: "enabled",
          question: "Prestige/streak badge",
          header: "Badge",
          options: [
            { label: "On", value: true, description: "Show the prestige/streak badge" },
            { label: "Off", value: false, description: "Hide it" },
          ],
        },
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

/** Option in a nav-ask picker; `value` is the pick arg, defaults to `label` when absent. */
export interface NavOption {
  label: string;
  description: string;
  /**
   * The pick_arg value to pass on selection. Defaults to `label` when absent.
   * May be a boolean for `kind:"choice"` setters whose tool takes a boolean arg
   * (e.g. `enabled`/`showRarity`) — JSON-encoded in the marker and passed through
   * the validated tool-call path, so `z.boolean()` schemas accept it directly.
   */
  value?: string | boolean;
}

/** What to call when the user makes a pick — always present on a NavAsk. */
export interface NavContinuation {
  tool: string;
  args?: Record<string, unknown>;
  pick_arg: string;
}

/**
 * A pre-shaped AskUserQuestion item + its continuation. The assistant copies
 * question/header/multiSelect/options into AskUserQuestion verbatim, then
 * executes `then` on pick: call `then.tool({ ...then.args, [then.pick_arg]:
 * option.value ?? option.label })`.
 */
export interface NavAsk {
  /** = page.title or a custom question string. */
  question: string;
  /** Short chip, ≤12 chars (AskUserQuestion bound). */
  header: string;
  /** Pickers are always single-select. */
  multiSelect: false;
  options: NavOption[];
  /** Always present — the model executes this, not a separate directive. */
  then: NavContinuation;
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

/** A buddy_menu (or routed tool) response, split into a visible half and a machine half. */
export interface MenuEnvelope {
  /** Printed verbatim: the page card, or a routed action's short notice. */
  display: string;
  /**
   * Present when the next step is a picker. Copy question/header/multiSelect/options
   * verbatim into AskUserQuestion; on pick, execute `then`. Mutually exclusive with `do`.
   */
  ask?: NavAsk;
  /** Present when the next step needs the assistant. Mutually exclusive with `ask`. */
  do?: MenuDirective;
}

/** What selecting an option resolves to (before envelope assembly). */
export type SelectResolution =
  | { kind: "page"; page: MenuPage }
  | { kind: "tool"; tool: string; args?: Record<string, unknown> }
  | { kind: "ask"; ask: NavAsk }
  | { kind: "directive"; do: MenuDirective }
  | { kind: "miss" };

/** Trim a heading to a ≤12-char AskUserQuestion chip (first clause, capped). */
function chip(text: string): string {
  const base = (text.split(/[—:]/)[0] || text).trim();
  return base.length <= 12 ? base : base.slice(0, 12).trim();
}

/** Short header chip for a page; derive from the title when not set explicitly. */
function headerFor(page: MenuPage): string {
  return page.header ?? chip(page.title);
}

/** Build the second-picker NavAsk for a `kind:"choice"` setter. */
function choiceAsk(action: Extract<MenuAction, { kind: "choice" }>): NavAsk {
  return {
    question: action.question,
    header: action.header ?? chip(action.question),
    multiSelect: false,
    options: action.options.map((o) => ({
      label: o.label,
      description: o.description,
      value: o.value,
    })),
    then: { tool: action.tool, args: {}, pick_arg: action.arg },
  };
}

/** Build the harness-ready NavAsk for a menu page. */
export function askFor(page: MenuPage): NavAsk {
  return {
    question: page.title,
    header: headerFor(page),
    multiSelect: false,
    options: page.options.map((o) => ({
      label: o.label,
      description: o.description,
    })),
    then: { tool: "buddy_menu", args: { page: page.id }, pick_arg: "select" },
  };
}

/**
 * Hidden marker carrying the machine half of an envelope. The payload is
 * pre-shaped so the assistant copies `ask`/`do` without reshaping. The
 * continuation tool and args live inside `ask.then` — no top-level `page`.
 */
export function navMarker(env: MenuEnvelope): string {
  const payload: { ask?: NavAsk; do?: MenuDirective } = {};
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
    case "choice":
      return { kind: "ask", ask: choiceAsk(action) };
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
 *   select → choice     → `MenuEnvelope` with the setter's `ask`
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
    if (r.kind === "ask") {
      return { display: `_${r.ask.question}_`, ask: r.ask };
    }
    if (r.kind === "directive") {
      return { display: directiveCard(r.do), do: r.do };
    }
    if (r.kind === "page") {
      node = r.page;
    }
    // miss → fall through, re-render same page
  }

  return { display: renderMenuCard(node, name), ask: askFor(node) };
}
