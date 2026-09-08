---
name: orca
description: Draft an OOUX object map from whatever notes exist, validate that it round-trips, and open it in the ORCA editor. Use when someone wants to start an object map, model the objects or entities in a product, work out the nouns before the screens, build a shared vocabulary from research notes, or open ORCA. Trigger phrases include "object map", "OOUX", "what are the objects", "model the entities", "nouns before verbs", "seed an object map", or "open ORCA". Drafting is this skill's job; editing is ORCA's.
allowed-tools:
  - Bash(orca *)
  - Bash(node *)
  - Bash(open *)
  - Read
  - Write
  - Glob
  - Grep
---

# ORCA — draft an object map, then hand it over

Setup is this skill's job; editing is ORCA's. **Never edit an existing map — once
the file exists, ORCA owns it.** Double ownership is how a file gets reformatted
behind someone's back.

## The shape of a run

1. **Find the material.** Whatever the project already has: a brief, product
   notes, research session notes, a jobs-to-be-done list, a glossary, support
   tickets, existing schema docs. Read before drafting.
2. **Choose a folder.** ORCA lists every `.md` in the folder it is pointed at, so
   the map gets a folder of its own — `Object Map (ORCA)/` beside the project's
   other notes is a good convention. **Never overwrite an existing map.**
3. **Draft the file** in the shape below.
4. **Validate — mandatory:**
   ```bash
   cd <path-to-orca> && node validate.mjs "<path to the new file>"
   ```
   It must report `OK` with a non-zero object count. If it reports `READ-ONLY`,
   the markdown is malformed — fix it and re-run. **Never open the UI on a file
   that failed validation.**
5. **Launch** with `orca`, then give the absolute folder path to paste into the
   folder picker — a browser picker cannot be driven programmatically.

## The file shape

```markdown
# Object Map — [Product]

[Any prose you like. It is preserved exactly.]

---

## [Object]

**Definition:** [What this thing is, in one sentence, in the business's own words.]

**Also called:** [other names people use for it]

| Type | Name | Cardinality | Example | Note | Sign-off |
| --- | --- | --- | --- | --- | --- |
| core | [an attribute someone would look for] | singular | [a real value] | | |
| meta | [a system or admin attribute] | — | | | |
| nested | [[#OtherObject]] | 0-many | | [what the relationship means] | |
| action · primary | [what a user does to it] | | | | |
```

- `core` is content a user came for; `meta` is bookkeeping.
- `nested` is a relationship, and it must point at an object defined in THIS
  file: `[[#Name]]`. The older `**Name**` cross-file form and bare text still
  parse, but ORCA marks them as loose ends and offers to create the object.
- Cardinality: `singular`, `0-many`, `1-many`, a range, or `—` for not applicable.
- Columns are matched **by name, not position**, so they can be reordered.

## The one rule that matters most

**A row needs a source, not a plausible guess.** Blank cells mean "nobody has
been asked", and that is the honest default — a map padded with invented
attributes is worse than a short one, because the invented rows look exactly
like the sourced ones.

**Sign-off is always blank on a new map.** Nothing arrives pre-agreed; that is
the entire point of the column. Aim for 15–25 objects and stop rather than pad.

**Blank is not the same as `—`.** Blank means unasked. `—` means not applicable.
Never normalise one into the other.
