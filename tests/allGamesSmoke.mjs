/**
 * End-to-end smoke test for all three games against a running server.
 * Usage: node tests/allGamesSmoke.mjs
 *
 * Set BOT_DELAY_MS=120 when starting the server to make bot turns faster.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now().toString().slice(-5);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('•', ...args);

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(BASE + path, {
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

try {
  const admin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123', portal: 'admin' },
  });
  const games = [
    ['big-two', 4],
    ['dou-dizhu', 3],
    ['pao-yao', 4],
  ];

  for (const [gameType, maxPlayers] of games) {
    const username = `smk${gameType.replace('-', '')}${stamp}`;
    await request('/api/admin/users', {
      method: 'POST',
      token: admin.token,
      body: {
        username,
        displayName: `烟测·${gameType}`,
        password: 'smoke123',
        role: 'player',
      },
    });
    const player = await request('/api/auth/login', {
      method: 'POST',
      body: { username, password: 'smoke123', portal: 'game' },
    });
    const created = await request('/api/rooms', {
      method: 'POST',
      token: player.token,
      body: { name: `${gameType} 烟测`, maxPlayers, gameType },
    });
    const code = created.room.code;
    await request(`/api/rooms/${code}/bots`, {
      method: 'POST',
      token: player.token,
      body: { count: maxPlayers - 1 },
    });
    await request(`/api/rooms/${code}/ready`, {
      method: 'POST',
      token: player.token,
      body: { ready: true },
    });
    const started = await request(`/api/rooms/${code}/start`, {
      method: 'POST',
      token: player.token,
    });
    log(
      `${gameType} started: phase=${started.room.gamePublic.phase}, hand=${started.room.hand.length}, players=${started.room.players.length}`,
    );

    let room = started.room;
    let guard = 0;
    const startedAt = Date.now();
    while (room.status === 'playing' && guard < 1500) {
      guard += 1;
      if (room.gamePublic.phase === 'bidding') {
        if (room.gamePublic.biddingSeat === room.you.seat) {
          const value = (room.gamePublic.highestBid || 0) >= 2 ? 0 : 3;
          room = (
            await request(`/api/rooms/${code}/bid`, {
              method: 'POST',
              token: player.token,
              body: { value },
            })
          ).room;
        } else {
          await sleep(90);
        }
      } else if (room.gamePublic.currentSeat === room.you.seat) {
        const hint = await request(`/api/rooms/${code}/hint`, {
          method: 'POST',
          token: player.token,
        });
        if (hint.cardIds?.length) {
          room = (
            await request(`/api/rooms/${code}/play`, {
              method: 'POST',
              token: player.token,
              body: { cardIds: hint.cardIds },
            })
          ).room;
        } else {
          room = (
            await request(`/api/rooms/${code}/pass`, {
              method: 'POST',
              token: player.token,
            })
          ).room;
        }
      } else {
        await sleep(90);
      }
      if (room.status === 'playing') {
        room = (await request(`/api/rooms/${code}`, { token: player.token })).room;
      }
    }
    if (room.status !== 'finished') {
      throw new Error(
        `${gameType} did not finish: phase=${room.gamePublic.phase}, hands=${room.gamePublic.handCounts}`,
      );
    }
    const result = room.gamePublic.result;
    log(
      `${gameType} finished in ${Math.round((Date.now() - startedAt) / 1000)}s: ${result.headline} · ${result.detail}`,
    );
  }
  log('三款游戏端到端烟测通过');
} catch (error) {
  console.error('烟测失败：', error.message);
  process.exitCode = 1;
}
