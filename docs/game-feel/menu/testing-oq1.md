# User Testing — OQ-1: Unified Nav Channel

> Covers Phase OQ-1: `buddy:choices` folded into `buddy:nav`, SHOP MENUS
> directive removed, `buddy_upgrades` interactive browse added.

**Requires a Claude Code restart** to load the new server and directive. Do
that first.

---

## What changed (tester's summary)

- `/buddy shop` browse now shows an interactive picker via `buddy:nav` instead
  of the old `buddy:choices` channel. The word `buddy:choices` should never
  appear in responses.
- `/buddy upgrades` browse now shows an interactive picker when you have
  affordable unlocks. Previously it was text-only.
- `/buddy menu` → Shop & Gear → Visit the shop chains through correctly: the
  shop's picker flows back to `buddy_shop`, not back into `buddy_menu`.
- The MENU NAVIGATION directive now covers all three. There is no SHOP MENUS
  directive.

---

## 1. Menu navigation (smoke test — unchanged behavior)

```
/buddy menu
```

**Expect:** A card with 4 options and an AskUserQuestion picker (Shop & Gear /
Stats & Progress / Appearance & Behavior / Manage & System).

Pick **Stats & Progress**.

**Expect:** A second card and picker with stats/XP/achievements/more options.
Pick **Stats**. Expect the full stats block printed inline (no picker — it's a
tool-leaf).

Pick **Other → back** at any point.

**Expect:** Root menu re-renders (buddy_menu called with no args).

---

## 2. Shop browse — `buddy:nav` replacing `buddy:choices`

```
/buddy shop
```

**Expect (when you have affordable items):**
- The shop card prints above a hidden marker.
- An AskUserQuestion picker appears: "What would you like to buy?" with up to 4
  affordable items.
- The `buddy:choices` text must **not** appear anywhere in the response.

Pick an item from the picker.

**Expect:** `buddy_shop buy=<id>` is called automatically. A purchase
confirmation prints. No second picker.

Pick **Other → decline** (or pick nothing affordable).

**Expect:** No buy call. Conversation continues.

**When nothing is affordable:**

```
/buddy shop
```

**Expect:** The shop card prints with no picker. Text only, no AskUserQuestion.

---

## 3. Upgrades browse — new interactive flow

```
/buddy upgrades
```

**Expect (when you have affordable unlocks and available points):**
- The catalog card prints (owned ✅ / affordable 🟢 / locked 🔒 / too poor 💸).
- An AskUserQuestion picker appears: "Which upgrade would you like to buy?" with
  up to 4 affordable unlocks.

Pick an unlock from the picker.

**Expect:** `buddy_upgrades buy=<id>` is called automatically. A purchase
confirmation prints.

**When nothing is affordable (broke, or all owned/locked):**

```
/buddy upgrades
```

**Expect:** The catalog card prints with no picker. Text only.

---

## 4. Menu → shop chain

```
/buddy menu
```

Pick **Shop & Gear**, then **Visit the shop**.

**Expect:** The shop card prints with the interactive picker (if items are
buyable). The picker should route to `buddy_shop buy=<id>` — **not** to
`buddy_menu`. Buying should confirm the purchase directly.

---

## 5. Marker hygiene check

In any of the above flows, verify:
- `<!-- buddy:choices ... -->` never appears in any response.
- `<!-- buddy:nav ... -->` never appears in any response (the directive hides it).
- `buddy:choices` is not mentioned in any tool description or directive text.

If you see either marker printed verbatim, the directive hasn't loaded yet —
restart Claude Code and retry.

---

## 6. Edge cases

| Scenario | Expected |
|---|---|
| `/buddy shop` with 0 points | Card only, no picker |
| `/buddy upgrades` with 0 points | Card only, no picker |
| `/buddy upgrades` all items owned | Card only, no picker |
| Shop picker: pick **Other**, type `back` | `buddy_menu` called (no args), root menu re-renders |
| Shop picker: pick **Other**, type `/buddy stats` | Stats tool runs directly |
| Upgrades picker: more than 4 affordable unlocks | Picker shows exactly 4; the rest are still listed in the card above and buyable via `buddy_upgrades buy=<id>` |

---

## 7. Regression checks

These should be unchanged:

| Command | Expected |
|---|---|
| `/buddy shop buy=foam_sword` | Direct buy, no picker |
| `/buddy upgrades buy=<id>` | Direct buy, no picker |
| `/buddy upgrades refund=<id>` | Direct refund, no picker |
| `/buddy upgrades ascend=true` | Ascension flow, no picker |
| `/buddy menu` → Manage & System → More → Uninstall | `kind:"sequence"` — assistant asks for confirm, not auto-executed |
