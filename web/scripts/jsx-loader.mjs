import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

// Vite resolves extensionless relative imports and injects import.meta.env;
// Node does neither, so this loader stands in for it when rendering a page
// outside the browser.
export async function resolve(spec, context, next) {
  if (spec.startsWith('.') && !/\.(jsx?|json|css)$/.test(spec)) {
    for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
      try {
        const found = await next(spec + ext, context);
        if (found) return found;
      } catch { /* try the next extension */ }
    }
  }
  return next(spec, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.jsx') || (url.includes('/src/') && url.endsWith('.js'))) {
    const raw = readFileSync(fileURLToPath(url), 'utf8')
      // DEMO=false runs the pages against a live server instead of the
      // in-browser demo, which is the combination a real deployment uses.
      .replace(/import\.meta\.env/g,
        `({ VITE_DEMO_MODE: "${process.env.DEMO === 'false' ? 'false' : 'true'}", VITE_BASE: "/" })`);
    const { code } = transformSync(raw, { loader: 'jsx', format: 'esm', jsx: 'automatic' });
    return { format: 'module', source: code, shortCircuit: true };
  }
  if (url.endsWith('.json')) {
    return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}`, shortCircuit: true };
  }
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true };
  return next(url, context);
}
