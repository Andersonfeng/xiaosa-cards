import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countAdmins,
  createSession,
  createUser,
  deleteSession,
  deleteUser,
  deleteUserSessions,
  getMatches,
  getPlatformCounts,
  getSessionUser,
  getUserById,
  getUserByUsername,
  listUsers,
  publicUser,
  updateUser,
  verifyPassword,
} from './db.js';
import { GAME_REGISTRY } from './games.js';
import { RoomError, RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

class ApiError extends Error {
  constructor(status, message, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const roomManager = new RoomManager({
  onChange: (room) => {
    broadcastRoom(room);
    scheduleLobbyBroadcast();
  },
  onLobbyChange: () => scheduleLobbyBroadcast(),
  onKicked: (code, userId) => {
    closeRoomUser(code, userId, '你已被房主移出房间');
  },
});

const lobbyClients = new Map(); // res -> userId
const roomClients = new Map(); // code -> Map<res, userId>
const connectionsByUser = new Map(); // userId -> Set<res>

let lobbyBroadcastTimer = null;
function scheduleLobbyBroadcast() {
  if (lobbyBroadcastTimer) return;
  lobbyBroadcastTimer = setTimeout(() => {
    lobbyBroadcastTimer = null;
    const payload = { rooms: roomManager.listRooms(), games: GAME_REGISTRY };
    for (const res of lobbyClients.keys()) sendEvent(res, 'lobby', payload);
  }, 120);
  lobbyBroadcastTimer.unref?.();
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
}

function sendEvent(res, event, payload) {
  if (!res || res.writableEnded) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // The client disappeared; the close handler cleans up.
  }
}

function rememberConnection(userId, res) {
  if (!connectionsByUser.has(userId)) connectionsByUser.set(userId, new Set());
  connectionsByUser.get(userId).add(res);
}

function forgetConnection(userId, res) {
  const set = connectionsByUser.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) connectionsByUser.delete(userId);
}

function broadcastRoom(room) {
  const clients = roomClients.get(room.code);
  if (!clients || clients.size === 0) return;
  for (const [res, userId] of clients) {
    try {
      const view = roomManager.view(room, userId);
      sendEvent(res, 'room', { room: view });
    } catch {
      // The room may have been destroyed, or the viewer was removed.
    }
  }
}

function closeRoomUser(code, userId, message) {
  const clients = roomClients.get(code);
  if (!clients) return;
  for (const [res, clientUserId] of [...clients.entries()]) {
    if (clientUserId !== Number(userId)) continue;
    sendEvent(res, 'kicked', { message });
    try {
      res.end();
    } catch {
      // already gone
    }
  }
}

function closeUserConnections(userId, event = 'session-ended', message = '登录状态已失效') {
  const set = connectionsByUser.get(Number(userId));
  if (!set) return;
  for (const res of [...set]) {
    sendEvent(res, event, { message });
    try {
      res.end();
    } catch {
      // already gone
    }
  }
}

function openLobbyEvents(req, res, url) {
  const { user } = authenticate(req, url);
  writeSseHeaders(res);
  lobbyClients.set(res, Number(user.id));
  rememberConnection(Number(user.id), res);
  sendEvent(res, 'lobby', { rooms: roomManager.listRooms(), games: GAME_REGISTRY });

  const cleanup = () => {
    lobbyClients.delete(res);
    forgetConnection(Number(user.id), res);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

function openRoomEvents(req, res, url, code) {
  const { user } = authenticate(req, url);
  const room = roomManager.getRoom(code);
  roomManager.requireMember(room, user.id);

  writeSseHeaders(res);
  if (!roomClients.has(room.code)) roomClients.set(room.code, new Map());
  const clients = roomClients.get(room.code);
  clients.set(res, Number(user.id));
  rememberConnection(Number(user.id), res);
  roomManager.setConnected(room.code, user.id, true);
  sendEvent(res, 'room', { room: roomManager.view(room, user.id) });

  const cleanup = () => {
    const current = roomClients.get(room.code);
    if (current) {
      current.delete(res);
      if (current.size === 0) roomClients.delete(room.code);
      const stillConnected = [...current.values()].includes(Number(user.id));
      if (!stillConnected) roomManager.setConnected(room.code, user.id, false);
    }
    forgetConnection(Number(user.id), res);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new ApiError(413, '请求内容过大', 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, '请求体不是合法 JSON', 'INVALID_JSON');
  }
}

function sendJson(res, status, data) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, data = {}, status = 200) {
  sendJson(res, status, { ok: true, ...data });
}

function fail(res, status, message, code = 'API_ERROR') {
  sendJson(res, status, { ok: false, error: { message, code } });
}

function authenticate(req, url) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = bearer || url.searchParams.get('token') || '';
  const user = getSessionUser(token);
  if (!user) throw new ApiError(401, '登录已过期，请重新登录', 'UNAUTHORIZED');
  return { user, token };
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new ApiError(403, '需要管理员权限', 'FORBIDDEN');
}

function roomPayload(room, userId) {
  return { room: roomManager.view(room, userId) };
}

function validateUsername(value) {
  const username = String(value ?? '').trim();
  if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) {
    throw new ApiError(400, '账号需为 2–24 位字母、数字、下划线或短横线', 'INVALID_USERNAME');
  }
  return username;
}

