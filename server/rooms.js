import crypto from 'node:crypto';
import { GAME_MAP, getEngine, formatCards } from './games.js';
import { recordMatch, updateGameStats } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['阿聪', '小美', '强哥', '肥仔', '阿珍', '大炮', '细蚊', '发记'];
const BOT_AVATARS = ['🤖', '🦊', '🐼', '🐯', '🐸', '🐵', '🐶', '🐱'];
const TEAM_LABELS = ['红队', '蓝队'];
const BOT_DELAY_MS = Math.max(
  80,
  Math.min(3000, Number(process.env.BOT_DELAY_MS || 850)),
);
const ROOM_RETENTION_MS = Math.max(
  5000,
  Number(process.env.ROOM_RETENTION_MS || 60_000),
);
const PLAYER_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.PLAYER_TIMEOUT_MS || 60_000),
);

export class RoomError extends Error {
  constructor(message, status = 400, code = 'ROOM_ERROR') {
    super(message);
    this.name = 'RoomError';
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const makeCode = () => {
  const bytes = crypto.randomBytes(5);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
};

function cleanText(value, max = 24) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function playerKey(player) {
  return player.isBot ? player.id : `u:${player.id}`;
}

function playerName(room, seat) {
  return room.players[seat]?.displayName || '玩家';
}

export class RoomManager {
  constructor({ onChange, onLobbyChange, onKicked } = {}) {
    this.rooms = new Map();
    this.userRooms = new Map();
    this.onChange = onChange || (() => {});
    this.onLobbyChange = onLobbyChange || (() => {});
    this.onKicked = onKicked || (() => {});
  }

  _resolveGame(gameType) {
    const game = GAME_MAP.get(gameType) || null;
    if (!game || !game.enabled) throw new RoomError('该游戏尚未开放', 400, 'GAME_DISABLED');
    return game;
  }

  _capacityFor(game, requested) {
    if (game.minPlayers === game.maxPlayers) return game.maxPlayers;
    const capacity = Number(requested);
    if (!Number.isInteger(capacity) || capacity < game.minPlayers || capacity > game.maxPlayers) {
      throw new RoomError(
        `「${game.name}」支持 ${game.minPlayers}–${game.maxPlayers} 人`,
        400,
        'INVALID_CAPACITY',
      );
    }
    return capacity;
  }

  createRoom(user, { name, maxPlayers, gameType = 'big-two' }) {
    const game = this._resolveGame(gameType);
    const capacity = this._capacityFor(game, maxPlayers);
    const existingCode = this.userRooms.get(Number(user.id));
    if (existingCode) {
      const existing = this.rooms.get(existingCode);
      if (existing && existing.status === 'playing') {
        throw new RoomError('你正在牌局中，请先结束当前牌局', 409, 'ALREADY_IN_GAME');
      }
      if (existing) this._removePlayer(existing, user.id, { silent: true });
    }

    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();

    const roomName = cleanText(name, 24) || `${user.display_name || user.username}的牌局`;
    const room = {
      code,
      name: roomName,
      hostId: Number(user.id),
      maxPlayers: capacity,
      gameType: game.id,
      status: 'waiting',
      players: [],
      chat: [],
      scoreboard: {},
      roundNumber: 0,
      nextStarterSeat: 0,
      createdAt: now(),
      updatedAt: now(),
      game: null,
      botSeq: 0,
      botTimer: null,
    };
    this.rooms.set(code, room);
    this.userRooms.set(Number(user.id), code);
    room.players.push(this._makeHumanPlayer(user));
    this._system(room, `${user.display_name || user.username} 创建了「${game.name}」牌桌`);
    this._touch(room);
    return room;
  }

  _makeHumanPlayer(user) {
    return {
      id: Number(user.id),
      username: user.username,
      displayName: user.display_name || user.username,
      isBot: false,
      ready: false,
      connected: true,
      left: false,
      managed: false,
      disconnectedAt: null,
      disconnectTimer: null,
      joinedAt: now(),
      avatar: null,
    };
  }

  _makeBot(room) {
    const used = new Set(room.players.filter((player) => player.isBot).map((p) => p.displayName));
    const options = BOT_NAMES.filter((name) => !used.has(name));
    const name = options[0] || `电脑 ${room.botSeq + 1}`;
    room.botSeq += 1;
    return {
      id: `bot:${room.code}:${room.botSeq}`,
      username: `bot_${room.botSeq}`,
      displayName: name,
      isBot: true,
      ready: true,
      connected: true,
      joinedAt: now(),
      avatar: BOT_AVATARS[(room.botSeq - 1) % BOT_AVATARS.length],
    };
  }

  getRoom(code, { required = true } = {}) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room && required) throw new RoomError('房间不存在或已解散', 404, 'ROOM_NOT_FOUND');
    return room || null;
  }

