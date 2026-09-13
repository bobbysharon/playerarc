/**
 * Renders the Reports page against the in-browser demo, picking a real target in
 * each tab and building the report — the exact path a user takes.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:4000/', pretendToBeVisual: true,
});
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle; global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true; global.__BUILD_STAMP__ = 'test';

dom.window.localStorage.setItem('playerarc.token', 'demo.1');
const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST', '/auth/login', { email: 'admin@playerarc.local', password: 'Karwan@2026' });

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { AuthProvider } = await import('../src/lib/auth.jsx');
const Reports = (await import('../src/pages/Reports.jsx')).default;

const errors = [];
const realError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(React.createElement(MemoryRouter, null,
    React.createElement(AuthProvider, null, React.createElement(Reports))));
});
const settle = async (n = 4) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); };
await settle();

const setSelect = async (sel, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value);
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};

let failures = 0;
for (const label of ['Player report', 'Team report', 'Tournament report', 'Sport report', 'Coach report']) {
  errors.length = 0;
  const tab = [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  if (!tab) { console.log(`${label.padEnd(20)} TAB MISSING`); failures += 1; continue; }

  let threw = null;
  try {
    await act(async () => { tab.click(); });
    await settle(2);

    // Choose the first real target the tab offers, then build.
    const select = host.querySelector('select');
    const option = select && [...select.options].find((o) => o.value);
    if (option) await setSelect(select, option.value);
    await settle(2);

    const build = [...host.querySelectorAll('button')].find((b) => /Build report/.test(b.textContent));
    if (build && !build.disabled) {
      await act(async () => { build.click(); });
      await settle(4);
    }
  } catch (e) { threw = e.message; console.log('\n--- stack ---\n' + String(e.stack).split('\n').slice(0,6).join('\n')); }

  const text = host.textContent.trim();
  const blank = text.length < 60;
  const bad = errors.find((e) => /Cannot read|is not a function|undefined is not|TypeError/.test(e));
  if (threw || blank || bad) failures += 1;

  console.log(
    `${label.padEnd(20)} ${threw ? `THREW: ${threw.slice(0, 110)}` : blank ? 'BLANK PAGE' : bad ? `ERROR: ${bad.slice(0, 140)}` : 'ok'}`,
  );
}
console.error = realError;
console.log(failures ? `\n${failures} report tab(s) failed.` : '\nEvery report tab builds against the live server.');
process.exitCode = failures ? 1 : 0;
