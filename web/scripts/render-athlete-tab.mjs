/** Confirms the Athlete logins tab renders and its actions are wired. */
import { createBrowser, signIn } from './harness.mjs';

const dom = createBrowser();
await signIn(dom, { email: 'admin@playerarc.local', password: 'Karwan@2026' });

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { AuthProvider } = await import('../src/lib/auth.jsx');
const UserManager = (await import('../src/pages/UserManager.jsx')).default;

const errors = []; const realError = console.error; console.error = (...a) => errors.push(a.map(String).join(' '));
const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host);
await act(async () => { root.render(React.createElement(MemoryRouter, null,
  React.createElement(AuthProvider, null, React.createElement(UserManager)))); });
const settle = async (n=4) => { for (let i=0;i<n;i++) await act(async()=>{await new Promise(r=>setTimeout(r,350));}); };
await settle();

const tabs = [...host.querySelectorAll('button')].map(b=>b.textContent.trim());
console.log('tabs:', tabs.filter(t=>/Accounts|Roles|Athlete logins/.test(t)).join(' | '));

const tab = [...host.querySelectorAll('button')].find(b => /Athlete logins/.test(b.textContent));
if (!tab) { console.log('ATHLETE TAB MISSING'); console.log('rendered:', host.textContent.replace(/\s+/g,' ').slice(0,300)); process.exit(1); }
await act(async () => { tab.click(); });
await settle(3);

const text = host.textContent;
console.log('shows the separation note :', /cannot be turned into a coach/.test(text) ? 'yes' : 'NO');
console.log('lists athlete logins      :', /athlete\.playerarc\.local/.test(text) ? 'yes' : 'NO');
console.log('issue button present      :', [...host.querySelectorAll('button')].some(b=>/Issue login/.test(b.textContent)) ? 'yes' : 'NO');
const issue = [...host.querySelectorAll('button')].find(b=>/Issue login/.test(b.textContent));
await act(async () => { issue.click(); }); await settle(2);
const dialog = host.querySelector('[role="dialog"]');
console.log('issue dialog opens        :', dialog ? 'yes' : 'NO');
console.log('dialog scrolls            :', dialog && [...dialog.children].some(c=>c.className.includes('min-h-0')) ? 'yes' : 'NO');
console.error = realError;
const bad = errors.find(e=>/Cannot read|is not a function|TypeError/.test(e));
console.log('render errors             :', bad ? bad.slice(0,140) : 'none');
console.log('\n--- rendered ---');
console.log(host.textContent.replace(/\s+/g,' ').slice(0,300));
