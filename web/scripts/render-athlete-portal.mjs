/**
 * Signs in as an athlete through the actual login form and checks the portal
 * they land on. Runs against the demo by default and the live server with
 * DEMO=false, because this fault only existed in one of them.
 */
import { createBrowser } from './harness.mjs';
const LIVE = process.env.DEMO === 'false';
const dom = createBrowser();

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { AuthProvider } = await import('../src/lib/auth.jsx');
const Login = (await import('../src/pages/Login.jsx')).default;
const AthletePortal = (await import('../src/pages/AthletePortal.jsx')).default;

// Find an athlete login to test with.
let email;
if (LIVE) {
  const admin = await (await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@playerarc.local', password: 'Karwan@2026' }),
  })).json();
  const list = await (await fetch('http://localhost:4000/api/admin/athlete-logins', {
    headers: { Authorization: `Bearer ${admin.token}` },
  })).json();
  email = list.logins.find((l) => l.status === 'active').email;
} else {
  const demo = await import('../src/demo/api.js');
  await demo.demoRequest('POST', '/auth/login', { email: 'admin@playerarc.local', password: 'Karwan@2026' });
  const list = await demo.demoRequest('GET', '/admin/athlete-logins');
  email = list.logins.find((l) => l.status === 'active').email;
}
console.log(`mode: ${LIVE ? 'live server' : 'browser demo'} · signing in as ${email}`);

const errors = []; const realError = console.error; console.error = (...a) => errors.push(a.map(String).join(' '));
const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host);

await act(async () => {
  root.render(React.createElement(MemoryRouter, { initialEntries: ['/login'] },
    React.createElement(AuthProvider, null,
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/login', element: React.createElement(Login) }),
        React.createElement(Route, { path: '/my', element: React.createElement(AthletePortal) })))));
});
const settle = async (n = 3) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); };
await settle();

// Fill the athlete tab of the login form.
const setInput = async (el, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const inputs = host.querySelectorAll('input');
await setInput(inputs[0], email);
await setInput(inputs[1], 'Karwan@2026');

const submit = [...host.querySelectorAll('button')].find((b) => /Log in/.test(b.textContent));
await act(async () => { submit.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
await settle(5);

console.error = realError;
const text = host.textContent;
const failed = /No route matches|incorrect|not valid/.test(text);

console.log(`sign-in succeeded    : ${failed ? `NO — ${(text.match(/No route matches[^A-Z]*|[A-Z][^.]*incorrect[^.]*/) || [''])[0].slice(0, 60)}` : 'yes'}`);
console.log(`landed on the portal : ${/Athlete portal/.test(text) ? 'yes' : 'NO'}`);
console.log(`shows their own name : ${/KSC-PLY-\d+/.test(text) ? 'yes' : 'NO'}`);
console.log(`tabs present         : ${/My record/.test(text) && /Coming up/.test(text) && /Training/.test(text) ? 'yes' : 'NO'}`);
console.log(`sign out present     : ${[...host.querySelectorAll('button')].some((b) => /Sign out/.test(b.textContent)) ? 'yes' : 'NO'}`);
console.log(`no staff navigation  : ${!/Ball tracking|User manager|Drill library/.test(text) ? 'yes' : 'NO — staff links leaked'}`);
const bad = errors.find((e) => /Cannot read|is not a function|TypeError/.test(e));
console.log(`render errors        : ${bad ? bad.slice(0, 140) : 'none'}`);
