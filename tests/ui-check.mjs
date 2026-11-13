import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3000';
const CDP = 'http://127.0.0.1:9222';
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });

const until = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('•', ...args);

async function api(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload;
}

async function getPageTarget() {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  return targets.find((target) => target.type === 'page');
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.consoleErrors = [];
    this.requests = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
        if (message.method === 'Runtime.exceptionThrown') {
          this.consoleErrors.push(
            `EXCEPTION: ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`,
          );
        }
        if (
          message.method === 'Runtime.consoleAPICalled' &&
          ['error', 'warning', 'assert'].includes(message.params.type)
        ) {
          this.consoleErrors.push(
            `CONSOLE ${message.params.type}: ${message.params.args.map((arg) => arg.value || arg.description || '').join(' ')}`,
          );
        }
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
          this.consoleErrors.push(
            `LOG: ${message.params.entry.text}${message.params.entry.url ? ` @ ${message.params.entry.url}` : ''}`,
          );
        }
        if (message.method === 'Network.requestWillBeSent') {
          this.requests.set(message.params.requestId, message.params.request.url);
        }
        if (
          message.method === 'Network.responseReceived' &&
          message.params.response.status >= 400
        ) {
          this.consoleErrors.push(
            `HTTP ${message.params.response.status}: ${message.params.response.url}`,
          );
        }
        if (message.method === 'Network.loadingFailed') {
          const url = this.requests.get(message.params.requestId) || '';
          if (!url.includes('/events')) {
            this.consoleErrors.push(
              `NETWORK FAILED (${message.params.errorText}): ${url}`,
            );
          }
        }
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  async screenshot(name, fullPage = false) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: fullPage,
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    log(`截图 ${file}`);
  }

  async navigate(url, wait = 1600) {
    await this.send('Page.navigate', { url });
    await until(wait);
  }
}

