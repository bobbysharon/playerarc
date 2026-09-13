/**
 * Copies the built demo into docs/ so GitHub Pages can serve it with
 * "Deploy from a branch", which needs no workflow and no Actions permissions.
 *
 *   npm run build:pages     # build the demo and stage it
 *   git add docs && git commit && git push
 *
 * Then: Settings → Pages → Source "Deploy from a branch", Branch "main /docs".
 *
 * The reference documentation lives in docs/ too. The two do not collide:
 * Pages serves index.html for the site root, and .nojekyll stops GitHub
 * running the folder through Jekyll — which is what was rendering README.md.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web', 'dist');
const docs = join(root, 'docs');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[pages] web/dist is empty — run "npm run build:demo" first.');
  process.exit(1);
}

// Replace only the built output, leaving the written documentation in place.
const built = ['assets', 'index.html', '.nojekyll'];
for (const entry of built) {
  const target = join(docs, entry);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

mkdirSync(docs, { recursive: true });
for (const entry of readdirSync(dist)) {
  cpSync(join(dist, entry), join(docs, entry), { recursive: true });
}

// Without this, GitHub runs the folder through Jekyll, which ignores the
// assets directory and renders the markdown instead — the exact failure this
// script exists to avoid.
writeFileSync(join(docs, '.nojekyll'), '');

console.log('[pages] demo staged in docs/');
console.log('[pages] commit docs/ and set Pages to: Deploy from a branch → main → /docs');
