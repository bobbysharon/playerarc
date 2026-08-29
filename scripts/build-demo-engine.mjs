/**
 * The browser demo runs the same statistics and permission logic as the server.
 *
 * Rather than maintaining a second copy by hand — which would drift the first
 * time a rating formula changed — this script mechanically converts the server
 * modules from CommonJS to ES modules and writes them into web/src/demo/engine/.
 * The server remains the single source of truth.
 *
 *   node scripts/build-demo-engine.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'server', 'src', 'lib');
const target = join(root, 'web', 'src', 'demo', 'engine');

const MODULES = ['formula.js', 'stats-engine.js', 'permissions.js'];

const HEADER = `/* AUTO-GENERATED — do not edit.
 * Converted from server/src/lib/%NAME% by scripts/build-demo-engine.mjs.
 * Edit the server module and re-run: npm run demo:build
 */
`;

mkdirSync(target, { recursive: true });

for (const name of MODULES) {
  let code = readFileSync(join(source, name), 'utf8');

  code = code
    .replace(/^'use strict';\n/m, '')
    // const { a, b } = require('./x');  ->  import { a, b } from './x.js';
    .replace(/const\s+\{([^}]+)\}\s*=\s*require\('(\.[^']+)'\);/g, (m, names, path) => {
      const file = path.endsWith('.js') ? path : `${path}.js`;
      return `import {${names}} from '${file}';`;
    })
    // module.exports = { a, b };  ->  export { a, b };
    .replace(/module\.exports\s*=\s*\{([\s\S]*?)\};\s*$/m, (m, names) => `export {${names}};`);

  if (/require\(|module\.exports/.test(code)) {
    console.error(`[demo-engine] ${name} still contains CommonJS after conversion — check the patterns.`);
    process.exit(1);
  }

  writeFileSync(join(target, name), HEADER.replace('%NAME%', name) + code);
  console.log(`[demo-engine] web/src/demo/engine/${name}`);
}
