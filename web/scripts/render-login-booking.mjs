/** Renders the sign-in screen and walks the guest booking flow. */
import { createBrowser } from './harness.mjs';
const dom = createBrowser();

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { AuthProvider } = await import('../src/lib/auth.jsx');
const Login = (await import('../src/pages/Login.jsx')).default;
const GuestBooking = (await import('../src/pages/GuestBooking.jsx')).default;

const settle = async (n=3) => { for (let i=0;i<n;i++) await act(async()=>{await new Promise(r=>setTimeout(r,350));}); };
const mount = async (Page) => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(MemoryRouter, null,
    React.createElement(AuthProvider, null, React.createElement(Page)))); });
  await settle();
  return host;
};

const errors = []; const realError = console.error; console.error = (...a)=>errors.push(a.map(String).join(' '));

console.log('=== Sign-in screen ===');
const login = await mount(Login);
const text = login.textContent;
console.log('club name        :', /Karwan Sports Club/.test(text) ? 'yes' : 'NO');
console.log('athlete/staff    :', /Athlete/.test(text) && /Staff/.test(text) ? 'yes' : 'NO');
console.log('email or phone   :', /Email or phone/.test(text) ? 'yes' : 'NO');
console.log('forgot password  :', /Forgot password/.test(text) ? 'yes' : 'NO');
console.log('guest booking    :', /Book now as a guest/.test(text) ? 'yes' : 'NO');
console.log('no demo clutter  :', !/Karwan@2026|demonstration|Demo accounts/i.test(text) ? 'yes' : 'NO — still present');
console.log('length of copy   :', text.replace(/\s+/g,' ').trim().length, 'chars');

console.log('\n=== Guest booking ===');
const book = await mount(GuestBooking);
await settle(2);
const sportBtn = [...book.querySelectorAll('button')].find(b => /Cricket/.test(b.textContent));
console.log('lists sports     :', sportBtn ? 'yes' : 'NO');
await act(async () => { sportBtn.click(); }); await settle(2);
const groundBtn = [...book.querySelectorAll('button')].find(b => /Karwan Main Ground|Practice Nets/.test(b.textContent));
console.log('lists grounds    :', groundBtn ? 'yes' : 'NO');
await act(async () => { groundBtn.click(); }); await settle(3);
const slotBtn = [...book.querySelectorAll('button')].find(b => /^\d{2}:\d{2}/.test(b.textContent.trim()) && !b.disabled);
console.log('offers slots     :', slotBtn ? `yes (${slotBtn.textContent.trim().slice(0,5)})` : 'NO');
await act(async () => { slotBtn.click(); }); await settle(2);
const coachCard = [...book.querySelectorAll('button')].find(b => /year/.test(b.textContent) && /technique|bowling|conditioning|Batting/.test(b.textContent));
console.log('coach cards      :', coachCard ? 'yes' : 'NO');
if (coachCard) console.log('  card shows     :', coachCard.textContent.replace(/\s+/g,' ').trim().slice(0,70));
const skip = [...book.querySelectorAll('button')].find(b => /No coach, thanks/.test(b.textContent));
await act(async () => { skip.click(); }); await settle(2);
console.log('contact step     :', /Who is the booking for/.test(book.textContent) ? 'yes' : 'NO');
console.log('asks for athlete :', /athlete id|date of birth/i.test(book.textContent) ? 'YES — should not' : 'no');

console.error = realError;
const bad = errors.find(e=>/Cannot read|is not a function|TypeError/.test(e));
console.log('\nrender errors    :', bad ? bad.slice(0,150) : 'none');
