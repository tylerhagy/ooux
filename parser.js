/**
 * parser.js — OOUX object-map markdown parser and serializer.
 *
 * PURPOSE
 *   Parse an OOUX object-map markdown file into an editable model, and write it
 *   back without disturbing a single byte the user did not edit.
 *
 * THE GOVERNING RULE
 *   The parser never owns the file. It owns addressed spans inside it.
 *   Every segment stores its original source text plus a `dirty` flag:
 *     - not dirty -> the original source is emitted verbatim, never re-rendered
 *     - dirty     -> that one segment is regenerated from its fields
 *   Consequence: the app physically cannot reformat anything untouched. Column
 *   spacing, **Q1** refs, [[#wikilinks]], italic quotes and — critically — blank
 *   cells all survive, because a blank cell is only ever rewritten if the user
 *   edits that specific row.
 *
 * THE SAFETY NET
 *   verifyRoundTrip() re-serializes a freshly parsed document with zero edits and
 *   byte-compares it against the source. The app only ever writes files it has
 *   already proven it can reproduce; anything else opens read-only.
 *
 * LIMITATIONS
 *   - Recognises the canonical per-object format only (## Object + **Definition:**
 *     and/or the five-column anatomy table). The looser narrative object-map
 *     format is import-only and is not handled here.
 *   - Blank cells are meaningful ("nobody has been asked") and are never
 *     normalised away. An em dash means "not applicable" and is a distinct state.
 *   - No stable IDs are written into the file. Object identity is the slugified
 *     heading text.
 *
 * Pure module: no DOM, no I/O. Safe to run under Node for tests.
 */

// ---------------------------------------------------------------------------
// vocabularies
// ---------------------------------------------------------------------------

export const EVIDENCE = ['Confirmed', 'Described', 'Modelled', 'Derived'];
export const EVIDENCE_RANK = { Confirmed: 4, Described: 3, Modelled: 2, Derived: 1 };
export const ROW_TYPES = ['core', 'meta', 'nested', 'action · primary', 'action · secondary'];
const CANONICAL_HEADER = ['type', 'name', 'cardinality', 'evidence', 'note'];
const MIDDOT = '·';
const EMDASH = '—';

// ---------------------------------------------------------------------------
// line splitting — preserves line terminators so join() is exact
// ---------------------------------------------------------------------------

