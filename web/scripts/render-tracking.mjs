/**
 * Renders the ball-tracking screen against the demo dataset and checks the
 * graphics actually drew — a build passing only proves it compiles.
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
dom.window.localStorage.setItem('playerarc.token', 'demo.1');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');

const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST', '/auth/login', { email: 'admin@playerarc.local', password: 'Karwan@2026' });

const { AuthProvider } = await import('../src/lib/auth.jsx');
const Tracking = (await import('../src/pages/Tracking.jsx')).default;

const errors = [];
const realError = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };

const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(React.createElement(MemoryRouter, null,
    React.createElement(AuthProvider, null, React.createElement(Tracking))));
});
// Two settles: the session list loads first, then the selected session's
// deliveries are fetched off the back of it.
for (let i = 0; i < 4; i += 1) {
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
}

console.error = realError;

const svgs = host.querySelectorAll('svg');
const circles = host.querySelectorAll('circle');
const text = host.textContent;

console.log(`panels drawn:      ${host.querySelectorAll('.hud-panel').length}`);
console.log(`svg graphics:      ${svgs.length}`);
console.log(`plotted points:    ${circles.length}`);
console.log(`speed dial:        ${/RELEASE SPEED/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`consistency ring:  ${/IN ZONE/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`stump tower:       ${/AT THE STUMPS/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`pitch view:        ${/WHERE IT PITCHED/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`zone grid:         ${/ZONE GRID/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`calibration:       ${/SCENE CALIBRATION/i.test(text) ? 'present' : 'MISSING'}`);
console.log(`bowler cards:      ${/CONSISTENCY/i.test(text) ? 'present' : 'MISSING'}`);

// Focusing a bowler must re-read the panels.
const bowlerCard = [...host.querySelectorAll('button')].find((b) => /balls/.test(b.textContent) && /Consistency/.test(b.textContent));
if (bowlerCard) {
  const before = host.querySelectorAll('circle').length;
  await act(async () => { bowlerCard.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  const after = host.querySelectorAll('circle').length;
  console.log(`bowler filter:     ${after < before ? `re-read (${before} → ${after} points)` : 'NO CHANGE'}`);
}

console.log(`console errors:    ${errors.length ? errors.slice(0, 2).join(' | ').slice(0, 220) : 'none'}`);
console.log('\n--- rendered text ---');
console.log(host.textContent.replace(/\s+/g, ' ').slice(0, 400));
