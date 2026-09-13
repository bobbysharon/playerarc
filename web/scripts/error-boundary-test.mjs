/**
 * A page that throws must not take the application down with it.
 *
 * Before the boundary existed, a render error unmounted the whole tree: blank
 * screen, no sidebar, no way back. This mounts a component that throws on
 * purpose and checks the shell survives and the navigation is still there.
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
const { AppShell } = await import('../src/components/ui.jsx');
const PageErrorBoundary = (await import('../src/components/PageErrorBoundary.jsx')).default;

function Exploding() {
  throw new TypeError("Cannot read properties of undefined (reading 'name')");
}

const swallowed = [];
const realError = console.error;
console.error = (...a) => { swallowed.push(a.map(String).join(' ')); };

const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);

await act(async () => {
  root.render(
    React.createElement(MemoryRouter, null,
      React.createElement(AuthProvider, null,
        React.createElement(AppShell, null,
          React.createElement(PageErrorBoundary, { routeKey: '/reports' },
            React.createElement(Exploding))))),
  );
});
for (let i = 0; i < 3; i += 1) {
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
}
console.error = realError;

const text = host.textContent;
const navLinks = host.querySelectorAll('a[href]').length;
const shellAlive = navLinks > 3;
const message = /ran into a problem/.test(text);
const detail = /Cannot read properties of undefined/.test(text);
const retry = [...host.querySelectorAll('button')].some((b) => /Try again/.test(b.textContent));

console.log(`app survived the crash : ${shellAlive ? `yes (${navLinks} nav links still present)` : 'NO — page blanked'}`);
console.log(`explains what happened : ${message ? 'yes' : 'NO'}`);
console.log(`shows the error detail  : ${detail ? 'yes' : 'NO'}`);
console.log(`offers a way to recover : ${retry ? 'yes' : 'NO'}`);

const ok = shellAlive && message && detail && retry;
console.log(ok ? '\nA failing page no longer strands the user.' : '\nThe boundary is not doing its job.');
process.exitCode = ok ? 0 : 1;
