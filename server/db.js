import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const dbPath = path.join(dataDir, 'game.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('admin', 'player')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    room_name TEXT NOT NULL,
    game_type TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    winner_user_id INTEGER,
    winner_name TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at);
`);

const nowIso = () => new Date().toISOString();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expected, 'hex');
    return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf);
  } catch {
    return false;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    gamesPlayed: Number(row.games_played || 0),
    gamesWon: Number(row.games_won || 0),
    winRate:
      Number(row.games_played || 0) > 0
        ? Math.round((Number(row.games_won || 0) / Number(row.games_played || 0)) * 100)
        : 0,
  };
}

export function createUser({ username, displayName, password, role = 'player' }) {
  const result = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
    .run(username, displayName, hashPassword(password), role, nowIso());
  return getUserById(Number(result.lastInsertRowid));
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

export function listUsers(search = '') {
  const term = `%${String(search).trim()}%`;
  return db
    .prepare(
      `SELECT * FROM users
       WHERE username LIKE ? OR display_name LIKE ?
       ORDER BY (role = 'admin') DESC, id ASC`,
    )
    .all(term, term)
    .map(publicUser);
}

export function updateUser(id, patch) {
  const fields = [];
  const values = [];
  if (patch.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.password !== undefined) {
    fields.push('password_hash = ?');
    values.push(hashPassword(patch.password));
  }
  if (patch.role !== undefined) {
    fields.push('role = ?');
    values.push(patch.role);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (!fields.length) return getUserById(id);
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id);
}

export function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

export function countAdmins() {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n);
}

export function createSession(userId) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, createdAt.toISOString(), expiresAt.toISOString());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
  return { token, expiresAt: expiresAt.toISOString() };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso());
  if (!row || row.status !== 'active') return null;
  return row;
}

export function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function deleteUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function touchLastLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
}

export function recordMatch({
  roomCode,
  roomName,
  gameType,
  playerCount,
  winnerUserId,
  winnerName,
  summary,
}) {
  db.prepare(
    `INSERT INTO matches
      (room_code, room_name, game_type, player_count, winner_user_id, winner_name, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    roomCode,
    roomName,
    gameType,
    playerCount,
    winnerUserId ?? null,
    winnerName ?? null,
    JSON.stringify(summary),
    nowIso(),
  );
}

export function updateGameStats(results) {
  const stmt = db.prepare(
    'UPDATE users SET games_played = games_played + 1, games_won = games_won + ? WHERE id = ?',
  );
  for (const result of results) {
    if (!result.userId) continue;
    stmt.run(result.won ? 1 : 0, result.userId);
  }
}

export function getMatches(limit = 20) {
  return db
    .prepare('SELECT * FROM matches ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((row) => {
      let summary = [];
      try {
        summary = JSON.parse(row.summary);
      } catch {
        summary = [];
      }
      return {
        id: Number(row.id),
        roomCode: row.room_code,
        roomName: row.room_name,
        gameType: row.game_type,
        playerCount: Number(row.player_count),
        winnerUserId: row.winner_user_id ? Number(row.winner_user_id) : null,
        winnerName: row.winner_name,
        summary,
        createdAt: row.created_at,
      };
    });
}

export function getPlatformCounts() {
  const users = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  const active = Number(
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").get().n,
  );
  const admins = countAdmins();
  const games = Number(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n);
  const gamesToday = Number(
    db.prepare("SELECT COUNT(*) AS n FROM matches WHERE created_at >= date('now')").get().n,
  );
  return { users, active, admins, games, gamesToday };
}

// First-run account. Keep this deterministic so a fresh checkout is playable.
if (!db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
  createUser({
    username: 'admin',
    displayName: '纸牌屋管理员',
    password: 'admin123',
    role: 'admin',
  });
  console.log('[db] 已创建默认管理员：admin / admin123');
}

// Keep installs created under the earlier brand name visually consistent.
db.prepare(
  "UPDATE users SET display_name = '纸牌屋管理员' WHERE role = 'admin' AND display_name = '会馆管理员'",
).run();

pruneSessions();

export default db;
