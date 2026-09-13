/**
 * Shared browser harness for rendering pages outside a browser.
 *
 * One detail matters more than it looks. The app calls `fetch('/api/...')`
 * with a relative path, which a browser resolves against the page origin but
 * Node's fetch rejects outright. Without the shim below, every request from a
 * rendered page fails instantly and the page renders its empty state — which
 * looks like a pass. A test written on top of that proves nothing.
 */
import { JSDOM } from 'jsdom';

export function createBrowser({ origin = 'http://localhost:4000' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `${origin}/`, pretendToBeVisual: true,
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

  // Resolve relative request paths the way a browser would.
  const nodeFetch = global.fetch;
  global.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) return nodeFetch(origin + input, init);
    return nodeFetch(input, init);
  };

  return dom;
}

/** Sign in against a live server and store the token where the app looks. */
export async function signIn(dom, { origin = 'http://localhost:4000', email, password }) {
  const res = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`Sign-in failed: ${JSON.stringify(body)}`);
  dom.window.localStorage.setItem('playerarc.token', body.token);
  return body;
}
