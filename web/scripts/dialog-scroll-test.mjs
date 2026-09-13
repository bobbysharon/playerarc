/**
 * Checks the scrolling contract of the dialog, for every form that has one.
 *
 * jsdom has no layout engine, so height cannot be measured here. What can be
 * checked is the structure that makes scrolling work at all:
 *
 *   - the panel is height-capped, so it cannot grow past the viewport
 *   - its body is a flex child with `min-h-0`, which is what lets it shrink
 *     and therefore scroll instead of overflowing invisibly
 *   - the submit button lives inside that scrolling body, so it is reachable
 *   - the title bar does not, so it stays pinned while the form scrolls
 *
 * The bug this guards against looked like a frozen dialog: the form rendered,
 * the submit button existed, and there was no way to reach it.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.__BUILD_STAMP__ = 'test';
dom.window.localStorage.setItem('playerarc.token', 'demo.1');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');

const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST', '/auth/login', { email: 'admin@playerarc.local', password: 'Karwan@2026' });
const { AuthProvider } = await import('../src/lib/auth.jsx');

const PAGES = {
  Training: ['../src/pages/Training.jsx', /Log session/],
  Assessments: ['../src/pages/Assessments.jsx', /Record assessment/],
  Achievements: ['../src/pages/Achievements.jsx', /Record award/],
  Drills: ['../src/pages/Drills.jsx', /Add drill/],
  Announcements: ['../src/pages/Announcements.jsx', /New announcement/],
};

const settle = async (ms = 400) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let failures = 0;

for (const [name, [path, buttonPattern]] of Object.entries(PAGES)) {
  const Page = (await import(path)).default;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthProvider, null, React.createElement(Page))));
  });
  await settle(600);

  const open = [...host.querySelectorAll('button')].find((b) => buttonPattern.test(b.textContent));
  if (!open) { console.log(`${name.padEnd(14)} no action button found`); failures += 1; continue; }

  await act(async () => { open.click(); });
  await settle(400);

  const dialog = host.querySelector('[role="dialog"]');
  if (!dialog) { console.log(`${name.padEnd(14)} dialog did not open`); failures += 1; continue; }

  // The cap now lives in a stylesheet rule, so the contract is the class.
  const capped = /\bmodal-panel\b/.test(dialog.className);
  const body = [...dialog.children].find((el) => el.className.includes('overflow-y-auto'));
  const shrinkable = !!body && body.className.includes('min-h-0') && body.className.includes('flex-1');
  const submit = dialog.querySelector('button[type="submit"]') || dialog.querySelector('button.btn-gold');
  const submitInsideScroller = !!(body && submit && body.contains(submit));
  const header = dialog.querySelector('header');
  const headerPinned = !!(body && header && !body.contains(header));

  const ok = capped && shrinkable && submitInsideScroller && headerPinned;
  if (!ok) failures += 1;

  console.log(
    `${name.padEnd(14)} ${ok ? 'OK  ' : 'FAIL'}`
    + ` · panel capped ${capped ? 'yes' : 'NO'}`
    + ` · body shrinkable ${shrinkable ? 'yes' : 'NO'}`
    + ` · submit reachable ${submitInsideScroller ? 'yes' : 'NO'}`
    + ` · title pinned ${headerPinned ? 'yes' : 'NO'}`,
  );

  await act(async () => { root.unmount(); });
  host.remove();
}

console.log(failures ? `\n${failures} dialog(s) failed the scrolling contract.` : '\nEvery dialog scrolls and its submit button is reachable.');
process.exitCode = failures ? 1 : 0;