function splitLines(text) {
  // Each element keeps its own trailing newline. lines.join('') === text.
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const body = (line) => line.replace(/\r?\n$/, '');

// ---------------------------------------------------------------------------
// table cell splitting — respects backslash-escaped pipes
// ---------------------------------------------------------------------------

function splitCells(line) {
  const s = body(line).trim();
  if (!s.startsWith('|')) return null;
  const cells = [];
  let cur = '';
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  // Trailing text after the final pipe is discarded only when empty/whitespace.
  if (cur.trim() !== '') cells.push(cur);
  return cells.map((c) => c.trim());
}

function renderRow(cells, eol) {
  const inner = cells.map((c) => (c === '' ? ' ' : ' ' + c + ' ')).join('|');
  return '|' + inner + '|' + (eol || '\n');
}

function isTableLine(line) {
  return body(line).trim().startsWith('|');
}

function isSeparatorLine(line) {
  const c = splitCells(line);
  return !!c && c.length > 0 && c.every((x) => /^:?-{1,}:?$/.test(x.replace(/\s/g, '')));
}

/**
 * Columns are identified by NAME, not position, so a file can drop Evidence or
 * add Sign-off / Who without the table stopping being recognisable. Type, Name,
 * Cardinality and Note are required; everything else is optional.
 */
const COL_ALIASES = {
  type: 'type', name: 'name', cardinality: 'cardinality', note: 'note',
  evidence: 'evidence', 'sign-off': 'signoff', signoff: 'signoff', who: 'who', role: 'who',
};
export function parseHeader(cells) {
  if (!cells || cells.length < 4) return null;
  const cols = { type: -1, name: -1, cardinality: -1, note: -1, evidence: -1, signoff: -1, who: -1 };
  cells.forEach((c, i) => {
    const key = COL_ALIASES[c.trim().toLowerCase()];
    if (key && cols[key] === -1) cols[key] = i;
  });
  if (cols.type < 0 || cols.name < 0 || cols.cardinality < 0 || cols.note < 0) return null;
  return cols;
}
function headerMatches(cells) { return parseHeader(cells) !== null; }

// ---------------------------------------------------------------------------
// field parsing — model derived from cells; `raw` is always what gets written
// ---------------------------------------------------------------------------

const stripEmphasis = (s) => s.replace(/\*\*/g, '').replace(/(^|\W)\*(\S(?:.*?\S)?)\*/g, '$1$2').trim();

export function parseType(raw) {
  const s = stripEmphasis(String(raw || '')).toLowerCase().trim();
  if (s === '') return { kind: 'annotation', slot: null, priority: null };
  if (s === 'core') return { kind: 'attribute', slot: 'core', priority: null };
  if (s === 'meta') return { kind: 'attribute', slot: 'meta', priority: null };
  if (s === 'nested') return { kind: 'relationship', slot: null, priority: null };
  const m = s.match(/^action(?:\s*[·\-\/]\s*(primary|secondary))?$/);
  if (m) return { kind: 'action', slot: null, priority: m[1] || 'primary' };
  return { kind: 'unknown', slot: null, priority: null };
}

export function parseEvidence(raw) {
  const s = String(raw || '').trim();
  if (s === '') return { state: 'unasked', grade: null, raw: s };
  if (s === EMDASH || s === '-') return { state: 'n/a', grade: null, raw: s };
  const bare = stripEmphasis(s).replace(/[.,;]$/, '').trim().toLowerCase();
  const hit = EVIDENCE.find((g) => g.toLowerCase() === bare);
  if (hit) return { state: 'known', grade: hit, raw: s };
  const embedded = EVIDENCE.find((g) => new RegExp('\\b' + g + '\\b', 'i').test(s));
  if (embedded) return { state: 'known', grade: embedded, raw: s };
  return { state: 'other', grade: null, raw: s };
}

export function parseCardinality(raw) {
  const s = String(raw || '').trim();
  if (s === '') return { raw: s, kind: 'unknown', qualifier: null, uncertain: false };
  if (s === EMDASH || s === '-') return { raw: s, kind: 'n/a', qualifier: null, uncertain: false };

  const plain = stripEmphasis(s);
  const uncertain = /\?/.test(plain) || /\bor\b/i.test(plain);
  let work = plain.replace(/\?/g, '').trim();

  const range = work.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (range) {
    return { raw: s, kind: 'range', qualifier: null, uncertain, min: +range[1], max: +range[2] };
  }

  // "or" makes the value genuinely unpinned — a finding, not a value.
  if (/\bor\b/i.test(work)) return { raw: s, kind: 'other', qualifier: null, uncertain: true };

  for (const token of ['0-many', 'singular', 'range']) {
    const lower = work.toLowerCase();
    if (lower === token) return { raw: s, kind: token, qualifier: null, uncertain };
    if (lower.startsWith(token)) {
      const rest = work.slice(token.length).replace(/^[,\s]+/, '').trim();
      if (rest === '' || /^[a-z]/i.test(rest)) {
        return { raw: s, kind: token, qualifier: rest || null, uncertain };
      }
    }
  }
  return { raw: s, kind: 'other', qualifier: null, uncertain };
}

export function parseTargets(nameCell) {
  const s = String(nameCell || '').trim();
  if (s === '') return { targets: [], label: null };

  // "**Meter** — allocation splits, effective-dated" -> target + trailing label
  let work = s;
  let label = null;
  const dash = work.indexOf(' ' + EMDASH + ' ');
  if (dash > -1) { label = work.slice(dash + 3).trim(); work = work.slice(0, dash).trim(); }

  const targets = work.split(' / ').map((part) => {
    const p = part.trim();
    const internal = p.match(/^\[\[#([^\]]+)\]\]$/);
    if (internal) return { name: internal[1].trim(), scope: 'internal', raw: p };
    const external = p.match(/^\*\*([^*]+)\*\*$/);
    if (external) return { name: external[1].trim(), scope: 'external', raw: p };
    return { name: stripEmphasis(p), scope: 'unresolved', raw: p };
  }).filter((t) => t.name !== '');

  return { targets, label };
}

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractRefs(text) {
  const s = String(text || '');
  return {
    questions: [...s.matchAll(/\bQ(\d+)\b/g)].map((m) => 'Q' + m[1]),
    dates: [...s.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]),
    links: [...s.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]),
  };
}

// ---------------------------------------------------------------------------
// row + segment construction
// ---------------------------------------------------------------------------

function makeRow(line, colCount, cols) {
  const cells = splitCells(line) || [];
  while (cells.length < colCount) cells.push('');
  const at = (k) => (cols[k] >= 0 ? cells[cols[k]] : '');
  const type = parseType(at('type'));
  const cardinality = parseCardinality(at('cardinality'));
  const evidence = parseEvidence(at('evidence'));
  const { targets, label } = type.kind === 'relationship'
    ? parseTargets(at('name'))
    : { targets: [], label: null };

  return {
    src: line,
    dirty: false,
    cells,
    kind: type.kind,
    slot: type.slot,
    priority: type.priority,
    name: at('name'),
    targets,
    label,
    cardinality,
    evidence,
    note: at('note'),
    who: at('who'),
    cols,
    refs: extractRefs(at('name') + ' ' + at('cardinality') + ' ' + at('note')),
  };
}

function rowText(row) {
  if (!row.dirty) return row.src;
  const eol = /\r?\n$/.exec(row.src);
  return renderRow(row.cells, eol ? eol[0] : '\n');
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const DEFINITION_RE = /^\*\*Definition:\*\*\s*(.*)$/;
const ALSO_CALLED_RE = /^\*\*Also called:\*\*\s*(.*)$/;
const NOTE_RE = /^\*([A-Z][A-Za-z ]*):\*\s*(.*)$/;

export function parseDocument(text) {
  const lines = splitLines(text);

  // Flat section walk: a section is a heading line plus every line up to the
  // next heading of any level. Objects do not contain sub-headings in practice,
  // so this avoids nesting logic entirely and works on grouped files too.
  const sections = [];
  let current = { headingIndex: -1, start: 0, end: lines.length };
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(body(lines[i]))) {
      current.end = i;
      if (current.end > current.start) sections.push(current);
      current = { headingIndex: i, start: i, end: lines.length };
    }
  }
  if (current.end > current.start) sections.push(current);

  const blocks = [];
  for (const sec of sections) {
    const secLines = lines.slice(sec.start, sec.end);
    const block = buildSection(secLines, sec.headingIndex >= 0);
    blocks.push(block);
  }

  const doc = { blocks, source: text };
  refreshObjects(doc);
  return doc;
}

/** doc.objects is a derived view; call after any structural mutation. */
export function refreshObjects(doc) {
  doc.objects = doc.blocks.filter((b) => b.type === 'object');
  return doc.objects;
}

function looksLikeObject(secLines) {
  let sawDefinition = false;
  let sawTable = false;
  for (let i = 0; i < secLines.length; i++) {
    const t = body(secLines[i]);
    if (DEFINITION_RE.test(t)) sawDefinition = true;
    if (isTableLine(secLines[i]) && headerMatches(splitCells(secLines[i]))) sawTable = true;
  }
  return sawDefinition || sawTable;
}

function buildSection(secLines, hasHeading) {
  if (!hasHeading || !looksLikeObject(secLines)) {
    return { type: 'raw', src: secLines.join(''), lines: secLines };
  }

  const headingLine = secLines[0];
  const hm = body(headingLine).match(HEADING_RE);
  const segments = [];
  const obj = {
    type: 'object',
    level: hm[1].length,
    name: hm[2].trim(),
    id: slug(hm[2].trim()),
    heading: { src: headingLine, dirty: false, text: hm[2].trim() },
    definition: null,
    alsoCalled: null,
    table: null,
    notes: [],
    segments,
  };
  segments.push({ kind: 'heading', ref: obj.heading });

  let i = 1;
  while (i < secLines.length) {
    const line = secLines[i];
    const t = body(line);

    const dm = t.match(DEFINITION_RE);
    if (dm) {
      obj.definition = { src: line, dirty: false, text: dm[1].trim() };
      segments.push({ kind: 'definition', ref: obj.definition });
      i++;
      continue;
    }

    const am = t.match(ALSO_CALLED_RE);
    if (am) {
      obj.alsoCalled = { src: line, dirty: false, text: am[1].trim() };
      segments.push({ kind: 'alsoCalled', ref: obj.alsoCalled });
      i++;
      continue;
    }

    if (isTableLine(line) && headerMatches(splitCells(line)) && !obj.table) {
      const headerCells = splitCells(line);
      const colCount = headerCells.length;
      const cols = parseHeader(headerCells);
      const table = {
        src: line,
        dirty: false,
        headerCells,
        colCount,
        cols,
        header: { src: line, dirty: false },
        separator: null,
        rows: [],
      };
      i++;
      if (i < secLines.length && isSeparatorLine(secLines[i])) {
        table.separator = { src: secLines[i], dirty: false };
        i++;
      }
      while (i < secLines.length && isTableLine(secLines[i])) {
        table.rows.push(makeRow(secLines[i], colCount, cols));
        i++;
      }
      obj.table = table;
      segments.push({ kind: 'table', ref: table });
      continue;
    }

    const nm = t.match(NOTE_RE);
    if (nm) {
      const note = { src: line, dirty: false, label: nm[1].trim(), body: nm[2].trim() };
      obj.notes.push(note);
      segments.push({ kind: 'note', ref: note });
      i++;
      continue;
    }

    // Anything unrecognised is kept verbatim, in place.
    const rawStart = i;
    while (i < secLines.length) {
      const nt = body(secLines[i]);
      if (DEFINITION_RE.test(nt) || ALSO_CALLED_RE.test(nt) || NOTE_RE.test(nt)) break;
      if (isTableLine(secLines[i]) && headerMatches(splitCells(secLines[i])) && !obj.table) break;
      i++;
    }
    segments.push({ kind: 'raw', src: secLines.slice(rawStart, i).join('') });
  }

  return obj;
}

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

function lineText(seg, prefix) {
  if (!seg.dirty) return seg.src;
  const eol = /\r?\n$/.exec(seg.src);
  return prefix + (eol ? eol[0] : '\n');
}

export function serializeDocument(doc) {
  const out = [];
  for (const block of doc.blocks) {
    if (block.type === 'raw') { out.push(block.src); continue; }

    for (const seg of block.segments) {
      if (seg.kind === 'raw') { out.push(seg.src); continue; }
      const ref = seg.ref;

      if (seg.kind === 'heading') {
        out.push(ref.dirty ? '#'.repeat(block.level) + ' ' + ref.text + (/\r?\n$/.exec(ref.src) || ['\n'])[0] : ref.src);
        continue;
      }
      if (seg.kind === 'definition') { out.push(lineText(ref, '**Definition:** ' + ref.text)); continue; }
      if (seg.kind === 'alsoCalled') { out.push(lineText(ref, '**Also called:** ' + ref.text)); continue; }
      if (seg.kind === 'note') { out.push(lineText(ref, '*' + ref.label + ':* ' + ref.body)); continue; }

      if (seg.kind === 'table') {
        out.push(ref.header.dirty ? renderRow(ref.headerCells, '\n') : ref.header.src);
        if (ref.separator) {
          out.push(ref.separator.dirty
            ? renderRow(ref.headerCells.map(() => '---'), '\n')
            : ref.separator.src);
        }
        for (const row of ref.rows) out.push(rowText(row));
        continue;
      }
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// verify — the safety net
// ---------------------------------------------------------------------------

export function verifyRoundTrip(text) {
  let doc;
  try {
    doc = parseDocument(text);
  } catch (e) {
    return { ok: false, reason: 'parse threw: ' + e.message, line: null };
  }
  const out = serializeDocument(doc);
  if (out === text) return { ok: true, doc };

  const a = splitLines(text);
  const b = splitLines(out);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        ok: false,
        reason: 'round-trip mismatch',
        line: i + 1,
        expected: a[i] === undefined ? '(end of file)' : body(a[i]),
        actual: b[i] === undefined ? '(end of file)' : body(b[i]),
        doc,
      };
    }
  }
  return { ok: false, reason: 'length mismatch', line: n, doc };
}

// ---------------------------------------------------------------------------
// derived reads — no state of their own
// ---------------------------------------------------------------------------

export function evidenceStats(doc) {
  const counts = { Confirmed: 0, Described: 0, Modelled: 0, Derived: 0, unasked: 0, 'n/a': 0, other: 0 };
  let total = 0;
  for (const obj of doc.objects) {
    if (!obj.table) continue;
    for (const row of obj.table.rows) {
      total++;
      const e = row.evidence;
      if (e.state === 'known') counts[e.grade]++;
      else counts[e.state]++;
    }
  }
  return { counts, total };
}

/**
 * Relationships are directed rows owned by one object. Edges are derived here
 * and never stored. An edge with only one stated side keeps `openEnd` — nobody
 * has stated the inverse, which is information, not an error.
 */
export function deriveEdges(doc) {
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const rows = [];
  for (const obj of doc.objects) {
    if (!obj.table) continue;
    for (const row of obj.table.rows) {
      if (row.kind !== 'relationship') continue;
      for (const t of row.targets) rows.push({ from: obj.id, to: slug(t.name), target: t, row, owner: obj });
    }
  }
  const used = new Set();
  const edges = [];
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    const a = rows[i];
    let pair = -1;
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      if (rows[j].from === a.to && rows[j].to === a.from) { pair = j; break; }
    }
    if (pair > -1) {
      used.add(i); used.add(pair);
      const b = rows[pair];
      edges.push({
        a, b,
        openEnd: false,
        resolved: byId.has(a.to),
        contested: a.row.cardinality.kind === 'other' || b.row.cardinality.kind === 'other',
      });
    } else {
      used.add(i);
      edges.push({ a, b: null, openEnd: true, resolved: byId.has(a.to), contested: a.row.cardinality.kind === 'other' });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// mutation helpers
//
// Everything here marks the segments it touches `dirty`, so serialization
// regenerates exactly those and leaves the rest of the file byte-identical.
// ---------------------------------------------------------------------------

export const SIGNOFF_HEADER = 'Sign-off';

/** Index of the sign-off column, or -1 if this table does not have one yet. */
export function signOffCol(table) {
  if (!table) return -1;
  return table.headerCells.findIndex((c) => c.trim().toLowerCase() === SIGNOFF_HEADER.toLowerCase());
}

/**
 * Add the Sign-off column to a table. This rewrites every row in that table
 * once — the only wholesale rewrite in the app, and it happens on the first
 * sign-off in a file. Everything after it is a one-line diff again.
 */
export function addSignOffColumn(table) {
  if (signOffCol(table) > -1) return signOffCol(table);
  table.headerCells.push(SIGNOFF_HEADER);
  table.colCount = table.headerCells.length;
  table.cols = parseHeader(table.headerCells) || table.cols;
  table.header.dirty = true;
  if (table.separator) table.separator.dirty = true;
  for (const row of table.rows) {
    while (row.cells.length < table.colCount - 1) row.cells.push('');
    row.cells.push('');
    row.dirty = true;
  }
  return table.headerCells.length - 1;
}

export function isSigned(row, col) {
  if (col < 0) return false;
  return /\S/.test(String(row.cells[col] || ''));
}

/** Sign-off value carries the date, so the file itself records when. */
export function signRow(row, col, dateISO) {
  row.cells[col] = 'signed ' + dateISO;
  row.dirty = true;
}
export function unsignRow(row, col) {
  row.cells[col] = '';
  row.dirty = true;
}

const EOL = '\n';

function newLineSeg(text) { return { src: EOL, dirty: true, text }; }

/**
 * Build a fresh object block. All segments are dirty, so they serialize from
 * fields rather than from a source span that does not exist yet.
 */
export function createObjectBlock(name, { level = 2, columns = null } = {}) {
  const heading = { src: EOL, dirty: true, text: name };
  const definition = newLineSeg('');
  const headerCells = columns
    ? columns.slice()
    : ['Type', 'Name', 'Cardinality', 'Evidence', 'Note'];
  const table = {
    src: EOL, dirty: true,
    headerCells,
    colCount: headerCells.length,
    cols: parseHeader(headerCells),
    header: { src: EOL, dirty: true },
    separator: { src: EOL, dirty: true },
    rows: [],
  };
  const block = {
    type: 'object',
    level,
    name,
    id: slug(name),
    heading,
    definition,
    alsoCalled: null,
    table,
    notes: [],
    segments: [
      { kind: 'heading', ref: heading },
      { kind: 'raw', src: EOL },
      { kind: 'definition', ref: definition },
      { kind: 'raw', src: EOL },
      { kind: 'table', ref: table },
      { kind: 'raw', src: EOL },
    ],
  };
  return block;
}

/** Append a new object at the end of the document, with a separator if the file uses them. */
export function addObject(doc, name) {
  const existing = doc.objects[0];
  const level = existing ? existing.level : 2;
  const columns = existing && existing.table ? existing.table.headerCells.slice() : null;
  const usesRules = /\n---\n/.test(doc.source || '');
  if (usesRules) doc.blocks.push({ type: 'raw', src: '---' + EOL + EOL });
  const block = createObjectBlock(name, { level, columns });
  doc.blocks.push(block);
  refreshObjects(doc);
  return block;
}

/** Remove an object, plus a trailing separator-only raw block if one follows it. */
export function removeObject(doc, id) {
  const i = doc.blocks.findIndex((b) => b.type === 'object' && b.id === id);
  if (i < 0) return false;
  let end = i + 1;
  if (doc.blocks[end] && doc.blocks[end].type === 'raw' && /^[\s-]*$/.test(doc.blocks[end].src)) end++;
  doc.blocks.splice(i, end - i);
  refreshObjects(doc);
  return true;
}

/**
 * Rename an object and rewrite [[#Old]] references to it everywhere in the file.
 * Cross-file references cannot be reached and are reported back to the caller.
 */
export function renameObject(doc, id, newName) {
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return { ok: false };
  const oldName = obj.name;
  obj.heading.text = newName;
  obj.heading.dirty = true;
  obj.name = newName;
  obj.id = slug(newName);

  const pattern = new RegExp('\\[\\[#' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\]', 'g');
  let rewritten = 0;
  for (const o of doc.objects) {
    if (!o.table) continue;
    for (const row of o.table.rows) {
      let changed = false;
      row.cells = row.cells.map((c) => {
        if (pattern.test(c)) { changed = true; return c.replace(pattern, '[[#' + newName + ']]'); }
        return c;
      });
      if (changed) { row.dirty = true; rewritten++; }
    }
  }
  refreshObjects(doc);
  return { ok: true, rewritten, oldName };
}

/** Set (or create) a trailer note such as *Notes:* on an object. */
export function setNote(obj, label, body) {
  let note = obj.notes.find((n) => n.label.toLowerCase() === label.toLowerCase());
  if (note) {
    if (body.trim() === '') {
      obj.notes = obj.notes.filter((n) => n !== note);
      obj.segments = obj.segments.filter((s) => s.ref !== note);
      return null;
    }
    note.body = body;
    note.dirty = true;
    return note;
  }
  if (body.trim() === '') return null;
  note = { src: EOL, dirty: true, label, body };
  obj.notes.push(note);
  // Place it after the table if there is one, otherwise at the end.
  const tableIdx = obj.segments.findIndex((s) => s.kind === 'table');
  const at = tableIdx > -1 ? tableIdx + 1 : obj.segments.length;
  obj.segments.splice(at, 0, { kind: 'raw', src: EOL }, { kind: 'note', ref: note });
  return note;
}

/** Objects whose relationship rows point at this one. Derived, never stored. */
export function backlinks(doc, id) {
  const out = [];
  for (const o of doc.objects) {
    if (o.id === id || !o.table) continue;
    for (const row of o.table.rows) {
      if (row.kind !== 'relationship') continue;
      for (const t of row.targets) {
        if (slug(t.name) === id) out.push({ from: o, row, target: t });
      }
    }
  }
  return out;
}

/** Canonical cardinality options offered in the UI. `raw` stays authoritative. */
export const CARDINALITIES = [
  { value: '', label: 'not asked' },
  { value: '—', label: 'n/a' },
  { value: 'singular', label: 'singular — exactly one' },
  { value: '0-many', label: '0-many — none or many' },
  { value: '1-many', label: '1-many — at least one' },
  { value: 'range', label: 'range' },
];

export function composeCardinality(kind, qualifier, uncertain) {
  if (kind === '' || kind === '—') return kind;
  let s = kind;
  if (uncertain) s += '?';
  if (qualifier && qualifier.trim()) s += ', ' + qualifier.trim();
  return s;
}

/** Remove a column from a table by index, rewriting every row in it once. */
export function removeColumn(table, index) {
  if (!table || index < 0 || index >= table.headerCells.length) return false;
  table.headerCells.splice(index, 1);
  table.colCount = table.headerCells.length;
  table.cols = parseHeader(table.headerCells) || table.cols;
  table.header.dirty = true;
  if (table.separator) table.separator.dirty = true;
  for (const row of table.rows) {
    if (row.cells.length > index) row.cells.splice(index, 1);
    while (row.cells.length < table.colCount) row.cells.push('');
    row.dirty = true;
  }
  return true;
}

/**
 * Markdown for a brand-new, empty object map. Deliberately minimal: a title, a
 * one-line orientation note, and one object with an empty anatomy table ready
 * to be filled. Everything else is the user's to write.
 */
export function blankMap(title, firstObject = 'New object') {
  return `# ${title}

Objects, attributes, actions and relationships for ${title}.

**Blank cells are honest** — they mean nobody has been asked yet. Filling them in
is the work. Sign a row off once design and engineering agree on it.

---

## ${firstObject}

**Definition:** 

| Type | Name | Cardinality | Note | Sign-off |
| --- | --- | --- | --- | --- |
`;
}
