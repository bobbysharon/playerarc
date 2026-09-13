/**
 * Mounts the Development pages in a real DOM and clicks their primary action
 * buttons, to reproduce "Log session / Record assessment / New award is not
 * working" rather than reading the source and guessing.
 *
 *   node web/scripts/interaction-test.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
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

// Sign the demo session in so the pages have a user and permissions.
const demo = await import('../src/demo/api.js');
await demo.demoRequest('POST', '/auth/login', {
  email: 'admin@playerarc.local',
  password: 'Karwan@2026',
});

const { AuthProvider } = await import('../src/lib/auth.jsx');

const pages = {
  Training: (await import('../src/pages/Training.jsx')).default,
  Assessments: (await import('../src/pages/Assessments.jsx')).default,
  Achievements: (await import('../src/pages/Achievements.jsx')).default,
};

const settle = async (ms = 400) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };

for (const [name, Page] of Object.entries(pages)) {
  errors.length = 0;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      React.createElement(MemoryRouter, null,
        React.createElement(AuthProvider, null, React.createElement(Page))),
    );
  });
  await settle(600);

  const buttons = [...host.querySelectorAll('button')].map((b) => b.textContent.trim());
  const action = [...host.querySelectorAll('button')].find((b) =>
    /Log session|Record assessment|Record award/.test(b.textContent));

  // Scope every query to the dialog, so the page's own filter controls behind
  // the overlay are never mistaken for form fields.
  const dialog = () => host.querySelector('.fixed') || host;
  const pickFirstAthlete = async () => {
    const row = [...dialog().querySelectorAll('ul button')].find((b) => /KSC-PLY/.test(b.textContent));
    if (row) { await act(async () => { row.click(); }); await settle(250); }
    return !!row;
  };

  if (!action) {
    console.log(`${name.padEnd(14)} NO ACTION BUTTON RENDERED. buttons: ${JSON.stringify(buttons.slice(0, 8))}`);
  } else {
    await act(async () => { action.click(); });
    await settle(300);
    const dialogOpen = !!host.querySelector('.fixed');

    // Before filling anything in, the submit must be blocked *and* say why —
    // a dead button with no explanation is the bug being fixed here.
    const emptySubmit = [...dialog().querySelectorAll('button[type="submit"]')][0];
    const hint = (dialog().textContent.match(/Choose an athlete[^.]*\.|Choose a sport[^.]*\.|Score at least[^.]*\.|Give the award[^.]*\./) || [])[0];
    console.log(`${name.padEnd(14)} empty form: submit ${emptySubmit?.disabled ? 'blocked' : 'ENABLED (bad)'} · reason shown: ${hint ? `"${hint}"` : 'NONE (bad)'}`);

    // Complete the form the way a user would, then submit.
    if (name !== 'Training') await pickFirstAthlete();
    if (name === 'Training') {
      const sportSelect = [...dialog().querySelectorAll('select')].find((sel) =>
        [...sel.options].some((o) => /Cricket/.test(o.textContent)));
      if (sportSelect) {
        const option = [...sportSelect.options].find((o) => /Cricket/.test(o.textContent));
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sportSelect, option.value);
          sportSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        await settle(250);
      }
    }
    if (name === 'Assessments') {
      await settle(400);   // criteria load once the sport is known
      const score = [...dialog().querySelectorAll('input[type="number"]')].find((i) => i.placeholder);
      if (score) {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
          setter.call(score, '7');
          score.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await settle(200);
      }
    }
    if (name === 'Achievements') {
      const title = [...dialog().querySelectorAll('input')].find((i) => !i.placeholder?.includes('Search') && i.type !== 'date' && i.type !== 'number');
      if (title) {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
          setter.call(title, 'Player of the Season');
          title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await settle(200);
      }
    }

    if (process.env.DEBUG_PAGE === name) {
      const d = dialog();
      console.log('  fields:', [...d.querySelectorAll('input,select')]
        .map((i) => `${i.tagName}:${i.type || 'select'}${i.placeholder ? `(${i.placeholder})` : ''}`).join(', '));
      console.log('  hint:', (d.textContent.match(/Choose an athlete[^.]*\.|Choose a sport[^.]*\.|Score at least[^.]*\./) || ['none'])[0]);
    }
    const submit = [...dialog().querySelectorAll('button[type="submit"]')][0];
    const before = host.textContent;
    let saved = false;
    if (submit && !submit.disabled) {
      await act(async () => { submit.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      await settle(500);
      saved = !host.querySelector('.fixed');
      if (!saved) {
        const msg = dialog().textContent.match(/(Some fields need attention[^]{0,200}|Score at least[^.]*\.|[A-Z][^.]{5,120}(?:required|incorrect|exist|attention)[^.]*\.)/);
        console.log(`  ↳ blocked by: ${msg ? msg[0].trim().slice(0, 180) : 'no visible message'}`);
        const sub = [...dialog().querySelectorAll('button[type="submit"]')][0];
        console.log(`  ↳ submit now: ${sub ? (sub.disabled ? 'disabled' : 'enabled') : 'gone'} "${sub?.textContent.trim()}"`);
        console.log(`  ↳ tail: ${dialog().textContent.slice(-220).replace(/\s+/g, ' ')}`);
      }
    }
    console.log(
      `${name.padEnd(14)} modal ${dialogOpen ? 'opens' : 'DID NOT OPEN'}`
      + (submit ? ` · submit ${submit.disabled ? 'STILL DISABLED' : 'enabled'}` : ' · no submit')
      + ` · saved: ${saved ? 'YES' : 'no'}`,
    );
  }
  if (errors.length) console.log(`  ↳ console errors: ${errors.slice(0, 2).join(' | ').slice(0, 300)}`);

  await act(async () => { root.unmount(); });
  host.remove();
}
console.error = originalError;
