import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle; global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.__BUILD_STAMP__ = '2026-09-13 05:01';
dom.window.localStorage.setItem('playerarc.token', 'demo.1');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
const { AuthProvider } = await import('../src/lib/auth.jsx');
const { AppShell } = await import('../src/components/ui.jsx');

const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host);
await act(async () => { root.render(React.createElement(MemoryRouter, null,
  React.createElement(AuthProvider, null, React.createElement(AppShell, null, React.createElement('div'))))); });
for (let i=0;i<3;i++) await act(async()=>{await new Promise(r=>setTimeout(r,300));});
const m = host.textContent.match(/build [\d-]+ [\d:]+/);
console.log('sidebar shows:', m ? m[0] : 'STAMP MISSING');
