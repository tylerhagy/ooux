/**
 * migrate-signoff.mjs — produce a sign-off copy of an object-map file.
 *
 * Drops the Evidence column and adds an empty Sign-off column in one rewrite,
 * so the app never has to rewrite a table later. The source file is not touched.
 *
 * Usage: node migrate-signoff.mjs <source.md> <destination.md>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseDocument, serializeDocument, verifyRoundTrip, removeColumn, addSignOffColumn, signOffCol } from './parser.js';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error('usage: node migrate-signoff.mjs <source.md> <dest.md>'); process.exit(1); }
if (!existsSync(src)) { console.error('no such file: ' + src); process.exit(1); }

const text = readFileSync(src, 'utf8');
const pre = verifyRoundTrip(text);
if (!pre.ok) { console.error('source does not round-trip — refusing. ' + pre.reason + ' line ' + pre.line); process.exit(1); }

const doc = parseDocument(text);
let tables = 0, rows = 0;
for (const obj of doc.objects) {
  if (!obj.table) continue;
  const ev = obj.table.headerCells.findIndex((c) => c.trim().toLowerCase() === 'evidence');
  if (ev > -1) removeColumn(obj.table, ev);
  if (signOffCol(obj.table) < 0) addSignOffColumn(obj.table);
  tables++; rows += obj.table.rows.length;
}

const out = serializeDocument(doc);
const post = verifyRoundTrip(out);
if (!post.ok) { console.error('output does not round-trip — refusing to write. ' + post.reason + ' line ' + post.line); process.exit(1); }

writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}`);
console.log(`  ${doc.objects.length} objects · ${tables} tables · ${rows} rows`);
console.log(`  columns now: ${doc.objects.find((o) => o.table).table.headerCells.join(' | ')}`);
console.log(`  round-trips: yes`);