function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 6 || password.length > 72) {
    throw new ApiError(400, '密码长度需为 6–72 位', 'INVALID_PASSWORD');
  }
  return password;
}

function validateDisplayName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) throw new ApiError(400, '请填写昵称', 'INVALID_DISPLAY_NAME');
  return name;
}

const loginAttempts = new Map();
function guardLogin(ip) {
  const nowMs = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || nowMs - record.startedAt > 5 * 60 * 1000) {
    loginAttempts.set(ip, { count: 0, startedAt: nowMs });
    return;
  }
  if (record.count >= 15) {
    throw new ApiError(429, '尝试次数过多，请 5 分钟后再试', 'TOO_MANY_ATTEMPTS');
  }
}
function markLoginFailure(ip) {
  const record = loginAttempts.get(ip) || { count: 0, startedAt: Date.now() };
  record.count += 1;
  loginAttempts.set(ip, record);
}
function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return ok(res, { status: 'up', now: new Date().toISOString() });
  }

  if (pathname === '/api/events/lobby' && method === 'GET') {
    openLobbyEvents(req, res, url);
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/events$/);
  if (eventsMatch && method === 'GET') {
    openRoomEvents(req, res, url, eventsMatch[1]);
    return;
  }

  if (pathname === '/api/games' && method === 'GET') {
    return ok(res, { games: GAME_REGISTRY });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    guardLogin(ip);
    const body = await readJson(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const portal = body.portal === 'admin' ? 'admin' : 'game';
    if (!username || !password) throw new ApiError(400, '请输入账号和密码', 'MISSING_CREDENTIALS');
    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      markLoginFailure(ip);
      throw new ApiError(401, '账号或密码不正确', 'INVALID_CREDENTIALS');
    }
    if (user.status !== 'active') throw new ApiError(403, '账号已被停用，请联系管理员', 'ACCOUNT_DISABLED');
    if (portal === 'admin' && user.role !== 'admin') {
      throw new ApiError(403, '该账号不是管理员，请从游戏入口登录', 'NOT_ADMIN');
    }
    clearLoginFailures(ip);
    const { token, expiresAt } = createSession(user.id);
    const fresh = getUserById(user.id);
    return ok(res, {
      token,
      expiresAt,
      user: publicUser(fresh),
      roomCode: roomManager.getRoomForUser(user.id)?.code || null,
    });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const { user, token } = authenticate(req, url);
    const room = roomManager.getRoomForUser(user.id);
    return ok(res, {
      user: publicUser(user),
      roomCode: room?.code || null,
      token,
    });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const { user, token } = authenticate(req, url);
    deleteSession(token);
    const room = roomManager.getRoomForUser(user.id);
    if (room && room.status !== 'playing') {
      try {
        roomManager.leaveRoom(user.id);
      } catch {
        // A room state change can race with logout; the connection cleanup still runs.
      }
    }
    closeUserConnections(user.id, 'session-ended', '你已退出登录');
    return ok(res, {});
  }

  // Every remaining API route requires a session.
  const { user } = authenticate(req, url);

  if (pathname === '/api/rooms' && method === 'GET') {
    return ok(res, { rooms: roomManager.listRooms(), games: GAME_REGISTRY });
  }

  if (pathname === '/api/rooms' && method === 'POST') {
    const body = await readJson(req);
    const room = roomManager.createRoom(user, {
      name: body.name,
      maxPlayers: body.maxPlayers,
      gameType: body.gameType,
    });
    return ok(res, roomPayload(room, user.id), 201);
  }

  if (pathname === '/api/rooms/join' && method === 'POST') {
    const body = await readJson(req);
    const room = roomManager.joinRoom(user, body.code);
    return ok(res, roomPayload(room, user.id));
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)(?:\/(.*))?$/);
  if (roomMatch) {
    const code = roomMatch[1];
    const actionPath = roomMatch[2] || '';
    const room = roomManager.getRoom(code);

    if (!actionPath && method === 'GET') {
      roomManager.requireMember(room, user.id);
      return ok(res, roomPayload(room, user.id));
    }

    if (actionPath === 'join' && method === 'POST') {
      const joined = roomManager.joinRoom(user, code);
      return ok(res, roomPayload(joined, user.id));
    }

    if (actionPath === 'leave' && method === 'POST') {
      roomManager.leaveRoom(user.id);
      return ok(res, {});
    }

    if (actionPath === 'ready' && method === 'POST') {
      const body = await readJson(req);
      const updated = roomManager.setReady(user.id, body.ready);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'game' && method === 'POST') {
      const body = await readJson(req);
      const updated = roomManager.setGameType(user.id, body.gameType);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'bots' && method === 'POST') {
      const body = await readJson(req);
      const updated = roomManager.addBots(user.id, body.count ?? 1);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'bots' && method === 'DELETE') {
      const updated = roomManager.removeBot(user.id);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'start' && method === 'POST') {
      const updated = roomManager.startGame(user.id);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'restart' && method === 'POST') {
      const updated = roomManager.restartGame(user.id);
      return ok(res, roomPayload(updated, user.id));
    }

    if (actionPath === 'play' && method === 'POST') {
      const body = await readJson(req);
      roomManager.play(user.id, body.cardIds);
      return ok(res, roomPayload(room, user.id));
    }

    if (actionPath === 'pass' && method === 'POST') {
      roomManager.pass(user.id);
      return ok(res, roomPayload(room, user.id));
    }

    if (actionPath === 'bid' && method === 'POST') {
      const body = await readJson(req);
      roomManager.bid(user.id, body.value);
      return ok(res, roomPayload(room, user.id));
    }

    if (actionPath === 'action' && method === 'POST') {
      const body = await readJson(req);
      roomManager.action(user.id, body.type, body.payload || {});
      return ok(res, roomPayload(room, user.id));
    }

    if (actionPath === 'hint' && method === 'POST') {
      const cardIds = roomManager.hint(user.id);
      return ok(res, { cardIds });
    }

    if (actionPath === 'chat' && method === 'POST') {
      const body = await readJson(req);
      const updated = roomManager.chat(user.id, body.text);
      return ok(res, roomPayload(updated, user.id));
    }

    const kickMatch = actionPath.match(/^players\/(\d+)$/);
    if (kickMatch && method === 'DELETE') {
      const updated = roomManager.kickPlayer(user.id, Number(kickMatch[1]));
      return ok(res, roomPayload(updated, user.id));
    }
  }

  if (pathname === '/api/admin/overview' && method === 'GET') {
    requireAdmin(user);
    const counts = getPlatformCounts();
    const snapshot = roomManager.adminSnapshot();
    return ok(res, {
      stats: {
        ...counts,
        online: connectionsByUser.size,
        activeRooms: snapshot.rooms.length,
        waitingRooms: snapshot.rooms.filter((room) => room.status === 'waiting').length,
        playingRooms: snapshot.rooms.filter((room) => room.status === 'playing').length,
      },
      rooms: snapshot.rooms,
      recentMatches: getMatches(8),
    });
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    requireAdmin(user);
    const search = url.searchParams.get('search') || '';
    const users = listUsers(search).map((item) => {
      const room = roomManager.getRoomForUser(item.id);
      return {
        ...item,
        online: connectionsByUser.has(item.id),
        roomCode: room?.code || null,
      };
    });
    return ok(res, { users });
  }

  if (pathname === '/api/admin/users' && method === 'POST') {
    requireAdmin(user);
    const body = await readJson(req);
    const username = validateUsername(body.username);
    const displayName = validateDisplayName(body.displayName);
    const password = validatePassword(body.password);
    const role = body.role === 'admin' ? 'admin' : 'player';
    if (getUserByUsername(username)) {
      throw new ApiError(409, '该账号已经存在', 'USERNAME_TAKEN');
    }
    const created = createUser({ username, displayName, password, role });
    return ok(res, { user: publicUser(created) }, 201);
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userMatch && method === 'PATCH') {
    requireAdmin(user);
    const targetId = Number(userMatch[1]);
    const target = getUserById(targetId);
    if (!target) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
    const body = await readJson(req);
    const patch = {};
    if (body.displayName !== undefined) patch.displayName = validateDisplayName(body.displayName);
    if (body.password !== undefined) patch.password = validatePassword(body.password);
    if (body.role !== undefined) {
      if (!['admin', 'player'].includes(body.role)) {
        throw new ApiError(400, '无效的角色', 'INVALID_ROLE');
      }
      patch.role = body.role;
    }
    if (body.status !== undefined) {
      if (!['active', 'disabled'].includes(body.status)) {
        throw new ApiError(400, '无效的账号状态', 'INVALID_STATUS');
      }
      patch.status = body.status;
    }
    if (targetId === Number(user.id) && (patch.role === 'player' || patch.status === 'disabled')) {
      throw new ApiError(400, '不能停用自己的账号或移除自己的管理员权限', 'SELF_PROTECTION');
    }
    if (
      target.role === 'admin' &&
      countAdmins() <= 1 &&
      (patch.role === 'player' || patch.status === 'disabled')
    ) {
      throw new ApiError(400, '系统至少需要保留一名管理员', 'LAST_ADMIN');
    }
    const targetRoom = roomManager.getRoomForUser(targetId);
    if (
      targetRoom?.status === 'playing' &&
      (patch.status === 'disabled' ||
        patch.password !== undefined ||
        (patch.role !== undefined && patch.role !== target.role))
    ) {
      throw new ApiError(
        409,
        '该用户正在牌局中，暂时无法修改密码、角色或停用账号',
        'USER_IN_GAME',
      );
    }
    if (patch.status === 'disabled') {
      roomManager.evictUser(targetId);
    }
    const updated = updateUser(targetId, patch);
    if (
      patch.status === 'disabled' ||
      patch.password !== undefined ||
      (patch.role !== undefined && patch.role !== target.role)
    ) {
      deleteUserSessions(targetId);
      closeUserConnections(targetId, 'session-ended', '账号资料已更新，请重新登录');
    }
    return ok(res, { user: publicUser(updated) });
  }

  if (userMatch && method === 'DELETE') {
    requireAdmin(user);
    const targetId = Number(userMatch[1]);
    const target = getUserById(targetId);
    if (!target) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
    if (targetId === Number(user.id)) {
      throw new ApiError(400, '不能删除当前登录的管理员', 'SELF_PROTECTION');
    }
    if (target.role === 'admin' && countAdmins() <= 1) {
      throw new ApiError(400, '系统至少需要保留一名管理员', 'LAST_ADMIN');
    }
    roomManager.evictUser(targetId);
    deleteUser(targetId);
    closeUserConnections(targetId, 'session-ended', '账号已被管理员删除');
    return ok(res, {});
  }

  throw new ApiError(404, '接口不存在', 'NOT_FOUND');
}

