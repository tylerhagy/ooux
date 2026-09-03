## Book

**Definition:** A published work the library holds one or more copies of.

| Type | Name | Cardinality | Evidence | Note |
|---|---|---|---|---|
| core | Title | | Modelled | |
| nested | [[#Author]] | 0-many | Modelled | |

*Serves:* Find a book by title.

---

## Author

**Definition:** A person credited with writing a book.

| Type | Name | Cardinality | Evidence | Note |
|---|---|---|---|---|
| core | Display name | | Modelled | |
| nested | [[#Book]] | 0-many | Modelled | |

*Serves:* Show everything one person wrote.
