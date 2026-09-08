# ORCA

An OOUX object-mapping tool. Objects, their attributes and actions, and the
relationships between them — with a **sign-off** on every row, so it is obvious
what design and engineering have actually agreed on and what is still moving.

It is mostly an ERD. The two things it adds are the reason it exists:

- **Sign-off.** Any row can be signed off once design and engineering agree on
  it. A signed row locks — changing it means deliberately unlocking it first, so
  agreed structure does not drift by accident. "How much of this have we signed
  off on?" is the headline number.
- **CTAs and prioritized anatomy.** What a user can do to an object, and what
  matters most on a screen — design concepts, not storage concepts.

Markdown files are the source of truth. The app is a better way to read and edit
them, not a replacement for them.

## Running it

```bash
./serve.sh
```

Opens `http://localhost:8042` in Chrome. Click **Open folder** and pick a folder
of markdown object maps. The grant is remembered between sessions.

**Requires a Chromium browser** — Chrome, Edge, Arc or Brave. Safari and Firefox
have no File System Access API and will show a notice instead.

**Do not open `index.html` by double-clicking.** `file://` is an opaque origin
where the folder picker does not exist. It has to be served over http.

The port is pinned to 8042 on purpose: folder permissions are keyed to the
origin including the port, so a stable port is what makes the grant stick.

## Starting a new project

1. `./serve.sh`
2. **Open folder** — pick wherever the project's notes live. Any folder works;
   it does not have to contain anything yet.
3. **+** next to *Files* in the left rail. Name the map (e.g. `Object Map`).

That writes a starter file into the folder with one object in it. Rename that
object by clicking its title, write a definition, then **+ row** under Core
content, Relationships or wherever it belongs. Add more objects with **+** next
to *Objects*.

## How a card reads

Name and definition first — what is this thing — then three groups, each with a
colour of its own:

- **Attributes** — *Core content*, then *Metadata*
- **Relationships** — the nested objects
- **Calls to action**

Notes and *Referenced by* are asides, set smaller on purpose.

Each section shows only the columns it has a question for. A call to action has
no cardinality and no example, so those columns are not there. Values already in
an older file stay visible either way.

Relationships connect themselves. A nested row is a set of **chips**, not text:
`+` adds one, and the box that opens completes against the objects already in
the file. Name something that does not exist yet and the app offers to create
it — a relationship can only point at an object that is really there, so there
is no way to bank a chip that leads nowhere. Once Territory exists, its card
gains a **Referenced by** entry pointing back.

**Every object lives in the file that references it.** There is no such thing as
a relationship to an object somewhere else — the app cannot make one, and a
name with no object behind it is a loose end, not a category. Older files
written with the `**Name**` cross-file syntax still open and still round-trip;
the chip shows amber and says *no object*, and one click creates the object and
relinks every row that names it.

## The file format

A file is a series of objects. An object is a heading whose body contains a
`**Definition:**` line, an anatomy table, or both:

```markdown
## Book

**Definition:** A published work the library holds one or more copies of.

**Also called:** title, work

| Type | Name | Cardinality | Note | Sign-off |
|---|---|---|---|---|
| core | Title | | | signed 2026-08-19 |
| meta | Previously known title | — | Pattern shared with author | |
| nested | [[#Author]] | 0-many | **Q1** — can a book have several | |
| action · primary | Add | | | |

*Open:* who performs each action.
*Serves:* Find a book without knowing which branch holds it.
```

- **Type** — `core` · `meta` · `nested` · `action · primary` ·
  `action · secondary`, or blank for an annotation row.
- **Cardinality** — `singular` · `0-many` · `1-many` · `range` · `—` (cannot
  apply), optionally with a qualifier (`0-many, point in time`) or a `?`. **Every
  row offers the same menu.** A qualifier is not a different kind of cardinality,
  so it does not get its own option: the kind is selected in the menu, the
  qualifier is shown as a chip beneath the row, and changing one keeps the other.
  Only genuinely unreadable free text is kept verbatim as a `(kept)` entry,
  because a cardinality nobody can pin down is a finding.