async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  );

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          // noop
        }
        return;
      }
      if (error instanceof ApiError || error instanceof RoomError) {
        return fail(res, error.status || 400, error.message, error.code);
      }
      console.error('[api]', error);
      return fail(res, 500, '服务器开小差了，请稍后再试', 'INTERNAL_ERROR');
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/game' || pathname === '/admin') {
    return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }

  const normalized = path.normalize(pathname.replace(/^[/\\]+/, '')).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    return serveFile(req, res, filePath);
  } catch {
    if (!path.extname(pathname)) {
      return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

async function serveFile(req, res, filePath) {
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('[server]', error);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  });
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

const heartbeat = setInterval(() => {
  for (const res of lobbyClients.keys()) {
    if (!res.writableEnded) res.write(': ping\n\n');
  }
  for (const clients of roomClients.values()) {
    for (const res of clients.keys()) {
      if (!res.writableEnded) res.write(': ping\n\n');
    }
  }
}, 20_000);
heartbeat.unref?.();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ♠ ♥ 潇洒纸牌屋 · Xiaosa Club ♣ ♦');
  console.log(`  游戏入口  http://localhost:${PORT}`);
  console.log(`  管理后台  http://localhost:${PORT}/#/login/admin`);
  console.log('  默认管理员  admin / admin123');
  console.log('');
});

function shutdown() {
  clearInterval(heartbeat);
  for (const res of connectionsByUser.values()) {
    for (const client of res) {
      try {
        client.end();
      } catch {
        // noop
      }
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[unhandled]', error);
});
