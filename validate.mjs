/**
 * validate.mjs — check that files are safe for ORCA to edit.
 *
 * PURPOSE
 *   ORCA only writes files it can reproduce byte-for-byte. This runs that same
 *   check from the command line, so anything generating an object map can prove
 *   the result is editable before handing it to someone.
 *
 * USAGE
 *   node validate.mjs <file.md> [more.md ...]
 *   node validate.mjs --dir <folder>        # every .md in the folder
 *
 * EXIT CODE
 *   0 = every file round-trips. 1 = at least one would open read-only.
 *
 * Reads only. Writes nothing.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { verifyRoundTrip, signOffCol } from './parser.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node validate.mjs <file.md> [...]  |  --dir <folder>');
  process.exit(1);
}

let files = [];
if (args[0] === '--dir') {
  const dir = args[1];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error('not a directory: ' + dir);
    process.exit(1);
  }
  files = readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => join(dir, n));
} else {
  files = args;
}

let bad = 0, maps = 0;
for (const f of files) {
  if (!existsSync(f)) { console.log(`MISSING   ${f}`); bad++; continue; }
  const text = readFileSync(f, 'utf8');
  const r = verifyRoundTrip(text);
  const objs = r.doc ? r.doc.objects.length : 0;
  const tables = r.doc ? r.doc.objects.filter((o) => o.table).length : 0;
  const rows = r.doc
    ? r.doc.objects.reduce((n, o) => n + (o.table ? o.table.rows.length : 0), 0)
    : 0;
  const signed = r.doc
    ? r.doc.objects.reduce((n, o) => {
        if (!o.table) return n;
        const c = signOffCol(o.table);
        return n + (c < 0 ? 0 : o.table.rows.filter((x) => /\S/.test(x.cells[c] || '')).length);
      }, 0)
    : 0;

  const name = f.split('/').pop();
  if (!r.ok) {
    bad++;
    console.log(`READ-ONLY ${name}`);
    console.log(`          ${r.reason} at line ${r.line}`);
    if (r.expected !== undefined) {
      console.log(`          expected: ${JSON.stringify(String(r.expected).slice(0, 120))}`);
      console.log(`          produced: ${JSON.stringify(String(r.actual).slice(0, 120))}`);
    }
  } else if (objs === 0) {
    console.log(`NOT A MAP ${name}  (round-trips, but no objects — ORCA will not show it)`);
  } else {
    maps++;
    console.log(`OK        ${name}  ${objs} objects · ${tables} tables · ${rows} rows · ${signed} signed`);
  }
}

console.log('');
console.log(`${files.length} file(s) checked · ${maps} editable map(s) · ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