- **Note** — free text. `Q7`, ISO dates and `[[links]]` in it are indexed.
- **Sign-off** — blank means open; `signed YYYY-MM-DD` means locked. New files
  include the column. Adding it to an existing file rewrites that one table once;
  every edit after that is a one-line diff again.
- **Evidence** — `Confirmed` / `Described` / `Modelled` / `Derived`, an optional
  older column. Still parsed and preserved byte-for-byte if a file has one, but
  not shown on the card, since sign-off replaced what it was for.

**Columns are matched by name, not position.** Type, Name, Cardinality and Note
are required; Evidence, Sign-off and Who are optional and may appear in any
order. Reordering or dropping an optional column will not break a file.

Relationships are **directed rows owned by one object**, not bidirectional
entities. That is deliberate: the two sides of one relationship routinely carry
different cardinalities and different evidence, and one side is often missing
entirely. "Book claims 0-many Authors; nobody has ever asked Author" is
information, and a bidirectional model would force you to invent the unstated
half. Edges are derived, never stored.

## Why your prose is safe

Every row, heading, definition and note stores its **original source text** plus
a dirty flag. Untouched content is emitted verbatim and never re-rendered from
parsed fields, so the app physically cannot reformat anything you did not edit —
column spacing, `**Q1**` refs, wikilinks, italic quotes and blank cells all
survive. Editing one cell produces a one-line diff.

On top of that, opening a file runs a **round-trip assertion**: the app
re-serializes what it just parsed and byte-compares it against the file. If they
differ, the file opens **read-only** with a banner naming the first line it could
not reproduce. The app only ever writes files it has already proven it can
reproduce exactly.

Saving is explicit (`⌘S`). Before writing, the file is re-read from disk and
compared — if something else changed it (Obsidian, most likely), the write is
blocked and you choose. The previous ten versions of each file are kept in
IndexedDB.

## Blank means blank

One convention, everywhere: **an empty cell renders empty.** Nothing is drawn
into it to stand in for the absence, because a placeholder mark and a real value
look the same at a glance and the whole point of a map like this is being able
to see, at a glance, what nobody has answered yet.

The one em-dash in the app is a value you chose: `n/a — cannot apply` in the
Cardinality column, which is a different statement from a Cardinality left as
`not asked`. Hover a row and every editable field draws its own box, so you can
see where the fields are without needing something printed inside them.

## Tests

```bash
node test.mjs
```

Round-trips a torture fixture byte-for-byte, checks idempotency, asserts a
one-cell edit produces a one-line diff, exercises every mutation, and covers the
field parsers. The parser is the gate on everything else — if this does not pass,
do not use the app to write.

To also round-trip your own files, point `OOUX_CORPUS` at a directory of them:

```bash
OOUX_CORPUS=~/notes/objects node test.mjs
```

Every `.md` in that directory gets byte-compared. Nothing personal lives in this
repo — the fixture is a library catalogue.

## Using it

- **← / →** move between objects when you are not typing in a field.
- **Nested object chips** under each relationship row jump to that object.
  A dashed chip means the target is not an object in this file.
- **Referenced by** at the bottom of every card lists what points back at it.
- **Sign off** locks a row. Locked rows cannot be edited or deleted until
  unlocked. The **Signed off** toggle in the header dims everything unsigned.
- **Source** view shows the markdown the app would write, with the selected
  object highlighted.
- **⌘S** saves. Chrome asks for write permission separately the first time.

## Not built yet

- Adding an anatomy table to an object that has none
- Prioritized anatomy ordering (currently always shows as "not done")
- Graph view
- Import from the looser narrative object-map format

## Using it with an AI agent

`skills/orca/SKILL.md` is a [Claude Code](https://claude.com/claude-code) skill. Copy it in:

```bash
cp -r skills/orca ~/.claude/skills/
```

Then ask for an object map in plain language — "model the objects in this product" —
and the agent drafts one from whatever notes exist, proves it round-trips with
`validate.mjs`, and opens it here. Drafting is the agent's job; editing is ORCA's.

`validate.mjs` exists for exactly this: anything *generating* a map can prove the
result is editable before handing it over. The agent and the app run the same
function, so they can never disagree about whether a file is safe.
