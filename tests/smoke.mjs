/**
 * End-to-end smoke test against a running server.
 * Usage: node tests/smoke.mjs (server must be on http://127.0.0.1:3000)
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now().toString().slice(-6);
const admin = { username: 'admin', password: 'admin123' };
const suffix = `smoke${stamp}`;

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const log = (...args) => console.log('•', ...args);

try {
  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { ...admin, portal: 'admin' },
  });
  const adminToken = adminLogin.token;
  log('管理员登录成功');

  const user = await request('/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: {
      username: suffix,
      displayName: `烟测${stamp}`,
      password: 'smoke123',
      role: 'player',
    },
  });
  log(`创建测试用户 ${suffix}`);

  const playerLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: suffix, password: 'smoke123', portal: 'game' },
  });
  const token = playerLogin.token;

  const created = await request('/api/rooms', {
    method: 'POST',
    token,
    body: { name: '烟测牌桌', maxPlayers: 4 },
  });
  const code = created.room.code;
  log(`创建房间 ${code}`);

  await request(`/api/rooms/${code}/bots`, {
    method: 'POST',
    token,
    body: { count: 3 },
  });
  log('补入 3 位电脑玩家');

  await request(`/api/rooms/${code}/ready`, {
    method: 'POST',
    token,
    body: { ready: true },
  });
  log('玩家准备完毕');

  const started = await request(`/api/rooms/${code}/start`, { method: 'POST', token });
  if (started.room.status !== 'playing') throw new Error('牌局没有开始');
  if (started.room.hand.length !== 13) throw new Error(`手牌数量异常：${started.room.hand.length}`);
  log(`牌局开始，手牌 ${started.room.hand.length} 张，轮次 ${started.room.gamePublic.currentSeat}`);

  let room = started.room;
  let guard = 0;
  while (room.status === 'playing') {
    guard += 1;
    if (guard > 160) throw new Error('牌局超时未结束');
    room = (await request(`/api/rooms/${code}`, { token })).room;
    if (room.status !== 'playing') break;
    const yourTurn = room.gamePublic.currentSeat === room.you.seat;
    if (!yourTurn) {
      await sleep(450);
      continue;
    }
    const hint = await request(`/api/rooms/${code}/hint`, { method: 'POST', token });
    if (hint.cardIds?.length) {
      room = (
        await request(`/api/rooms/${code}/play`, {
          method: 'POST',
          token,
          body: { cardIds: hint.cardIds },
        })
      ).room;
      log(`出牌 ${hint.cardIds.join(',')}，剩 ${room.hand.length} 张`);
    } else {
      room = (await request(`/api/rooms/${code}/pass`, { method: 'POST', token })).room;
      log('选择不要');
    }
  }

  if (room.status !== 'finished') throw new Error(`牌局未结束，状态 ${room.status}`);
  const winner = room.gamePublic.result.entries.find((entry) => entry.place === 1);
  log(`牌局结束，胜者：${winner.playerName}，本局积分 ${winner.points}`);
  log('烟测通过');
} catch (error) {
  console.error('烟测失败：', error.message);
  process.exitCode = 1;
}