  getRoomForUser(userId) {
    const code = this.userRooms.get(Number(userId));
    return code ? this.rooms.get(code) || null : null;
  }

  findPlayer(room, userId) {
    return room.players.find((player) => !player.isBot && player.id === Number(userId));
  }

  requireMember(room, userId) {
    const player = this.findPlayer(room, userId);
    if (!player) throw new RoomError('你不在这个房间中', 403, 'NOT_IN_ROOM');
    return player;
  }

  requireActiveMember(room, userId) {
    const player = this.requireMember(room, userId);
    if (player.managed || player.left || !player.connected) {
      throw new RoomError('座位正在电脑托管，请先回到牌桌接管', 409, 'SEAT_MANAGED');
    }
    return player;
  }

  requireHost(room, userId) {
    const player = this.requireActiveMember(room, userId);
    if (room.hostId !== Number(userId)) {
      throw new RoomError('只有房主可以进行此操作', 403, 'NOT_HOST');
    }
    return player;
  }

  _hasActiveHumans(room) {
    return room.players.some(
      (player) => !player.isBot && player.connected && !player.left && !player.managed,
    );
  }

  _updateRoomActivity(room) {
    if (this._hasActiveHumans(room)) this._cancelRoomExpiry(room);
    else this._scheduleRoomExpiry(room);
  }