async function main() {
  const target = await getPageTarget();
  if (!target) throw new Error('没有可用的 Chrome page target');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Fresh landing desktop.
  await cdp.navigate(`${BASE}/?fresh=1`, 1000);
  await cdp.evaluate('localStorage.clear()');
  await cdp.send('Page.reload');
  await until(1300);
  cdp.consoleErrors.length = 0;
  log('landing title:', await cdp.evaluate('document.title'));
  log('landing h1:', await cdp.evaluate("document.querySelector('.hero h1')?.innerText"));
  await cdp.screenshot('01-landing.png', true);

  // Prepare demo data through the public API, before logging into the UI.
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123', portal: 'admin' },
  });
  const stamp = Date.now().toString().slice(-5);
  const username = `uicheck${stamp}`;
  await api('/api/admin/users', {
    method: 'POST',
    token: adminLogin.token,
    body: {
      username,
      displayName: '夜游神',
      password: 'uicheck123',
      role: 'player',
    },
  });
  const playerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'uicheck123', portal: 'game' },
  });
  const created = await api('/api/rooms', {
    method: 'POST',
    token: playerLogin.token,
    body: { name: '深水埗夜局', maxPlayers: 4 },
  });
  await api(`/api/rooms/${created.room.code}/bots`, {
    method: 'POST',
    token: playerLogin.token,
    body: { count: 3 },
  });
  log('demo room:', created.room.code);

  // Login page and real form-based admin login.
  await cdp.navigate(`${BASE}/?view=login#/login/admin`, 1000);
  await cdp.screenshot('02-admin-login.png');
  await cdp.evaluate(`
    document.querySelector('#login-username').value = 'admin';
    document.querySelector('#login-password').value = 'admin123';
    document.querySelector('form[data-form="login"]').requestSubmit();
  `);
  await until(2100);
  log('admin title:', await cdp.evaluate('document.title'));
  log('admin heading:', await cdp.evaluate("document.querySelector('.admin-topbar h1')?.innerText"));
  await cdp.screenshot('03-admin-overview.png', true);

  await cdp.evaluate("document.querySelector('[data-action=\"admin-tab\"][data-tab=\"users\"]')?.click()");
  await until(900);
  await cdp.screenshot('04-admin-users.png', true);

  // Admin modal visuals.
  await cdp.evaluate("document.querySelector('[data-action=\"admin-add-user\"]')?.click()");
  await until(500);
  await cdp.screenshot('05-admin-create-user.png');
  await cdp.evaluate(`
    const form = document.querySelector('form[data-form="admin-create-user"]');
    form.elements.username.value = 'modaltest${stamp}';
    form.elements.displayName.value = '弹窗测试';
    form.elements.password.value = 'modal1234';
    form.requestSubmit();
  `);
  await until(1200);
  log(
    'admin create via modal:',
    await cdp.evaluate("document.querySelector('#admin-user-rows')?.innerText.includes('弹窗测试')"),
  );
  await cdp.evaluate("document.querySelector('[data-action=\"admin-edit-user\"]')?.click()");
  await until(500);
  await cdp.screenshot('06-admin-edit-user.png');
  await cdp.evaluate("document.querySelector('[data-modal-close]')?.click()");
  await until(300);

  // Player lobby and real "return to table" action.
  await cdp.evaluate(
    `localStorage.setItem('xiaosa_token', ${JSON.stringify(playerLogin.token)});`,
  );
  await cdp.navigate(`${BASE}/?view=lobby#/lobby`, 2100);
  log('lobby title:', await cdp.evaluate('document.title'));
  log('lobby room cards:', await cdp.evaluate("document.querySelectorAll('.room-card').length"));
  log('lobby resume banner:', await cdp.evaluate("Boolean(document.querySelector('.resume-banner'))"));
  await cdp.screenshot('07-lobby.png', true);
  await cdp.evaluate("document.querySelector('[data-action=\"create-room\"]')?.click()");
  await until(500);
  await cdp.screenshot('07b-create-room.png');
  await cdp.evaluate("document.querySelector('[data-modal-close]')?.click()");
  await until(300);
  await cdp.evaluate(
    `document.querySelector('[data-action="join-room"][data-code="${created.room.code}"]')?.click()`,
  );
  await until(1900);
  log('room title:', await cdp.evaluate('document.title'));
  log('room h2:', await cdp.evaluate("document.querySelector('.waiting-head h2')?.innerText"));
  await cdp.screenshot('08-room-waiting.png', true);

  // Ready and start via real UI.
  await cdp.evaluate("document.querySelector('[data-action=\"toggle-ready\"]')?.click()");
  await until(900);
  const canStart = await cdp.evaluate(
    "document.querySelector('[data-action=\"start-game\"]')?.disabled === false",
  );
  log('start enabled after ready:', canStart);
  await cdp.evaluate("document.querySelector('[data-action=\"start-game\"]')?.click()");
  await until(1700);
  log('room status:', await cdp.evaluate("document.querySelector('.action-rail') ? 'playing' : 'other'"));
  log(
    'hand layout:',
    await cdp.evaluate(`(() => {
      const scroller = document.querySelector('.hand-scroller');
      const cards = document.querySelector('.hand-cards');
      const last = cards?.lastElementChild;
      if (!scroller || !cards || !last) return null;
      const s = scroller.getBoundingClientRect();
      const c = cards.getBoundingClientRect();
      const l = last.getBoundingClientRect();
      return {
        count: cards.children.length,
        scroller: Math.round(s.width),
        cards: Math.round(c.width),
        lastRight: Math.round(l.right),
        scrollerRight: Math.round(s.right),
        clipped: l.right > s.right + 1,
      };
    })()`),
  );
  await cdp.screenshot('09-room-playing.png', true);

  // Exercise card selection and a real play through the UI.
  let hintReady = false;
  for (let i = 0; i < 26; i += 1) {
    hintReady = await cdp.evaluate(
      "document.querySelector('[data-action=\"hint\"]')?.disabled === false",
    );
    if (hintReady) break;
    await until(450);
  }
  log('hint enabled:', hintReady);
  if (hintReady) {
    await cdp.evaluate("document.querySelector('[data-action=\"hint\"]')?.click()");
    await until(700);
    const selected = await cdp.evaluate("document.querySelectorAll('.hand-cards .selected').length");
    log('hint-selected cards:', selected);
    await cdp.screenshot('10-room-selected.png', true);
    if (selected > 0) {
      await cdp.evaluate("document.querySelector('[data-action=\"play-cards\"]')?.click()");
      await until(1000);
      log('hand after play:', await cdp.evaluate("document.querySelectorAll('.hand-cards .playing-card').length"));
    }
  }

  // Chat round-trip through the UI.
  await cdp.evaluate(`
    const input = document.querySelector('.chat-form input[name="message"]');
    input.value = '各位，手下留情';
    document.querySelector('.chat-form').requestSubmit();
  `);
  await until(700);
  log(
    'chat sent:',
    await cdp.evaluate("document.querySelector('.chat-log')?.innerText.includes('各位，手下留情')"),
  );

  // Mobile screenshots.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.navigate(`${BASE}/?view=mobile`, 1200);
  await cdp.screenshot('11-mobile-landing.png');
  await cdp.navigate(`${BASE}/?view=mobile-room#/room/${created.room.code}`, 1800);
  await cdp.screenshot('12-mobile-room.png');

  // Return to desktop, then let the bots and the API finish the round while
  // the browser stays connected via SSE, so the result overlay is live-tested.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.navigate(`${BASE}/?view=result#/room/${created.room.code}`, 1800);

  let room = (await api(`/api/rooms/${created.room.code}`, { token: playerLogin.token })).room;
  let guard = 0;
  while (room.status === 'playing' && guard < 150) {
    guard += 1;
    if (room.gamePublic.currentSeat === room.you.seat) {
      const hint = await api(`/api/rooms/${created.room.code}/hint`, {
        method: 'POST',
        token: playerLogin.token,
      });
      if (hint.cardIds?.length) {
        room = (
          await api(`/api/rooms/${created.room.code}/play`, {
            method: 'POST',
            token: playerLogin.token,
            body: { cardIds: hint.cardIds },
          })
        ).room;
      } else {
        room = (
          await api(`/api/rooms/${created.room.code}/pass`, {
            method: 'POST',
            token: playerLogin.token,
          })
        ).room;
      }
    } else {
      await until(420);
      room = (await api(`/api/rooms/${created.room.code}`, { token: playerLogin.token })).room;
    }
  }
  log('final room status:', room.status);
  await until(1300);
  log('result overlay:', await cdp.evaluate("Boolean(document.querySelector('.result-layer'))"));
  await cdp.screenshot('13-room-result.png', true);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await until(500);
  await cdp.screenshot('14-mobile-result.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const errors = [...new Set(cdp.consoleErrors)];
  log(`console/page errors: ${errors.length}`);
  for (const error of errors.slice(0, 20)) console.log('  !', error);

  cdp.ws.close();
  if (errors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
