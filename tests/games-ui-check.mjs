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
    this.errors = [];
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
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(`EXCEPTION: ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        this.errors.push(`CONSOLE: ${message.params.args.map((arg) => arg.value || arg.description || '').join(' ')}`);
      }
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.set(message.params.requestId, message.params.request.url);
      }
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        this.errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`);
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
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
  async screenshot(name, fullPage = false) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: fullPage,
    });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
    log(`截图 ${name}`);
  }
  async navigate(url, wait = 1400) {
    await this.send('Page.navigate', { url });
    await until(wait);
  }
}

async function prepareUser(adminToken, label) {
  const stamp = Date.now().toString().slice(-5);
  const username = `ui${label}${stamp}`;
  await api('/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: {
      username,
      displayName: label === 'dou' ? '桌上有局' : label === 'pao' ? '北岭牌客' : '牌桌朋友',
      password: 'uicheck123',
      role: 'player',
    },
  });
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'uicheck123', portal: 'game' },
  });
  return login;
}

async function startClicked(cdp, action, wait = 700) {
  await cdp.evaluate(`document.querySelector('[data-action="${action}"]')?.click()`);
  await until(wait);
}

async function main() {
  const target = await getPageTarget();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.navigate(`${BASE}/?fresh=1`, 900);
  await cdp.evaluate('localStorage.clear()');
  await cdp.send('Page.reload');
  await until(1100);
  cdp.errors.length = 0;

  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123', portal: 'admin' },
  });
  const douLogin = await prepareUser(adminLogin.token, 'dou');
  const paoLogin = await prepareUser(adminLogin.token, 'pao');
  const douRoom = await api('/api/rooms', {
    method: 'POST',
    token: douLogin.token,
    body: { name: '地主叫分测试', maxPlayers: 4, gameType: 'dou-dizhu' },
  });
  await api(`/api/rooms/${douRoom.room.code}/bots`, {
    method: 'POST',
    token: douLogin.token,
    body: { count: 2 },
  });
  await api(`/api/rooms/${douRoom.room.code}/ready`, {
    method: 'POST',
    token: douLogin.token,
    body: { ready: true },
  });
  const paoRoom = await api('/api/rooms', {
    method: 'POST',
    token: paoLogin.token,
    body: { name: '北岭刨幺局', maxPlayers: 4, gameType: 'pao-yao' },
  });
  await api(`/api/rooms/${paoRoom.room.code}/bots`, {
    method: 'POST',
    token: paoLogin.token,
    body: { count: 3 },
  });
  await api(`/api/rooms/${paoRoom.room.code}/ready`, {
    method: 'POST',
    token: paoLogin.token,
    body: { ready: true },
  });
  await api(`/api/rooms/${paoRoom.room.code}/start`, {
    method: 'POST',
    token: paoLogin.token,
  });
  log('rooms prepared', douRoom.room.code, paoRoom.room.code);

  // Dou Dizhu waiting room and bidding.
  await cdp.evaluate(`localStorage.setItem('xiaosa_token', ${JSON.stringify(douLogin.token)})`);
  await cdp.navigate(`${BASE}/?dou=1#/room/${douRoom.room.code}`, 1900);
  log('dou waiting:', await cdp.evaluate("document.querySelector('.waiting-head h2')?.innerText"));
  log('switch options:', await cdp.evaluate("document.querySelectorAll('[data-action=switch-game]').length"));
  await cdp.screenshot('dou-01-waiting.png', true);
  await startClicked(cdp, 'start-game', 1000);
  log('dou bidding stage:', await cdp.evaluate("Boolean(document.querySelector('.bid-stage'))"));
  log('dou hand cards:', await cdp.evaluate("document.querySelectorAll('.hand-cards .playing-card').length"));
  await cdp.screenshot('dou-02-bidding.png', true);
  await cdp.evaluate("document.querySelector('[data-action=\"bid\"][data-value=\"3\"]')?.click()");
  await until(1100);
  log('dou landlord:', await cdp.evaluate("document.querySelector('.game-data-panel')?.innerText.includes('地主')"));
  log('dou hand after bottom:', await cdp.evaluate("document.querySelectorAll('.hand-cards .playing-card').length"));
  await cdp.screenshot('dou-03-playing.png', true);

  // Play one legal hand through the UI.
  const hintEnabled = await cdp.evaluate("document.querySelector('[data-action=\"hint\"]')?.disabled === false");
  if (hintEnabled) {
    await startClicked(cdp, 'hint', 450);
    const selected = await cdp.evaluate("document.querySelectorAll('.hand-cards .selected').length");
    log('dou hint selected:', selected);
    if (selected) {
      await startClicked(cdp, 'play-cards', 900);
    }
  }

  // Pao Yao table.
  await cdp.evaluate(`localStorage.setItem('xiaosa_token', ${JSON.stringify(paoLogin.token)})`);
  await cdp.navigate(`${BASE}/?pao=1#/room/${paoRoom.room.code}`, 2000);
  log('pao hand cards:', await cdp.evaluate("document.querySelectorAll('.hand-cards .playing-card').length"));
  log('pao team rows:', await cdp.evaluate("document.querySelectorAll('.team-score-row').length"));
  log('pao roles:', await cdp.evaluate("document.querySelectorAll('.seat-role').length"));
  await cdp.screenshot('pao-01-table.png', true);
  const paoHint = await cdp.evaluate("document.querySelector('[data-action=\"hint\"]')?.disabled === false");
  if (paoHint) {
    await startClicked(cdp, 'hint', 350);
    const selected = await cdp.evaluate("document.querySelectorAll('.hand-cards .selected').length");
    log('pao hint selected:', selected);
    if (selected) {
      await startClicked(cdp, 'play-cards', 1200);
      await until(1200);
      await cdp.screenshot('pao-02-playing.png', true);
    }
  }

  // Finish the Pao game through the same API the UI uses, while the browser
  // remains connected by SSE, then verify the team result overlay.
  let paoState = (await api(`/api/rooms/${paoRoom.room.code}`, { token: paoLogin.token })).room;
  let guard = 0;
  while (paoState.status === 'playing' && guard < 1200) {
    guard += 1;
    if (paoState.gamePublic.currentSeat === paoState.you.seat) {
      const hint = await api(`/api/rooms/${paoRoom.room.code}/hint`, {
        method: 'POST',
        token: paoLogin.token,
      });
      if (hint.cardIds?.length) {
        paoState = (
          await api(`/api/rooms/${paoRoom.room.code}/play`, {
            method: 'POST',
            token: paoLogin.token,
            body: { cardIds: hint.cardIds },
          })
        ).room;
      } else {
        paoState = (
          await api(`/api/rooms/${paoRoom.room.code}/pass`, {
            method: 'POST',
            token: paoLogin.token,
          })
        ).room;
      }
    } else {
      await until(80);
      paoState = (await api(`/api/rooms/${paoRoom.room.code}`, { token: paoLogin.token })).room;
    }
  }
  log('pao final:', paoState.status, paoState.gamePublic?.result?.headline, paoState.gamePublic?.result?.winType);
  await until(900);
  log('pao result overlay:', await cdp.evaluate("Boolean(document.querySelector('.result-layer'))"));
  await cdp.screenshot('pao-04-result.png', true);

  // Lobby create-room modal and responsive views.
  await cdp.navigate(`${BASE}/?lobby=1#/lobby`, 1500);
  await startClicked(cdp, 'create-room', 500);
  await cdp.evaluate("document.querySelector('[data-create-game=\"pao-yao\"]')?.click()");
  await until(350);
  log(
    'create modal capacity:',
    await cdp.evaluate("document.querySelector('input[name=maxPlayers]')?.value"),
  );
  log(
    'create modal game:',
    await cdp.evaluate("document.querySelector('input[name=gameType]')?.value"),
  );
  await cdp.screenshot('games-01-create.png');
  await cdp.evaluate("document.querySelector('[data-modal-close]')?.click()");

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.navigate(`${BASE}/?pao-mobile=1#/room/${paoRoom.room.code}`, 1800);
  await cdp.screenshot('pao-03-mobile.png');

  const errors = [...new Set(cdp.errors)];
  log(`console/page errors: ${errors.length}`);
  for (const error of errors.slice(0, 20)) console.log('  !', error);
  cdp.ws.close();
  if (errors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
