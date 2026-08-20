# Round-trip torture fixture

Everything in this file exists to break the parser. If it round-trips byte for
byte, the parser is not reformatting things it does not understand.

This preamble is arbitrary prose and must be preserved exactly, including the
table below, which is **not** an anatomy table and must stay raw:

| Card slot | Here |
|---|---|
| Object Name | the `##` heading |
| Object Definition | the `**Definition:**` line |

---

## Book

**Definition:** A published work the library holds one or more copies of.

**Also called:** title, work

| Type | Name | Cardinality | Evidence | Note |
|---|---|---|---|---|
| core | Title | | Modelled | |
| core | Pipe \| in a cell | — | Derived | Escaped pipe must survive |
| meta | Previously known title | — | Derived | Pattern shared with author, series |
| nested | [[#Author]] | 0-many | Modelled | **Q1** — can a book have several |
| nested | **Copy** / **Series** / **Edition** | singular? | Modelled | **Q4** — which of these are real objects |
| nested | **Copy** — shelf location, per branch | 0-many, point in time | Described | A librarian: *"a copy belongs to a branch, not to the book"* |
| nested | [[#Borrower]] | **0-many or singular — Q1** | | Nobody has been asked |
| nested | [[#Loan]] | singular per direction | Described | 2026-08-19, in the review |
| action · primary | Add | | Modelled | |
| action · secondary | Withdraw | — | | **Q8** — delete or deactivate only |
| | *inherits Author's anatomy* | | Modelled | Annotation row, blank Type |
| | *no attributes named* | | | |

*Open:* who performs each action — the rows name actions but not roles.
*Serves:* Find a book without knowing which branch holds it.

---

## Edition

**Definition:** A specific published version of a book. Whether this is a distinct object or an attribute of the book has never been settled. That is the entire content of this object today.

---

## Author

**Definition:** A person credited with writing a book.

| Type | Name | Cardinality | Evidence | Note |
|---|---|---|---|---|
| core | Display name | | Modelled | |
| nested | [[#Book]] | **0-many or singular — Q1** | Modelled | **The decision that matters here.** |

*Serves:* Show everything one person wrote, across editions.

---

## Borrower

**Definition:** Someone who can take a book out.

| Type | Name | Cardinality | Evidence | Note |
|---|---|---|---|---|
| core | Card number | | Modelled | |
| nested | [[#Loan]] | 0-many | Modelled | |

---

## What to fill in next

This is not an object — no definition, no anatomy table — so it must parse as a
raw block and come back untouched.

1. **Q1 — can a book have several authors?** One question, one conversation.
2. **Roles.** Every action row above is missing who does it.
