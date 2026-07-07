# Features:

##
- stats can level up

## UX
- Dynamically size the chat bubble when the window size is too small for the default chat bubble.

## Idle RPG
- Bug should spawn as another buddy of a different kind in the second column of the status line
- Fighting animations for the buddy and the enemy. Maybe just a single sword swing in eachothers direction
- Hat wardrobe: pick which owned hat is worn instead of purchase-order default (design-derive-upgrades.md §9)


## Menus
- design-mechanize - oq1: Fold the shop into buddy:nav


## Docs
- update readme
- organize docs/


## DONE:
- Remove the 3 column statusline structure
  - Buddy can move to the left, stopping at the stats
  - Buddy always stays within the window if the window size can fit the buddy and the stats (currently gets cut off because of the column constraints)
- stop chat bubble when fighting
the baked combat flipbook (enc.frames/enc.sequence) is computed but never rendered; Phase 4
  only uses the glyph + angry face. That's the lever for this feature. Let me check how the ART column width
  is derived, to know whether a wider two-sprite scene can fit.
- Derive-on-read for upgrades: bought hat/stat/shiny/flag effects no longer mutate
  bones, matching equipment (design-derive-upgrades.md, all 4 phases)
