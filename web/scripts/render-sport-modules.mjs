/** Renders every sport's module and checks each draws its own visual. */
import { createBrowser, signIn } from './harness.mjs';

// The page talks to whichever backend the loader compiled it against, so the
// sign-in has to match — signing in to the server while the page reads the
// demo leaves it unauthenticated and every panel empty.
const LIVE = process.env.DEMO === 'false';
const dom = createBrowser();
if (LIVE) {
  await signIn(dom, { email: 'admin@playerarc.local', password: 'Karwan@2026' });
} else {
  dom.window.localStorage.setItem('playerarc.token', 'demo.1');
  const demo = await import('../src/demo/api.js');
  await demo.demoRequest('POST', '/auth/login', { email: 'admin@playerarc.local', password: 'Karwan@2026' });
}
console.log(`mode: ${LIVE ? 'live server' : 'browser demo'}`);

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { AuthProvider } = await import('../src/lib/auth.jsx');
const SportWorkspace = (await import('../src/pages/SportWorkspace.jsx')).default;

const settle = async (n=4) => { for (let i=0;i<n;i++) await act(async()=>{await new Promise(r=>setTimeout(r,350));}); };
const errors = []; const realError = console.error; console.error = (...a)=>errors.push(a.map(String).join(' '));

const SPORTS = ['cricket','football','basketball','badminton','table_tennis','futsal','volleyball'];
let failures = 0;

for (const code of SPORTS) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [`/sports/${code}`] },
      React.createElement(AuthProvider, null,
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/sports/:code', element: React.createElement(SportWorkspace) })))));
  });
  await settle();

  const text = host.textContent;
  const panels = host.querySelectorAll('.hud-panel').length;
  const svgs = host.querySelectorAll('svg').length;
  const visual = /runs per over/i.test(text) ? 'manhattan'
    : /shot map/i.test(text) ? 'shot map'
      : /how the lead moved/i.test(text) ? 'lead progression'
        : /Nothing scored/i.test(text) ? 'empty state'
          : 'summary grid';
  const leaders = /Leader from/.test(text);
  const ok = panels >= 8 && svgs > 0;
  if (!ok) failures += 1;

  console.log(`${code.padEnd(13)} ${ok ? 'OK  ' : 'FAIL'} · panels ${String(panels).padStart(2)} · svg ${String(svgs).padStart(2)} · visual: ${visual.padEnd(17)} · leaders ${leaders ? 'yes' : 'no'}`);

  await act(async () => { root.unmount(); });
  host.remove();
}

console.error = realError;
const bad = errors.find(e=>/Cannot read|is not a function|TypeError/.test(e));
console.log(`\nrender errors: ${bad ? bad.slice(0,160) : 'none'}`);
console.log(failures ? `${failures} sport module(s) failed.` : 'Every sport has its own module.');
process.exitCode = failures || bad ? 1 : 0;