  _clearDisconnectTimer(player) {
    if (player?.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
  }

  _transferHostToActive(room, departingId) {
    if (room.hostId !== Number(departingId)) return;
    const index = room.players.findIndex(
      (player) => !player.isBot && player.id === Number(departingId),
    );
    const count = room.players.length;
    let next = null;
    for (let offset = 1; offset <= count; offset += 1) {
      const seat = index >= 0 ? (index + offset) % count : offset % count;
      const candidate = room.players[seat];
      if (candidate && !candidate.isBot && candidate.connected && !candidate.left && !candidate.managed) {
        next = candidate;
        break;
      }
    }
    room.hostId = next?.id ?? null;
    if (next) this._system(room, `${next.displayName} 成为新房主`);
  }

  _takeoverSeat(room, player) {
    if (!player || player.isBot) return false;
    const wasManaged = player.managed || player.left;
    this._clearDisconnectTimer(player);
    player.connected = true;
    player.left = false;
    player.managed = false;
    player.disconnectedAt = null;
    if (room.hostId == null) {
      room.hostId = player.id;
      this._system(room, `${player.displayName} 成为新房主`);
    }
    if (wasManaged) this._system(room, `${player.displayName} 回到牌桌，解除托管`);
    this._cancelRoomExpiry(room);
    this._scheduleBot(room);
    return wasManaged;
  }

  _scheduleDisconnectTimeout(room, player) {
    this._clearDisconnectTimer(player);
    if (!player || player.isBot || player.left || player.connected) return;
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (this.rooms.get(room.code) !== room) return;
      if (!room.players.includes(player) || player.connected || player.left) return;
      player.managed = true;
      player.ready = true;
      player.disconnectedAt = null;
      if (room.hostId === player.id) this._transferHostToActive(room, player.id);
      this._system(room, `${player.displayName} 超过 1 分钟未连接，进入托管`);
      this._updateRoomActivity(room);
      this._scheduleBot(room);
      this._touch(room);
    }, PLAYER_TIMEOUT_MS);
    if (typeof player.disconnectTimer.unref === 'function') player.disconnectTimer.unref();
  }

  joinRoom(user, rawCode) {
    const code = cleanText(rawCode, 8).toUpperCase();
    const room = this.getRoom(code);
    if (room.players.some((player) => !player.isBot && player.id === Number(user.id))) {
      return room;
    }
    if (room.status !== 'waiting' && room.status !== 'finished') {
      throw new RoomError('牌局已经开始了，暂时无法加入', 409, 'GAME_IN_PROGRESS');
    }
    if (room.players.length >= room.maxPlayers) {
      throw new RoomError('房间已经满员', 409, 'ROOM_FULL');
    }
    if (this.userRooms.has(Number(user.id))) {
      const existing = this.getRoomForUser(user.id);
      if (existing && existing.status === 'playing') {
        throw new RoomError('你正在另一场牌局中', 409, 'ALREADY_IN_GAME');
      }
      if (existing) this._removePlayer(existing, user.id, { silent: true });
    }
    const hadActive = this._hasActiveHumans(room);
    this._cancelRoomExpiry(room);
    if (room.status === 'finished') {
      // A finished table can accept a new hand once someone joins again.
      room.status = 'waiting';
      room.game = null;
      room.nextStarterSeat = 0;
      for (const player of room.players) player.ready = false;
      this._system(room, '牌局已结束，房间回到准备状态');
    }
    room.players.push(this._makeHumanPlayer(user));
    this.userRooms.set(Number(user.id), room.code);
    this._system(room, `${user.display_name || user.username} 加入了房间`);
    if (!hadActive || room.hostId == null) {
      room.hostId = Number(user.id);
      this._system(room, `${user.display_name || user.username} 成为新房主`);
    }
    this._touch(room);
    return room;
  }

  setReady(userId, ready) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    if (room.status !== 'waiting') throw new RoomError('牌局进行中，无法更改准备状态', 409, 'BAD_STATE');
    const player = this.requireActiveMember(room, userId);
    player.ready = Boolean(ready);
    this._touch(room);
    return room;
  }

  addBots(userId, count = 1) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'waiting') throw new RoomError('牌局进行中，无法添加电脑', 409, 'BAD_STATE');
    const want = Math.max(1, Math.min(Number(count) || 1, room.maxPlayers - room.players.length));
    for (let i = 0; i < want; i += 1) {
      if (room.players.length >= room.maxPlayers) break;
      const bot = this._makeBot(room);
      room.players.push(bot);
      this._system(room, `电脑「${bot.displayName}」入座`);
    }
    this._touch(room);
    return room;
  }

  removeBot(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'waiting') throw new RoomError('牌局进行中，无法移除电脑', 409, 'BAD_STATE');
    const index = [...room.players].reverse().findIndex((player) => player.isBot);
    if (index === -1) throw new RoomError('房间里没有电脑', 400, 'NO_BOT');
    const actual = room.players.length - 1 - index;
    const [bot] = room.players.splice(actual, 1);
    this._system(room, `电脑「${bot.displayName}」离座`);
    this._touch(room);
    return room;
  }

  kickPlayer(userId, targetId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'waiting') throw new RoomError('牌局进行中，无法移出玩家', 409, 'BAD_STATE');
    const target = room.players.find((player) => !player.isBot && player.id === Number(targetId));
    if (!target) throw new RoomError('该玩家不在房间中', 404, 'PLAYER_NOT_FOUND');
    if (target.id === Number(userId)) throw new RoomError('不能移出自己', 400, 'CANNOT_KICK_SELF');
    this._removePlayer(room, target.id, { kicked: true });
    this.onKicked(room.code, target.id);
    return room;
  }

  setGameType(userId, gameType) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'waiting') throw new RoomError('牌局进行中，无法切换游戏', 409, 'BAD_STATE');
    const game = this._resolveGame(gameType);
    if (room.gameType === gameType) return room;
    if (room.players.length > game.maxPlayers) {
      throw new RoomError(
        `当前房间有 ${room.players.length} 人，超过「${game.name}」的人数上限`,
        400,
        'TOO_MANY_PLAYERS',
      );
    }
    const capacity =
      game.minPlayers === game.maxPlayers
        ? game.maxPlayers
        : Math.min(Math.max(room.maxPlayers, game.minPlayers), game.maxPlayers);
    if (room.players.length > capacity) {
      throw new RoomError('当前人数不适合该游戏', 400, 'TOO_MANY_PLAYERS');
    }
    room.gameType = game.id;
    room.maxPlayers = capacity;
    room.roundNumber = 0;
    room.nextStarterSeat = 0;
    this._system(room, `游戏切换为「${game.name}」，当前 ${room.players.length}/${capacity} 人`);
    this._touch(room);
    return room;
  }

  startGame(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'waiting') throw new RoomError('牌局已经开始了', 409, 'BAD_STATE');
    const game = this._resolveGame(room.gameType);
    if (room.players.length < game.minPlayers) {
      throw new RoomError(`「${game.name}」至少需要 ${game.minPlayers} 位玩家`, 400, 'NOT_ENOUGH_PLAYERS');
    }
    if (room.players.length > game.maxPlayers) {
      throw new RoomError(`「${game.name}」最多只能有 ${game.maxPlayers} 位玩家`, 400, 'TOO_MANY_PLAYERS');
    }
    if (room.players.some((player) => !player.ready)) {
      throw new RoomError('还有玩家尚未准备', 409, 'NOT_ALL_READY');
    }
    if (room.players.some((player) => !player.isBot && !player.managed && !player.connected)) {
      throw new RoomError('有玩家离线，请等待重连或将其移出房间', 409, 'PLAYER_OFFLINE');
    }
    this._startRound(room);
    return room;
  }

  _startRound(room) {
    const gameInfo = this._resolveGame(room.gameType);
    const engine = getEngine(room.gameType);
    let game;
    try {
      game = engine.create({
        playerCount: room.players.length,
        roundNumber: room.roundNumber,
        starterSeat: room.nextStarterSeat || 0,
      });
    } catch (error) {
      throw new RoomError(error.message || '无法开始牌局', 400, error.code || 'START_FAILED');
    }
    room.status = 'playing';
    room.game = game;
    room.roundNumber += 1;
    for (const player of room.players) {
      player.ready = false;
      const key = playerKey(player);
      if (!(key in room.scoreboard)) room.scoreboard[key] = 0;
    }
    this._system(room, engine.startText(room, game));
    this._touch(room);
    this._scheduleBot(room);
  }

  restartGame(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    this.requireHost(room, userId);
    if (room.status !== 'finished') throw new RoomError('牌局尚未结束', 409, 'BAD_STATE');
    const game = this._resolveGame(room.gameType);
    if (room.players.length < game.minPlayers) throw new RoomError('玩家人数不足', 400, 'NOT_ENOUGH_PLAYERS');
    this._startRound(room);
    return room;
  }

  _engine(room) {
    return getEngine(room.gameType);
  }

  _messageForPlay(room, seat, combo) {
    return `${playerName(room, seat)} 打出 ${combo.name}：${formatCards(combo)}`;
  }

  _completeAction(room) {
    if (room.game?.status === 'finished') {
      this._finishRound(room);
      return;
    }
    this._touch(room);
    this._scheduleBot(room);
  }

  play(userId, cardIds) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('牌局尚未开始', 409, 'BAD_STATE');
    if (room.game.status === 'bidding') throw new RoomError('请先完成叫地主', 409, 'BIDDING');
    const seat = room.players.indexOf(player);
    try {
      const engine = this._engine(room);
      if (!engine.play) throw new RoomError('当前玩法不支持出牌操作', 400, 'NO_PLAY');
      const outcome = engine.play(room.game, seat, cardIds);
      this._system(room, this._messageForPlay(room, seat, outcome.combo));
      if (outcome.combo.bomb || outcome.combo.rocket) {
        const multiplier = Math.max(1, room.game.highestBid) * 2 ** room.game.bombCount;
        this._system(room, `${outcome.combo.name}！当前结算倍数升至 ${multiplier} 倍`);
      }
      this._completeAction(room);
      return outcome;
    } catch (error) {
      this._raiseGameError(error);
    }
  }

  pass(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('牌局尚未开始', 409, 'BAD_STATE');
    const seat = room.players.indexOf(player);
    try {
      const engine = this._engine(room);
      if (!engine.pass) throw new RoomError('当前玩法不支持不要操作', 400, 'NO_PASS');
      const outcome = engine.pass(room.game, seat);
      this._system(room, `${player.displayName} 选择不要`);
      if (outcome.pointsAwarded > 0 && room.game.teamScores) {
        const teamLabel = TEAM_LABELS[outcome.team] || '本队';
        this._system(
          room,
          `${teamLabel}收下本墩 ${outcome.pointsAwarded} 分（红队 ${room.game.teamScores[0]} / 蓝队 ${room.game.teamScores[1]}）`,
        );
      }
      this._completeAction(room);
      return outcome;
    } catch (error) {
      this._raiseGameError(error);
    }
  }

  bid(userId, value) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('牌局尚未开始', 409, 'BAD_STATE');
    if (room.game.status !== 'bidding') throw new RoomError('现在不是叫地主阶段', 409, 'NOT_BIDDING');
    const seat = room.players.indexOf(player);
    try {
      const engine = this._engine(room);
      if (!engine.bid) throw new RoomError('当前玩法不需要叫地主', 400, 'NO_BIDDING');
      const amount = Number(value);
      const outcome = engine.bid(room.game, seat, amount);
      this._system(
        room,
        amount === 0 ? `${player.displayName} 不叫` : `${player.displayName} 叫 ${amount} 分`,
      );
      if (outcome.redealt) {
        this._system(room, '三家都不叫，重新发牌');
      } else if (room.game.status === 'playing') {
        const landlord = room.game.landlordSeat;
        const bottom = (room.game.lastAction?.bottom || [])
          .map((card) => card.display)
          .join(' ');
        this._system(
          room,
          `${playerName(room, landlord)} 成为地主${bottom ? `，底牌：${bottom}` : ''}`,
        );
      }
      this._touch(room);
      this._scheduleBot(room);
      return outcome;
    } catch (error) {
      this._raiseGameError(error);
    }
  }

  action(userId, type, payload = {}) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('牌局尚未开始', 409, 'BAD_STATE');
    const engine = this._engine(room);
    if (!engine.action) throw new RoomError('当前玩法不支持这个操作', 400, 'NO_ACTION');
    const seat = room.players.indexOf(player);
    try {
      const outcome = engine.action(room.game, seat, type, payload);
      const message = outcome.message || this._actionMessage(room, type, payload);
      if (message) this._system(room, `${player.displayName} ${message}`);
      this._completeAction(room);
      return outcome;
    } catch (error) {
      this._raiseGameError(error);
    }
  }

  _actionMessage(room, type, payload) {
    if (room.gameType === 'texas-holdem') {
      if (type === 'fold') return '弃牌';
      if (type === 'check') return '过牌';
      if (type === 'call') return '跟注';
      if (type === 'raise') return `加注到 ${payload.amount ?? '—'}`;
    }
    return '';
  }

  hint(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('牌局尚未开始', 409, 'BAD_STATE');
    if (room.game.status !== 'playing') throw new RoomError('现在还不能出牌', 409, 'NOT_PLAYING');
    const seat = room.players.indexOf(player);
    const engine = this._engine(room);
    const actingSeat = engine.getActingSeat ? engine.getActingSeat(room.game) : room.game.currentSeat;
    if (actingSeat !== seat) throw new RoomError('还没有轮到你', 409, 'NOT_YOUR_TURN');
    return engine.getHint(room.game, seat);
  }

  _raiseGameError(error) {
    if (error instanceof RoomError) throw error;
    if (error?.name === 'GameError' || error?.code) {
      throw new RoomError(error.message || '操作不合法', 400, error.code || 'GAME_ERROR');
    }
    throw error;
  }

  _finishRound(room) {
    if (room.status === 'finished') return;
    const result = room.game?.result;
    if (!result) return;
    room.status = 'finished';
    const entries = result.entries || [];
    entries.forEach((entry) => {
      const player = room.players[entry.seat];
      if (!player) return;
      entry.playerId = player.isBot ? null : player.id;
      entry.playerName = player.displayName;
      entry.isBot = player.isBot;
      entry.scoreBefore = room.scoreboard[playerKey(player)] || 0;
      room.scoreboard[playerKey(player)] = (room.scoreboard[playerKey(player)] || 0) + entry.points;
      entry.totalScore = room.scoreboard[playerKey(player)];
    });
    const winnerPlayers = (result.winnerSeats || [result.winnerSeat])
      .filter((seat) => Number.isInteger(seat))
      .map((seat) => room.players[seat])
      .filter(Boolean);
    const winnerNames = winnerPlayers.map((player) => player.displayName).join('、');
    const headline = result.headline || '本局结束';
    this._system(
      room,
      winnerPlayers.length
        ? `${headline}：${winnerNames} 获胜${result.detail ? ` · ${result.detail}` : ''}`
        : `${headline}${result.detail ? ` · ${result.detail}` : ''}`,
    );

    try {
      recordMatch({
        roomCode: room.code,
        roomName: room.name,
        gameType: room.gameType,
        playerCount: room.players.length,
        winnerUserId: winnerPlayers.find((player) => !player.isBot)?.id ?? null,
        winnerName: winnerNames || headline,
        summary: entries.map((entry) => ({
          name: entry.playerName,
          place: entry.place,
          cardsLeft: entry.cardsLeft,
          points: entry.points,
          totalScore: entry.totalScore,
          role: entry.role,
        })),
      });
      updateGameStats(
        entries.map((entry) => ({
          userId: entry.playerId,
          won: entry.place === 1 || entry.won,
        })),
      );
    } catch (error) {
      console.error('[room] 保存战绩失败', error);
    }

    room.nextStarterSeat = Number.isInteger(result.nextStarterSeat)
      ? result.nextStarterSeat
      : Number.isInteger(result.firstOutSeat)
        ? result.firstOutSeat
        : Number.isInteger(result.winnerSeat)
          ? result.winnerSeat
          : room.nextStarterSeat;
    this._touch(room);
  }

  leaveRoom(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) return null;
    const player = this.findPlayer(room, userId);
    if (!player) return room;
    if (room.status === 'playing') {
      if (player.left) return room;
      this._clearDisconnectTimer(player);
      player.left = true;
      player.managed = true;
      player.connected = false;
      player.disconnectedAt = null;
      if (room.hostId === player.id) this._transferHostToActive(room, player.id);
      this._system(room, `${player.displayName} 离开牌桌，座位由电脑托管`);
      this._updateRoomActivity(room);
      this._scheduleBot(room);
      this._touch(room);
      return room;
    }
    this._removePlayer(room, userId, {});
    return room;
  }

  _removePlayer(room, userId, { kicked = false, silent = false } = {}) {
    const index = room.players.findIndex((player) => !player.isBot && player.id === Number(userId));
    if (index === -1) return;
    const wasHost = room.hostId === Number(userId);
    const wasPlaying = room.status === 'playing';
    const [player] = room.players.splice(index, 1);
    this._clearDisconnectTimer(player);
    this.userRooms.delete(Number(userId));
    if (!silent) {
      this._system(room, `${player.displayName}${kicked ? ' 被房主移出房间' : ' 离开了房间'}`);
    }

    const humans = room.players.filter((item) => !item.isBot);
    if (humans.length === 0) {
      // Keep the room (and its per-room scoreboard) for a short grace period.
      const bots = room.players.filter((item) => item.isBot);
      for (const bot of bots) delete room.scoreboard[playerKey(bot)];
      room.players = [];
      room.hostId = null;
      room.status = 'waiting';
      room.game = null;
      room.nextStarterSeat = 0;
      this._scheduleRoomExpiry(room);
      this._system(room, '房间保留 1 分钟，等待玩家重新加入');
      this._touch(room);
      return;
    }

    if (wasHost) {
      const ordered = [
        ...room.players.slice(index),
        ...room.players.slice(0, index),
      ].filter((item) => !item.isBot);
      const nextHuman =
        ordered.find((item) => item.connected && !item.left && !item.managed) || null;
      room.hostId = nextHuman?.id ?? null;
      if (nextHuman) this._system(room, `${nextHuman.displayName} 成为新房主`);
    }
    if (room.status !== 'waiting') {
      room.status = 'waiting';
      room.game = null;
      room.nextStarterSeat = 0;
      for (const item of room.players) item.ready = false;
      this._system(
        room,
        wasPlaying ? '房主离场，本局中止，房间回到准备状态' : '牌局已结束，房间回到准备状态',
      );
    }
    this._updateRoomActivity(room);
    this._touch(room);
  }

  _scheduleRoomExpiry(room) {
    if (room.cleanupTimer) return;
    room.expiresAt = Date.now() + ROOM_RETENTION_MS;
    room.cleanupTimer = setTimeout(() => {
      room.cleanupTimer = null;
      if (this.rooms.get(room.code) !== room) return;
      if (this._hasActiveHumans(room)) return;
      this._destroyRoom(room);
    }, ROOM_RETENTION_MS);
    if (typeof room.cleanupTimer.unref === 'function') room.cleanupTimer.unref();
  }

  _cancelRoomExpiry(room) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    room.expiresAt = null;
  }

  _destroyRoom(room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.botTimer = null;
    room.cleanupTimer = null;
    for (const player of room.players) {
      if (player.isBot) continue;
      this._clearDisconnectTimer(player);
      this.userRooms.delete(player.id);
    }
    this.rooms.delete(room.code);
    this.onLobbyChange();
    this.onChange(room);
  }

  _system(room, text) {
    room.chat.push({
      id: crypto.randomBytes(6).toString('hex'),
      system: true,
      text: cleanText(text, 240),
      at: now(),
    });
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
  }

  chat(userId, text) {
    const room = this.getRoomForUser(userId);
    if (!room) throw new RoomError('你还没有加入房间', 404, 'NOT_IN_ROOM');
    const player = this.requireActiveMember(room, userId);
    const content = cleanText(text, 160);
    if (!content) throw new RoomError('消息不能为空', 400, 'EMPTY_MESSAGE');
    room.chat.push({
      id: crypto.randomBytes(6).toString('hex'),
      system: false,
      userId: player.id,
      name: player.displayName,
      text: content,
      at: now(),
    });
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
    room.updatedAt = now();
    this.onChange(room);
    return room;
  }

  _touch(room) {
    room.updatedAt = now();
    this.onChange(room);
    this.onLobbyChange();
  }

  evictUser(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) return null;
    if (room.status === 'playing') {
      throw new RoomError('该用户正在牌局中，请先停用账号或等待牌局结束', 409, 'USER_IN_GAME');
    }
    this._removePlayer(room, userId, { kicked: true });
    this.onKicked(room.code, Number(userId));
    return room;
  }

  setConnected(code, userId, connected) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) return;
    const player = room.players.find((item) => !item.isBot && item.id === Number(userId));
    if (!player) return;
    if (connected) {
      if (player.connected && !player.left && !player.managed) {
        this._clearDisconnectTimer(player);
        return;
      }
      this._takeoverSeat(room, player);
      this._updateRoomActivity(room);
      this._touch(room);
      return;
    }
    this._clearDisconnectTimer(player);
    player.connected = false;
    if (player.left) {
      player.managed = true;
      this._updateRoomActivity(room);
      this._touch(room);
      return;
    }
    player.disconnectedAt = now();
    if (!player.managed) this._scheduleDisconnectTimeout(room, player);
    this._updateRoomActivity(room);
    this._touch(room);
  }

  _scheduleBot(room) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    if (room.status !== 'playing' || !room.game) return;
    const game = room.game;
    const engine = this._engine(room);

    if (typeof engine.botAction === 'function') {
      if (game.status !== 'playing') return;
      const actingSeat = engine.getActingSeat ? engine.getActingSeat(game) : game.currentSeat;
      if (actingSeat === null || actingSeat === undefined) return;
      const actingPlayer = room.players[actingSeat];
      if (!actingPlayer || (!actingPlayer.isBot && !actingPlayer.managed)) return;
      const expectedSeat = actingSeat;
      const expectedActionAt = game.lastAction?.at;
      const expectedPhase = game.phase;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (this.rooms.get(room.code) !== room) return;
        if (room.status !== 'playing' || !room.game) return;
        if (room.game.status !== 'playing' || room.game.phase !== expectedPhase) return;
        const currentActingSeat = engine.getActingSeat
          ? engine.getActingSeat(room.game)
          : room.game.currentSeat;
        if (currentActingSeat !== expectedSeat) return;
        if (room.game.lastAction?.at !== expectedActionAt) return;
        try {
          const move = engine.botAction(room.game, expectedSeat);
          if (!move) return;
          const outcome = engine.action(room.game, expectedSeat, move.type, move.payload);
          const message = outcome.message || this._actionMessage(room, move.type, move.payload);
          if (message) this._system(room, `${actingPlayer.displayName} ${message}`);
          if (room.game.status === 'finished') {
            this._finishRound(room);
          } else {
            this._touch(room);
            this._scheduleBot(room);
          }
        } catch (error) {
          console.error('[bot] 自动操作失败', error);
        }
      }, BOT_DELAY_MS + crypto.randomInt(0, Math.min(320, BOT_DELAY_MS)));
      return;
    }

    const bidding = game.status === 'bidding';
    if (!bidding && game.status !== 'playing') return;
    const seat = bidding ? game.biddingSeat : game.currentSeat;
    const player = room.players[seat];
    if (!player || (!player.isBot && !player.managed)) return;
    const expectedStatus = game.status;
    const expectedSeat = seat;
    const expectedActionAt = game.lastAction?.at;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (this.rooms.get(room.code) !== room) return;
      if (room.status !== 'playing' || !room.game) return;
      if (room.game.status !== expectedStatus) return;
      if ((bidding ? room.game.biddingSeat : room.game.currentSeat) !== expectedSeat) return;
      if (room.game.lastAction?.at !== expectedActionAt) return;

      const engine = this._engine(room);
      try {
        if (bidding) {
          const value = engine.botBid(room.game, seat);
          const outcome = engine.bid(room.game, seat, value);
          this._system(
            room,
            value === 0 ? `${player.displayName} 不叫` : `${player.displayName} 叫 ${value} 分`,
          );
          if (outcome.redealt) {
            this._system(room, '三家都不叫，重新发牌');
          } else if (room.game.status === 'playing') {
            const bottom = (room.game.lastAction?.bottom || [])
              .map((card) => card.display)
              .join(' ');
            this._system(
              room,
              `${playerName(room, room.game.landlordSeat)} 成为地主${bottom ? `，底牌：${bottom}` : ''}`,
            );
          }
          this._touch(room);
          this._scheduleBot(room);
          return;
        }

        const suggestions = engine.getHint(room.game, seat);
        if (!suggestions) {
          if (room.game.lastPlay) {
            const outcome = engine.pass(room.game, seat);
            this._system(room, `${player.displayName} 选择不要`);
            if (outcome.pointsAwarded > 0 && room.game.teamScores) {
              const teamLabel = TEAM_LABELS[outcome.team] || '本队';
              this._system(
                room,
                `${teamLabel}收下本墩 ${outcome.pointsAwarded} 分（红队 ${room.game.teamScores[0]} / 蓝队 ${room.game.teamScores[1]}）`,
              );
            }
          } else {
            const fallback = room.game.hands[seat][0];
            const outcome = engine.play(room.game, seat, [fallback.id]);
            this._system(room, this._messageForPlay(room, seat, outcome.combo));
          }
        } else {
          const outcome = engine.play(room.game, seat, suggestions);
          this._system(room, this._messageForPlay(room, seat, outcome.combo));
          if (outcome.combo.bomb || outcome.combo.rocket) {
            const multiplier = Math.max(1, room.game.highestBid) * 2 ** room.game.bombCount;
            this._system(room, `${outcome.combo.name}！当前结算倍数升至 ${multiplier} 倍`);
          }
        }
        if (room.game.status === 'finished') {
          this._finishRound(room);
        } else {
          this._touch(room);
          this._scheduleBot(room);
        }
      } catch (error) {
        console.error('[bot] 自动操作失败', error);
        try {
          if (room.game.status === 'bidding') {
            engine.bid(room.game, room.game.biddingSeat, 0);
            this._touch(room);
            this._scheduleBot(room);
          } else if (room.game.status === 'playing') {
            if (room.game.lastPlay) {
              engine.pass(room.game, room.game.currentSeat);
              if (room.game.status === 'finished') {
                this._finishRound(room);
              } else {
                this._touch(room);
                this._scheduleBot(room);
              }
            } else {
              const fallback = room.game.hands[room.game.currentSeat]?.[0];
              if (fallback) {
                engine.play(room.game, room.game.currentSeat, [fallback.id]);
                if (room.game.status === 'finished') {
                  this._finishRound(room);
                } else {
                  this._touch(room);
                  this._scheduleBot(room);
                }
              }
            }
          }
        } catch (fallbackError) {
          console.error('[bot] 兜底操作失败', fallbackError);
        }
      }
    }, BOT_DELAY_MS + crypto.randomInt(0, Math.min(320, BOT_DELAY_MS)));
  }

  _roomSummary(room) {
    const game = GAME_MAP.get(room.gameType);
    const connected = room.players.filter((player) => player.connected).length;
    return {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      hostName:
        room.players.find((player) => !player.isBot && player.id === room.hostId)?.displayName ||
        '—',
      players: room.players.map((player, seat) => ({
        id: player.id,
        name: player.displayName,
        isBot: player.isBot,
        ready: player.ready,
        connected: player.connected,
        seat,
      })),
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      connected,
      status: room.status,
      gameType: room.gameType,
      gameName: game?.name || room.gameType,
      retained: !this._hasActiveHumans(room),
      expiresAt: room.expiresAt || null,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  listRooms() {
    return [...this.rooms.values()]
      .filter((room) => room.status !== 'finished')
      .sort((a, b) => {
        const order = { waiting: 0, playing: 1 };
        return (order[a.status] ?? 2) - (order[b.status] ?? 2) || b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 60)
      .map((room) => this._roomSummary(room));
  }

  view(room, userId) {
    if (!room) return null;
    const player = this.findPlayer(room, userId);
    if (!player) throw new RoomError('你不在这个房间中', 403, 'NOT_IN_ROOM');
    const seat = room.players.indexOf(player);
    const gameInfo = GAME_MAP.get(room.gameType);
    const engine = this._engine(room);
    const publicGame = room.game ? engine.getPublic(room.game, seat) : null;
    const allReady = room.players.length >= 2 && room.players.every((item) => item.ready);
    const isDou = room.gameType === 'dou-dizhu';
    const isPao = room.gameType === 'pao-yao';

    return {
      code: room.code,
      name: room.name,
      status: room.status,
      gameType: room.gameType,
      game: gameInfo,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      isHost: room.hostId === Number(userId),
      you: {
        id: player.id,
        seat,
        ready: player.ready,
        displayName: player.displayName,
        isHost: room.hostId === Number(userId),
      },
      players: room.players.map((item, index) => {
        const role =
          isDou && room.game ? (room.game.landlordSeat === index ? '地主' : room.game.landlordSeat !== null ? '农民' : null) : null;
        return {
          id: item.id,
          username: item.username,
          displayName: item.displayName,
          isBot: item.isBot,
          avatar: item.avatar || null,
          ready: item.ready,
          connected: item.connected,
          managed: Boolean(item.managed),
          left: Boolean(item.left),
          seat: index,
          isHost: !item.isBot && item.id === room.hostId,
          isYou: !item.isBot && item.id === Number(userId),
          cardCount: room.game ? room.game.hands[index].length : 0,
          passed: Boolean(room.game?.passSeats?.includes(index)),
          finished: Boolean(room.game && room.game.hands[index].length === 0 && room.game.status !== 'bidding'),
          score: room.scoreboard[playerKey(item)] || 0,
          role,
          team: isPao ? index % 2 : null,
          publicState: publicGame?.playerStates?.[index] || null,
        };
      }),
      hand: room.game ? engine.getHand(room.game, seat) : [],
      gamePublic: publicGame,
      canStart:
        room.status === 'waiting' &&
        room.hostId === Number(userId) &&
        room.players.length >= (gameInfo?.minPlayers || 2) &&
        allReady,
      allReady,
      needsReady: room.status === 'waiting' && !player.ready,
      chat: room.chat.slice(-60),
      scoreboard: room.players.map((item) => ({
        id: item.id,
        name: item.displayName,
        isBot: item.isBot,
        score: room.scoreboard[playerKey(item)] || 0,
      })),
      roundNumber: room.roundNumber,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      rules: gameInfo?.rules || null,
    };
  }

  adminSnapshot() {
    return {
      rooms: [...this.rooms.values()]
        .filter((room) => room.status !== 'finished')
        .map((room) => ({
          ...this._roomSummary(room),
          roundNumber: room.roundNumber,
          chatCount: room.chat.length,
        })),
    };
  }
}
