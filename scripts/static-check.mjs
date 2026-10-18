// Dependency-free static checks (works before `npm install`): syntax, import/export resolution, npm-script targets.
// Usage: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // Windows-safe
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  }
})(root);

let problems = 0;
const bad = (m) => { problems++; console.log('PROBLEM:', m); };
const rel = (p) => path.relative(root, p);

// 1. syntax (plain .js/.mjs via node --check; JSX is covered by the Vite build)
let syntax = 0;
for (const f of files.filter((x) => /\.(js|mjs)$/.test(x))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  syntax++;
  if (r.status !== 0) bad(`syntax ${rel(f)}\n${r.stderr}`);
}

// 2. relative imports resolve and named/default exports exist
const exportsOf = (p) => {
  const s = fs.readFileSync(p, 'utf8'); const out = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((x) => out.add(x.trim().split(/\s+as\s+/).pop()));
  if (/export\s+default/.test(s)) out.add('default');
  return out;
};
const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};
let imports = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s+([^'";]+?)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    imports++;
    const t = resolve(f, m[2]);
    if (!t) { bad(`unresolved import "${m[2]}" in ${rel(f)}`); continue; }
    if (!/\.(jsx?|mjs)$/.test(t)) continue;
    const ex = exportsOf(t);
    const named = (m[1].match(/\{([^}]+)\}/) || [])[1];
    if (named) for (const n of named.split(',')) { const nm = n.trim().split(/\s+as\s+/)[0]; if (nm && !ex.has(nm)) bad(`"${nm}" is not exported by ${rel(t)} (imported in ${rel(f)})`); }
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(m[1].trim()) && !ex.has('default')) bad(`${rel(t)} has no default export (imported in ${rel(f)})`);
  }
}

// 3. every `node <file>` target in package.json scripts exists
let targets = 0;
for (const pj of ['package.json', 'server/package.json', 'client/package.json']) {
  const j = JSON.parse(fs.readFileSync(path.join(root, pj), 'utf8'));
  for (const [name, cmd] of Object.entries(j.scripts ?? {})) {
    for (const m of cmd.matchAll(/node(?: --watch)? ([\w./-]+\.js)/g)) {
      targets++;
      if (!fs.existsSync(path.join(root, m[1]))) bad(`${pj} script "${name}" points to missing file ${m[1]}`);
    }
  }
}

// 4. required deliverables exist
for (const f of ['README.md', 'ENGINEERING_DECISIONS.md', '.env.example', '.gitignore', 'docker-compose.yml', 'database/migrations/001_init.sql']) {
  if (!fs.existsSync(path.join(root, f))) bad(`missing deliverable ${f}`);
}
if (fs.existsSync(path.join(root, '.env'))) bad('.env file present (must not be committed/zipped)');

console.log(`static-check: ${files.length} source files, ${syntax} syntax-checked, ${imports} relative imports, ${targets} script targets, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
