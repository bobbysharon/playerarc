import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle; global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true; global.__BUILD_STAMP__ = 'test';
dom.window.localStorage.setItem('playerarc.token', 'demo.1');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
const { AuthProvider } = await import('../src/lib/auth.jsx');
const Reports = (await import('../src/pages/Reports.jsx')).default;

const errors = [];
const realError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host);
try {
  await act(async () => { root.render(React.createElement(MemoryRouter, null,
    React.createElement(AuthProvider, null, React.createElement(Reports)))); });
  for (let i=0;i<4;i++) await act(async()=>{await new Promise(r=>setTimeout(r,350));});
} catch (e) {
  console.error = realError;
  console.log('THREW ON RENDER:', e.message);
}
console.error = realError;

console.log('rendered text:', host.textContent.replace(/\s+/g,' ').slice(0,160) || '(empty)');
const tabs = [...host.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean);
console.log('buttons:', tabs.slice(0,10).join(' | ') || '(none)');
if (errors.length) console.log('\nfirst error:\n' + errors[0].slice(0,600));

// Click each report tab and then build it, which is where the crash was reported.
const TABS = ['Player report','Team report','Tournament report','Sport report','Coach report'];
for (const label of TABS) {
  errors.length = 0;
  const tab = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  if (!tab) { console.log(`${label.padEnd(20)} tab missing`); continue; }
  let crashed = null;
  try {
    await act(async () => { tab.click(); });
    await act(async () => { await new Promise(r=>setTimeout(r,300)); });
    const build = [...host.querySelectorAll('button')].find(b => /Build report/.test(b.textContent));
    if (build) {
      await act(async () => { build.click(); });
      for (let i=0;i<3;i++) await act(async()=>{await new Promise(r=>setTimeout(r,300));});
    }
  } catch (e) { crashed = e.message; }
  const blank = host.textContent.trim().length < 40;
  const err = errors.find(e => /Error|Cannot|undefined is not|is not a function/.test(e));
  console.log(`${label.padEnd(20)} ${crashed ? 'THREW: '+crashed.slice(0,90) : blank ? 'BLANK' : 'ok'}${err && !crashed ? ' | console: '+err.slice(0,120) : ''}`);
}
