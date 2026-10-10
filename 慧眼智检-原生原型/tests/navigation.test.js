/* Keyboard regressions for the small-screen navigation; no browser dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let passed = 0;

function environment() {
  const listeners = {}, windowListeners = {}, classes = new Set();
  const media = { matches: true, addEventListener: (_, callback) => { media.changed = callback; } };
  const document = { title: '', baseURI: 'http://localhost:8765/', activeElement: null };
  function node(name, parent = null, attributes = {}) {
    return { name, parent, attributes, inert: false, disabled: false, offsetParent: {}, dataset: {},
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] ?? null; },
      focus() { document.activeElement = this; },
      contains(candidate) { for (let current = candidate; current; current = current.parent) if (current === this) return true; return false; },
      closest(selector) { if (selector === '[inert]') { for (let current = this; current; current = current.parent) if (current.inert) return current; } return null; }
    };
  }
  const sidebar = node('sidebar'), content = node('content'), menu = node('menu', content), main = node('main', content);
  const close = node('close', sidebar), logo = node('logo', sidebar), activeLink = node('active-link', sidebar), group = node('group', sidebar);
  group.dataset.key = 'detection';
  sidebar.querySelectorAll = () => [close, logo, activeLink, group];
  sidebar.querySelector = selector => selector.includes('active') ? activeLink : group;
  const app = { innerHTML: '' };
  let modal = null, drawer = null, closeModalCalls = 0, closeDrawerCalls = 0;
  Object.assign(document, {
    body: { classList: {
      toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
      add: name => classes.add(name), remove: name => classes.delete(name)
    } },
    getElementById: id => ({ app, 'primary-navigation': sidebar, 'main-content': main }[id] || null),
    querySelector: selector => selector === '.mobile-menu' ? menu : selector === '.app-shell' ? content : selector === '.modal' ? modal : selector === '.drawer' ? drawer : selector.includes('nav-group') ? group : null,
    querySelectorAll: () => [], addEventListener: (event, callback) => { listeners[event] = callback; }
  });
  const context = { console, URL, URLSearchParams, document, location: { hash: '#dashboard' },
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => JSON.stringify({ id: 'U001', name: '质量管理员', role: 'admin' }), setItem() {}, removeItem() {} },
    matchMedia: () => media, addEventListener: (event, callback) => { windowListeners[event] = callback; },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, scrollTo() {},
    requestAnimationFrame: callback => callback()
  };
  context.window = context; vm.createContext(context);
  for (const file of ['data.js', 'ui.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  const H = context.HY;
  H.UI.closeModal = () => { closeModalCalls++; modal = null; };
  H.UI.closeDrawer = () => { closeDrawerCalls++; drawer = null; };
  return { H, document, classes, sidebar, content, menu, main, close, activeLink, group, media, app,
    key(key, shiftKey = false) { const event = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } }; listeners.keydown(event); return event; },
    route(route) { context.location.hash = '#' + route; windowListeners.hashchange(); },
    resize(mobile) { media.matches = mobile; media.changed(); },
    dialog(kind) { const dialog = node(kind), first = node('dialog-first', dialog), last = node('dialog-last', dialog); dialog.querySelectorAll = () => [first, last]; if (kind === 'modal') modal = dialog; else drawer = dialog; return { dialog, first, last }; },
    closed: () => ({ modal: closeModalCalls, drawer: closeDrawerCalls })
  };
}

function test(name, run) {
  try { run(environment()); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
}

test('Closed mobile sidebar is inert and absent from the accessibility tree', e => {
  assert.equal(e.sidebar.inert, true);
  assert.equal(e.sidebar.getAttribute('aria-hidden'), 'true');
  assert.equal(e.menu.getAttribute('aria-expanded'), 'false');
  assert.equal(e.content.inert, false);
  assert.ok(e.app.innerHTML.includes('aria-controls="primary-navigation"'));
});

test('Opening navigation exposes it, blocks background focus and focuses the current route', e => {
  e.H.Actions['nav-toggle']();
  assert.equal(e.sidebar.inert, false);
  assert.equal(e.sidebar.getAttribute('aria-hidden'), 'false');
  assert.equal(e.content.inert, true);
  assert.equal(e.menu.getAttribute('aria-expanded'), 'true');
  assert.equal(e.document.activeElement, e.activeLink);
});

test('Tab and Shift+Tab wrap within the open mobile navigation', e => {
  e.H.Actions['nav-toggle'](); e.group.focus();
  assert.equal(e.key('Tab').prevented, true); assert.equal(e.document.activeElement, e.close);
  assert.equal(e.key('Tab', true).prevented, true); assert.equal(e.document.activeElement, e.group);
});

test('Escape closes navigation and restores the menu button', e => {
  e.H.Actions['nav-toggle'](); assert.equal(e.key('Escape').prevented, true);
  assert.equal(e.sidebar.inert, true); assert.equal(e.content.inert, false);
  assert.equal(e.menu.getAttribute('aria-expanded'), 'false'); assert.equal(e.document.activeElement, e.menu);
});

test('An active modal takes priority over navigation trapping and Escape', e => {
  e.H.Actions['nav-toggle'](); const dialog = e.dialog('modal'); dialog.last.focus();
  e.key('Tab'); assert.equal(e.document.activeElement, dialog.first);
  e.key('Escape'); assert.equal(e.closed().modal, 1); assert.equal(e.closed().drawer, 0);
  assert.equal(e.menu.getAttribute('aria-expanded'), 'true');
});

test('An active drawer takes priority over navigation trapping', e => {
  e.H.Actions['nav-toggle'](); const dialog = e.dialog('drawer'); dialog.first.focus();
  e.key('Tab', true); assert.equal(e.document.activeElement, dialog.last);
  e.key('Escape'); assert.equal(e.closed().drawer, 1);
  assert.equal(e.menu.getAttribute('aria-expanded'), 'true');
});

test('Route changes close navigation and focus the destination main content', e => {
  e.H.Actions['nav-toggle'](); e.route('monitor');
  assert.equal(e.sidebar.inert, true); assert.equal(e.content.inert, false);
  assert.equal(e.document.activeElement, e.main); assert.equal(e.menu.getAttribute('aria-expanded'), 'false');
});

test('Resizing restores desktop navigation and prevents hidden mobile focus', e => {
  e.H.Actions['nav-toggle'](); e.resize(false);
  assert.equal(e.sidebar.inert, false); assert.equal(e.content.inert, false);
  assert.equal(e.menu.getAttribute('aria-expanded'), 'false'); assert.equal(e.document.activeElement, e.activeLink);
  e.resize(true); assert.equal(e.sidebar.inert, true); assert.equal(e.document.activeElement, e.menu);
});

test('Expanding a navigation group retains keyboard focus after rendering', e => {
  e.H.Actions['nav-toggle'](); e.group.focus(); e.H.Actions['nav-group'](e.group);
  assert.equal(e.document.activeElement, e.group); assert.equal(e.menu.getAttribute('aria-expanded'), 'true');
});

console.log(`${passed}/9 navigation regressions passed.`);
