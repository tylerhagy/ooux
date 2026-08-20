/**
 * test.mjs — parser verification. Run: node test.mjs
 *
 * The parser is the gate on everything else, so these run before any UI work
 * and against the real vault files, not just the fixture.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import {
  parseDocument, serializeDocument, verifyRoundTrip,
  evidenceStats, deriveEdges, parseCardinality, parseEvidence, parseType, parseTargets,
  addSignOffColumn, signOffCol, isSigned, signRow, unsignRow,
  addObject, removeObject, renameObject, setNote, backlinks, composeCardinality,
  removeColumn, parseHeader, blankMap,
} from './parser.js';

/**
 * Extra real-world files to round-trip, if you have any. Point OOUX_CORPUS at a
 * directory of .md object maps and every one of them gets byte-compared too.
 * Nothing personal is committed here — the fixture is the only required input.
 */
const CORPUS = process.env.OOUX_CORPUS || '';
const TARGETS = [['fixture', './fixtures/round-trip-test.md']];
if (CORPUS && existsSync(CORPUS)) {
  for (const f of readdirSync(CORPUS).filter((n) => n.endsWith('.md'))) {
    TARGETS.push([f.replace(/\.md$/, ''), `${CORPUS}/${f}`]);
  }
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

console.log('\n=== 1. ROUND-TRIP (byte-identical, zero edits) ===\n');
const docs = {};
for (const [name, path] of TARGETS) {
  if (!existsSync(path)) { console.log(`  SKIP  ${name} — not found`); continue; }
  const text = readFileSync(path, 'utf8');
  const r = verifyRoundTrip(text);
  docs[name] = r.doc;
  ok(`${name} round-trips (${text.length} bytes, ${r.doc ? r.doc.objects.length : '?'} objects)`,
    r.ok,
    r.ok ? '' : `${r.reason} at line ${r.line}\n        expected: ${JSON.stringify(r.expected)}\n        actual:   ${JSON.stringify(r.actual)}`);
}

console.log('\n=== 2. IDEMPOTENCY ===\n');
for (const [name, path] of TARGETS) {
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  const once = serializeDocument(parseDocument(text));
  const twice = serializeDocument(parseDocument(once));
  ok(`${name}: serialize(parse(x)) === serialize(parse(serialize(parse(x))))`, once === twice);
}

console.log('\n=== 3. EDIT ONE ROW -> DIFF IS EXACTLY ONE LINE ===\n');
{
  const text = readFileSync('./fixtures/round-trip-test.md', 'utf8');
  const doc = parseDocument(text);
  const book = doc.objects.find((o) => o.name === 'Book');
  const row = book.table.rows[0];
  row.cells[3] = 'Confirmed';
  row.dirty = true;
  const out = serializeDocument(doc);
  const a = text.split('\n'), b = out.split('\n');
  const diffs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push(i + 1);
  ok(`exactly one line changed (changed: ${diffs.join(',')})`, diffs.length === 1);
  ok('the changed line is the edited row',
    b[diffs[0] - 1] === '| core | Title | | Confirmed | |',
    `got: ${JSON.stringify(b[diffs[0] - 1])}`);
}

console.log('\n=== 4. BLANK CELLS SURVIVE AN ADJACENT EDIT ===\n');
{
  const text = readFileSync('./fixtures/round-trip-test.md', 'utf8');
  const doc = parseDocument(text);
  const book = doc.objects.find((o) => o.name === 'Book');
  const row = book.table.rows[8]; // action · primary | Add | | Modelled | |
  row.cells[4] = 'touched';
  row.dirty = true;
  const out = serializeDocument(doc);
  ok('blank cardinality cell stayed blank',
    out.includes('| action · primary | Add | | Modelled | touched |'),
    out.split('\n').find((l) => l.includes('| Add |')));
}

console.log('\n=== 5. FIELD PARSING ===\n');
{
  const c = (s) => parseCardinality(s);
  ok('singular', c('singular').kind === 'singular');
  ok('0-many', c('0-many').kind === '0-many');
  ok('singular per direction -> qualifier', c('singular per direction').kind === 'singular' && c('singular per direction').qualifier === 'per direction');
  ok('0-many, point in time -> qualifier', c('0-many, point in time').kind === '0-many' && c('0-many, point in time').qualifier === 'point in time');
  ok('singular? -> uncertain', c('singular?').kind === 'singular' && c('singular?').uncertain === true);
  ok('**0-many or singular — Q1** -> other + uncertain', c('**0-many or singular — Q1**').kind === 'other' && c('**0-many or singular — Q1**').uncertain === true);
  ok('blank -> unknown', c('').kind === 'unknown');
  ok('em dash -> n/a', c('—').kind === 'n/a');
  ok('raw always preserved', c('0-many, point in time').raw === '0-many, point in time');

  ok('evidence blank -> unasked', parseEvidence('').state === 'unasked');
  ok('evidence em dash -> n/a', parseEvidence('—').state === 'n/a');
  ok('evidence Modelled', parseEvidence('Modelled').grade === 'Modelled');
  ok('evidence **Described.** in prose', parseEvidence('**Described.** Decided 2026-07-30').grade === 'Described');

  ok('type core', parseType('core').kind === 'attribute' && parseType('core').slot === 'core');
  ok('type nested', parseType('nested').kind === 'relationship');
  ok('type action · primary', parseType('action · primary').kind === 'action' && parseType('action · primary').priority === 'primary');
  ok('type blank -> annotation', parseType('').kind === 'annotation');

  const t1 = parseTargets('**Copy** / **Series** / **Edition**');
  ok('multi-target splits into 3', t1.targets.length === 3, JSON.stringify(t1.targets.map((x) => x.name)));
  const t2 = parseTargets('**Copy** — shelf location, per branch');
  ok('target + label', t2.targets.length === 1 && t2.targets[0].name === 'Copy' && t2.label === 'shelf location, per branch');
  const t3 = parseTargets('[[#Author]]');
  ok('internal wikilink target', t3.targets[0].scope === 'internal' && t3.targets[0].name === 'Author');
}

console.log('\n=== 6. DERIVED READS ===\n');
{
  const doc = docs['fixture'];
  const { counts, total } = evidenceStats(doc);
  console.log(`  objects: ${doc.objects.map((o) => o.name).join(', ')}`);
  console.log(`  rows: ${total} — ${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  const edges = deriveEdges(doc);
  console.log(`  edges: ${edges.length} (${edges.filter((e) => e.openEnd).length} with an open end, ${edges.filter((e) => e.contested).length} contested)`);
  ok('derived edges found', edges.length > 0);
}


console.log('\n=== 7. MUTATIONS (these write to real files) ===\n');
{
  const src = readFileSync('./fixtures/round-trip-test.md', 'utf8');

  // --- sign-off column -----------------------------------------------------
  {
    const doc = parseDocument(src);
    const obj = doc.objects.find((o) => o.name === 'Book');
    ok('no sign-off column to begin with', signOffCol(obj.table) === -1);
    const col = addSignOffColumn(obj.table);
    signRow(obj.table.rows[0], col, '2026-08-19');
    const out = serializeDocument(doc);
    const re = verifyRoundTrip(out);
    ok('file still round-trips after adding the column', re.ok, re.reason + ' line ' + re.line);
    const doc2 = parseDocument(out);
    const obj2 = doc2.objects.find((o) => o.name === 'Book');
    ok('sign-off column survives a reparse', signOffCol(obj2.table) === 5);
    ok('signed row reads back as signed', isSigned(obj2.table.rows[0], 5));
    ok('unsigned row reads back as unsigned', !isSigned(obj2.table.rows[1], 5));
    ok('other objects untouched by the column add',
      out.includes('| core | Display name | | Modelled | |'));
    unsignRow(obj2.table.rows[0], 5);
    ok('unsign clears the cell', !isSigned(obj2.table.rows[0], 5));
  }

  // --- rename --------------------------------------------------------------
  {
    const doc = parseDocument(src);
    const r = renameObject(doc, 'author', 'Writer');
    ok('rename reports rewritten references', r.ok && r.rewritten >= 1, 'rewrote ' + r.rewritten);
    const out = serializeDocument(doc);
    ok('heading renamed', out.includes('## Writer'));
    ok('inbound [[#Author]] rewritten', out.includes('[[#Writer]]') && !out.includes('[[#Author]]'));
    ok('renamed file round-trips', verifyRoundTrip(out).ok);
  }

  // --- add object ----------------------------------------------------------
  {
    const doc = parseDocument(src);
    const before = doc.objects.length;
    const block = addObject(doc, 'Reservation');
    block.definition.text = 'A hold placed on a book that is currently out.';
    const out = serializeDocument(doc);
    ok('object count grew', doc.objects.length === before + 1);
    ok('new heading present', out.includes('## Reservation'));
    ok('new definition present', out.includes('**Definition:** A hold placed on a book that is currently out.'));
    ok('new anatomy table present', out.includes('| Type | Name | Cardinality | Evidence | Note |'));
    const re = verifyRoundTrip(out);
    ok('file with a new object round-trips', re.ok, re.reason + ' line ' + re.line);
    ok('reparse finds the new object', parseDocument(out).objects.some((o) => o.name === 'Reservation'));
    ok('everything before it is byte-identical', out.startsWith(src.slice(0, src.length - 5).slice(0, 1200)));
  }

  // --- delete object -------------------------------------------------------
  {
    const doc = parseDocument(src);
    ok('delete returns true', removeObject(doc, 'edition') === true);
    const out = serializeDocument(doc);
    ok('object gone from output', !out.includes('## Edition'));
    ok('neighbours survive', out.includes('## Book') && out.includes('## Author'));
    ok('file after delete round-trips', verifyRoundTrip(out).ok);
  }

  // --- notes ---------------------------------------------------------------
  {
    const doc = parseDocument(src);
    const obj = doc.objects.find((o) => o.name === 'Edition');
    setNote(obj, 'Notes', 'Check whether this is a real object.');
    const out = serializeDocument(doc);
    ok('note written', out.includes('*Notes:* Check whether this is a real object.'));
    ok('file with a note round-trips', verifyRoundTrip(out).ok);
    const doc2 = parseDocument(out);
    const obj2 = doc2.objects.find((o) => o.name === 'Edition');
    ok('note reads back', (obj2.notes.find((n) => n.label === 'Notes') || {}).body ===
      'Check whether this is a real object.');
    setNote(obj2, 'Notes', '');
    ok('emptying a note removes the line', !serializeDocument(doc2).includes('*Notes:*'));
  }

  // --- cardinality composition --------------------------------------------
  {
    ok('compose singular', composeCardinality('singular', '', false) === 'singular');
    ok('compose with qualifier', composeCardinality('0-many', 'point in time', false) === '0-many, point in time');
    ok('compose n/a', composeCardinality('—', '', false) === '—');
    ok('compose blank', composeCardinality('', 'ignored', false) === '');
  }

  // --- backlinks -----------------------------------------------------------
  {
    const doc = parseDocument(readFileSync('./fixtures/round-trip-test.md', 'utf8'));
    const b = backlinks(doc, 'book');
    ok('Book has inbound references', b.length > 0, b.length + ' found');
  }
}


console.log('\n=== 8. COLUMNS ARE FOUND BY NAME, NOT POSITION ===\n');
{
  // Regression: dropping Evidence used to make the table unrecognisable.
  const h = (cells) => parseHeader(cells);
  ok('canonical 5-column header', !!h(['Type','Name','Cardinality','Evidence','Note']));
  ok('Evidence dropped, Sign-off added', (() => {
    const c = h(['Type','Name','Cardinality','Note','Sign-off']);
    return c && c.evidence === -1 && c.signoff === 4 && c.note === 3;
  })());
  ok('reordered columns still map', (() => {
    const c = h(['Name','Type','Note','Cardinality']);
    return c && c.name === 0 && c.type === 1 && c.note === 2 && c.cardinality === 3;
  })());
  ok('missing a required column is not our table', h(['Type','Name','Evidence','Note']) === null);
  ok('a foreign table is rejected', h(['Card slot','Here']) === null);

  const src = readFileSync('./fixtures/round-trip-test.md', 'utf8');
  const doc = parseDocument(src);
  const obj = doc.objects.find((o) => o.name === 'Book');
  const evIdx = obj.table.headerCells.findIndex((c) => c.toLowerCase() === 'evidence');
  removeColumn(obj.table, evIdx);
  addSignOffColumn(obj.table);
  const out = serializeDocument(doc);
  ok('migrated table round-trips', verifyRoundTrip(out).ok);
  const doc2 = parseDocument(out);
  const obj2 = doc2.objects.find((o) => o.name === 'Book');
  ok('migrated table is still recognised', !!obj2.table, 'table went unparsed');
  ok('rows survive the migration', obj2.table.rows.length === obj.table.rows.length);
  ok('a relationship row still resolves its target',
    obj2.table.rows.some((r) => r.kind === 'relationship' && r.targets.some((t) => t.name === 'Author')));
  ok('note text moved with the column, not the index',
    obj2.table.rows[1].note === 'Escaped pipe must survive', JSON.stringify(obj2.table.rows[1].note));
}



console.log('\n=== 9. STARTING FROM SCRATCH ===\n');
{
  const t = blankMap('Connect App');
  const r = verifyRoundTrip(t);
  ok('a blank map round-trips', r.ok, r.reason);
  ok('it has exactly one starter object', r.doc.objects.length === 1);
  ok('its table is recognised', !!r.doc.objects[0].table);
  ok('it starts with no rows', r.doc.objects[0].table.rows.length === 0);
  ok('it uses the sign-off columns', signOffCol(r.doc.objects[0].table) === 4);

  // The full from-nothing flow: rename it, add rows, add a second object, sign one off.
  const doc = parseDocument(t);
  renameObject(doc, 'new-object', 'Rep');
  const obj = doc.objects[0];
  obj.definition.text = 'A field sales representative using the iPad app.';
  obj.definition.dirty = true;
  const C = obj.table.cols;
  const mk = (type, name, card, note) => {
    const cells = new Array(obj.table.colCount).fill('');
    cells[C.type] = type; cells[C.name] = name; cells[C.cardinality] = card; cells[C.note] = note;
    obj.table.rows.push({ src: '\n', dirty: true, cells, kind: 'x', cols: C,
      cardinality: parseCardinality(card), evidence: parseEvidence(''), targets: [], refs: {} });
  };
  mk('core', 'Name', '', '');
  mk('nested', '[[#Territory]]', 'singular', 'Q1 — can a rep cover two?');
  const second = addObject(doc, 'Territory');
  second.definition.text = 'A geographic area a rep is responsible for.';
  signRow(obj.table.rows[0], signOffCol(obj.table), '2026-08-19');

  const out = serializeDocument(doc);
  const re = verifyRoundTrip(out);
  ok('the built-from-scratch file round-trips', re.ok, re.reason + ' line ' + re.line);
  const d2 = parseDocument(out);
  ok('two objects', d2.objects.length === 2, d2.objects.map((o) => o.name).join(','));
  ok('the renamed object kept its rows', d2.objects[0].table.rows.length === 2);
  ok('the signed row reads back signed', isSigned(d2.objects[0].table.rows[0], signOffCol(d2.objects[0].table)));
  ok('the relationship resolves to the second object',
    backlinks(d2, 'territory').length === 1, JSON.stringify(backlinks(d2, 'territory').length));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
