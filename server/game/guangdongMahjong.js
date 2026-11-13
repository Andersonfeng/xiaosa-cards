import crypto from 'node:crypto';

export const GAME_TYPE = 'guangdong-mahjong';
export const GAME_NAME = '广东麻将';

export class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const SUIT_DEFS = [
  { key: 'W', label: '万', order: 0 },
  { key: 'T', label: '条', order: 1 },
  { key: 'B', label: '筒', order: 2 },
];

const WINDS = [
  { key: 'E', label: '东', order: 30 },
  { key: 'S', label: '南', order: 31 },
  { key: 'W', label: '西', order: 32 },
  { key: 'N', label: '北', order: 33 },
];

const DRAGONS = [
  { key: 'C', label: '中', order: 34, color: 'red' },
  { key: 'F', label: '发', order: 35, color: 'green' },
  { key: 'P', label: '白', order: 36, color: 'blue' },
];

const SUIT_MAP = new Map(SUIT_DEFS.map((suit) => [suit.key, suit]));
const HONOR_MAP = new Map([...WINDS, ...DRAGONS].map((honor) => [honor.key, honor]));

export function createTileDeck() {
  const tiles = [];
  for (const suit of SUIT_DEFS) {
    for (let number = 1; number <= 9; number += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        const key = `${suit.key}${number}`;
        tiles.push({
          id: `${key}-${copy}`,
          key,
          kind: 'suited',
          suit: suit.key,
          number,
          label: `${number}${suit.label}`,
          short: `${number}${suit.label}`,
          sortIndex: suit.order * 10 + number,
          honor: false,
          red: false,
        });
      }
    }
  }
  for (const honor of [...WINDS, ...DRAGONS]) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({
        id: `${honor.key}-${copy}`,
        key: honor.key,
        kind: 'honor',
        suit: 'H',
        number: 0,
        label: honor.label,
        short: honor.label,
        sortIndex: honor.order,
        honor: true,
        red: honor.color === 'red',
        color: honor.color || null,
      });
    }
  }
  return tiles;
}

export function shuffleTiles(tiles) {
  const copy = [...tiles];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
}

export function publicTile(tile) {
  return {
    id: tile.id,
    key: tile.key,
    label: tile.label,
    short: tile.short,
    kind: tile.kind,
    suit: tile.suit,
    number: tile.number,
    honor: tile.honor,
    red: tile.red,
    color: tile.color || null,
    sortIndex: tile.sortIndex,
  };
}

function tileKey(tile) {
  return tile.key;
}

function countsOf(tiles) {
  const counts = new Map();
  for (const tile of tiles) {
    const key = tileKey(tile);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function keyInfo(key) {
  if (/^[WTB][1-9]$/.test(key)) {
    return { suited: true, suit: key[0], number: Number(key.slice(1)) };
  }
  return { suited: false, honor: true };
}

function canFormSets(counts, setsNeeded) {
  if (setsNeeded === 0) return [...counts.values()].every((count) => count === 0);
  const keys = [...counts.keys()].filter((key) => counts.get(key) > 0).sort();
  if (keys.length === 0) return false;
  const key = keys[0];
  const count = counts.get(key);
  if (count >= 3) {
    counts.set(key, count - 3);
    if (canFormSets(counts, setsNeeded - 1)) {
      counts.set(key, count);
      return true;
    }
    counts.set(key, count);
  }
  const info = keyInfo(key);
  if (info.suited && info.number <= 7) {
    const next = `${info.suit}${info.number + 1}`;
    const next2 = `${info.suit}${info.number + 2}`;
    if ((counts.get(next) || 0) > 0 && (counts.get(next2) || 0) > 0) {
      counts.set(key, count - 1);
      counts.set(next, counts.get(next) - 1);
      counts.set(next2, counts.get(next2) - 1);
      if (canFormSets(counts, setsNeeded - 1)) {
        counts.set(key, count);
        counts.set(next, counts.get(next) + 1);
        counts.set(next2, counts.get(next2) + 1);
        return true;
      }
      counts.set(key, count);
      counts.set(next, counts.get(next) + 1);
      counts.set(next2, counts.get(next2) + 1);
    }
  }
  return false;
}

export function isSevenPairs(tiles, meldCount) {
  if (meldCount !== 0 || tiles.length !== 14) return false;
  const counts = countsOf(tiles);
  if ([...counts.values()].some((count) => count % 2 !== 0)) return false;
  return true;
}

export function isWinningHand(tiles, meldCount = 0) {
  if (isSevenPairs(tiles, meldCount)) {
    return { win: true, type: '七对' };
  }
  const needed = 14 - meldCount * 3;
  if (tiles.length !== needed) return { win: false };
  const counts = countsOf(tiles);
  const pairKeys = [...counts.keys()].filter((key) => counts.get(key) >= 2);
  for (const pairKey of pairKeys) {
    counts.set(pairKey, counts.get(pairKey) - 2);
    const can = canFormSets(counts, 4 - meldCount);
    counts.set(pairKey, counts.get(pairKey) + 2);
    if (can) return { win: true, type: '平胡' };
  }
  return { win: false };
}

function windForSeat(dealerSeat, seat) {
  return WINDS[(seat - dealerSeat + 4) % 4].label;
}

function teamSeat(game, seat) {
  return (seat - game.dealerSeat + 4) % 4;
}

function createMelds() {
  return [[], [], [], []];
}

function createDiscards() {
  return [[], [], [], []];
}

export function createGame(playerCount, roundNumber = 0, options = {}) {
  if (playerCount !== 4) throw new GameError('广东麻将需要 4 位玩家', 'INVALID_PLAYER_COUNT');
  const dealerSeat = Number.isInteger(options.starterSeat)
    ? options.starterSeat % 4
    : roundNumber % 4;
  const deck = shuffleTiles(createTileDeck());
  const hands = Array.from({ length: 4 }, () => []);
  let index = 0;
  for (let i = 0; i < 13; i += 1) {
    for (let seat = 0; seat < 4; seat += 1) {
      hands[seat].push(deck[index]);
      index += 1;
    }
  }
  hands[dealerSeat].push(deck[index]);
  index += 1;
  const wall = deck.slice(index);
  const game = {
    status: 'playing',
    phase: 'discard',
    playerCount: 4,
    dealerSeat,
    hands: hands.map((hand) => sortTiles(hand)),
    melds: createMelds(),
    discards: createDiscards(),
    wall,
    currentSeat: dealerSeat,
    lastDraw: null,
    lastDiscard: null,
    claim: null,
    lastAction: {
      type: 'start',
      seat: dealerSeat,
      at: new Date().toISOString(),
    },
    roundNumber,
    startedAt: new Date().toISOString(),
    result: null,
    revealedSeats: [],
    finishedAt: null,
  };
  game.canWin = canSelfWin(game, dealerSeat);
  return game;
}

function canSelfWin(game, seat) {
  const result = isWinningHand(game.hands[seat], game.melds[seat].length);
  return result.win ? result : null;
}

function drawFor(game, seat) {
  if (game.wall.length === 0) {
    finishDraw(game);
    return;
  }
  const tile = game.wall.shift();
  game.hands[seat].push(tile);
  game.hands[seat] = sortTiles(game.hands[seat]);
  game.currentSeat = seat;
  game.phase = 'discard';
  game.lastDraw = publicTile(tile);
  game.canWin = canSelfWin(game, seat);
  game.lastAction = {
    type: 'draw',
    seat,
    tile: publicTile(tile),
    at: new Date().toISOString(),
  };
}

function chiOptionsFor(hand, discardTile) {
  if (discardTile.kind !== 'suited') return [];
  const byKey = new Map(hand.map((tile) => [tile.id, tile]));
  const counts = new Map();
  for (const tile of hand) counts.set(tile.key, (counts.get(tile.key) || 0) + 1);
  const number = discardTile.number;
  const suit = discardTile.suit;
  const options = [];
  for (let start = number - 2; start <= number; start += 1) {
    if (start < 1 || start > 7) continue;
    const keys = [start, start + 1, start + 2].map((value) => `${suit}${value}`);
    if (!keys.includes(discardTile.key)) continue;
    const needed = keys.filter((key) => key !== discardTile.key);
    const picked = [];
    let ok = true;
    for (const key of needed) {
      const tile = hand.find((item) => item.key === key && !picked.includes(item));
      if (!tile) {
        ok = false;
        break;
      }
      picked.push(tile);
    }
    if (ok) options.push(picked.map((tile) => tile.id));
  }
  return options;
}

function buildClaimOptions(game, discarder, tile) {
  const options = new Map();
  const pending = [];
  for (let offset = 1; offset < 4; offset += 1) {
    const seat = (discarder + offset) % 4;
    const hand = game.hands[seat];
    const counts = countsOf(hand);
    const canHu = isWinningHand([...hand, tile], game.melds[seat].length).win;
    const canGang = (counts.get(tile.key) || 0) >= 3;
    const canPeng = (counts.get(tile.key) || 0) >= 2;
    const chiOptions = offset === 1 ? chiOptionsFor(hand, tile) : [];
    if (!canHu && !canGang && !canPeng && chiOptions.length === 0) continue;
    options.set(seat, {
      hu: canHu,
      gang: canGang,
      peng: canPeng,
      chi: chiOptions.length > 0,
      chiOptions,
    });
    pending.push(seat);
  }
  return { options, pending };
}

function removeDiscard(game, discarder) {
  const river = game.discards[discarder];
  if (river.length) river.pop();
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function makeResultEntry(game, seat, winnerSeat, winnerPoints, place = 2) {
  return {
    seat,
    place: seat === winnerSeat ? 1 : place,
    cardsLeft: game.hands[seat].length,
    penalty: 0,
    multiplier: 1,
    points: seat === winnerSeat ? winnerPoints : -1,
    won: seat === winnerSeat,
    role: windForSeat(game.dealerSeat, seat),
    label: windForSeat(game.dealerSeat, seat),
    wind: windForSeat(game.dealerSeat, seat),
  };
}

function finishWin(game, winnerSeat, { selfDraw, discarder, winningTile, handType }) {
  if (game.status === 'finished') return;
  if (!selfDraw && discarder !== undefined) {
    removeDiscard(game, discarder);
    game.lastDiscard = null;
  }
  if (winningTile) {
    game.hands[winnerSeat].push(winningTile);
    game.hands[winnerSeat] = sortTiles(game.hands[winnerSeat]);
  }
  game.status = 'finished';
  game.phase = 'finished';
  game.currentSeat = null;
  game.claim = null;
  game.revealedSeats = [winnerSeat];
  const others = [0, 1, 2, 3].filter((seat) => seat !== winnerSeat);
  const entries = [
    makeResultEntry(game, winnerSeat, winnerSeat, 3),
    ...others.map((seat, index) => makeResultEntry(game, seat, winnerSeat, 3, index + 2)),
  ];
  const pointsDelta = entries.reduce((sum, entry) => sum + entry.points, 0);
  if (pointsDelta !== 0) entries[0].points -= pointsDelta;
  game.result = {
    winnerSeat,
    winnerSeats: [winnerSeat],
    headline: selfDraw ? '自摸胡牌' : '点炮胡牌',
    detail: `${handType || '平胡'} · ${selfDraw ? '自摸' : `${playerWind(game, discarder)}家点炮`}`,
    winType: selfDraw ? 'self-draw' : 'discard',
    handType,
    selfDraw,
    discarder: selfDraw ? null : discarder,
    winningTile: winningTile ? publicTile(winningTile) : null,
    entries,
    nextStarterSeat: winnerSeat === game.dealerSeat ? game.dealerSeat : nextSeat(game.dealerSeat),
    firstOutSeat: null,
    winningHand: sortTiles(game.hands[winnerSeat]).map(publicTile),
  };
  game.lastAction = {
    type: 'win',
    seat: winnerSeat,
    at: new Date().toISOString(),
  };
  game.finishedAt = new Date().toISOString();
}

function playerWind(game, seat) {
  return windForSeat(game.dealerSeat, seat);
}

function finishDraw(game) {
  if (game.status === 'finished') return;
  game.status = 'finished';
  game.phase = 'finished';
  game.currentSeat = null;
  game.claim = null;
  const entries = [0, 1, 2, 3].map((seat, index) => ({
    seat,
    place: index + 1,
    cardsLeft: game.hands[seat].length,
    penalty: 0,
    multiplier: 1,
    points: 0,
    won: false,
    role: windForSeat(game.dealerSeat, seat),
    label: windForSeat(game.dealerSeat, seat),
    wind: windForSeat(game.dealerSeat, seat),
  }));
  game.result = {
    winnerSeat: null,
    winnerSeats: [],
    headline: '流局',
    detail: '牌墙已经摸完',
    winType: 'draw',
    entries,
    nextStarterSeat: nextSeat(game.dealerSeat),
    firstOutSeat: null,
  };
  game.lastAction = {
    type: 'draw-game',
    seat: null,
    at: new Date().toISOString(),
  };
  game.finishedAt = new Date().toISOString();
}

function beginClaims(game, discarder, tile) {
  const { options, pending } = buildClaimOptions(game, discarder, tile);
  if (pending.length === 0) {
    drawFor(game, nextSeat(discarder));
    return;
  }
  game.phase = 'claiming';
  game.currentSeat = null;
  game.claim = {
    discarder,
    tile: publicTile(tile),
    rawTile: tile,
    options,
    pending,
    currentSeat: pending[0],
    collected: [],
  };
  game.lastAction = {
    type: 'claim-window',
    seat: pending[0],
    at: new Date().toISOString(),
  };
}

function resolveClaim(game) {
  const claim = game.claim;
  if (!claim) return;
  const { discarder, rawTile, collected, options } = claim;
  game.claim = null;
  const byPriority = ['gang', 'peng', 'chi']
    .map((type) => collected.find((entry) => entry.type === type))
    .filter(Boolean);
  const chosen = byPriority[0];
  if (!chosen) {
    drawFor(game, nextSeat(discarder));
    return;
  }
  const seat = chosen.seat;
  removeDiscard(game, discarder);
  game.lastDiscard = null;
  const hand = game.hands[seat];
  if (chosen.type === 'gang') {
    const remove = hand.filter((tile) => tile.key === rawTile.key).slice(0, 3);
    const removeIds = new Set(remove.map((tile) => tile.id));
    game.hands[seat] = hand.filter((tile) => !removeIds.has(tile.id));
    game.melds[seat].push({
      type: 'gang',
      tiles: [...remove, rawTile].map(publicTile),
      fromSeat: discarder,
      key: rawTile.key,
    });
    game.currentSeat = seat;
    game.phase = 'discard';
    game.lastAction = {
      type: 'claim',
      seat,
      claimType: 'gang',
      tile: publicTile(rawTile),
      at: new Date().toISOString(),
    };
    // Replacement draw after a kong.
    drawFor(game, seat);
    return;
  }
  if (chosen.type === 'peng') {
    const remove = hand.filter((tile) => tile.key === rawTile.key).slice(0, 2);
    const removeIds = new Set(remove.map((tile) => tile.id));
    game.hands[seat] = hand.filter((tile) => !removeIds.has(tile.id));
    game.melds[seat].push({
      type: 'peng',
      tiles: [...remove, rawTile].map(publicTile),
      fromSeat: discarder,
      key: rawTile.key,
    });
  } else if (chosen.type === 'chi') {
    const option = options.get(seat)?.chiOptions?.[0];
    const remove = (option || [])
      .map((id) => hand.find((tile) => tile.id === id))
      .filter(Boolean);
    const removeIds = new Set(remove.map((tile) => tile.id));
    game.hands[seat] = hand.filter((tile) => !removeIds.has(tile.id));
    game.melds[seat].push({
      type: 'chi',
      tiles: [...remove, rawTile].map(publicTile),
      fromSeat: discarder,
      key: rawTile.key,
    });
  }
  game.currentSeat = seat;
  game.phase = 'discard';
  game.lastDraw = null;
  game.canWin = null;
  game.lastAction = {
    type: 'claim',
    seat,
    claimType: chosen.type,
    tile: publicTile(rawTile),
    at: new Date().toISOString(),
  };
}

export function discardTile(game, seat, tileId) {
  if (!game || game.status !== 'playing') throw new GameError('牌局已经结束', 'NOT_PLAYING');
  if (game.phase !== 'discard' || game.currentSeat !== seat) {
    throw new GameError('现在还不能出牌', 'NOT_YOUR_TURN');
  }
  const index = game.hands[seat].findIndex((tile) => tile.id === tileId);
  if (index === -1) throw new GameError('手牌中没有这张牌', 'TILE_NOT_IN_HAND');
  const [tile] = game.hands[seat].splice(index, 1);
  game.discards[seat].push(tile);
  game.lastDiscard = { seat, tile: publicTile(tile) };
  game.lastDraw = null;
  game.canWin = null;
  game.lastAction = {
    type: 'discard',
    seat,
    tile: publicTile(tile),
    at: new Date().toISOString(),
  };
  beginClaims(game, seat, tile);
  return { tile: publicTile(tile) };
}

export function claim(game, seat, type, payload = {}) {
  if (!game || game.status !== 'playing' || game.phase !== 'claiming' || !game.claim) {
    throw new GameError('现在没有可鸣的牌', 'NO_CLAIM');
  }
  if (game.claim.currentSeat !== seat) throw new GameError('还没有轮到你操作鸣牌', 'NOT_YOUR_CLAIM');
  const options = game.claim.options.get(seat);
  if (!options) throw new GameError('你没有可用的鸣牌操作', 'INVALID_CLAIM');
  if (type === 'pass') {
    game.claim.pending.shift();
    game.claim.collected = game.claim.collected.filter((entry) => entry.seat !== seat);
    if (game.claim.pending.length === 0) {
      resolveClaim(game);
    } else {
      game.claim.currentSeat = game.claim.pending[0];
      game.lastAction = {
        type: 'claim-pass',
        seat,
        at: new Date().toISOString(),
      };
    }
    return { passed: true };
  }
  if (type === 'hu') {
    if (!options.hu) throw new GameError('当前不能胡这张牌', 'CANNOT_HU');
    const tile = game.claim.rawTile;
    const discarder = game.claim.discarder;
    const win = isWinningHand([...game.hands[seat], tile], game.melds[seat].length);
    finishWin(game, seat, {
      selfDraw: false,
      discarder,
      winningTile: tile,
      handType: win.type,
    });
    return { finished: true, result: game.result };
  }
  if (!['gang', 'peng', 'chi'].includes(type) || !options[type]) {
    throw new GameError('当前不能执行该操作', 'INVALID_CLAIM');
  }
  game.claim.collected.push({ type, seat, payload });
  game.claim.pending.shift();
  if (game.claim.pending.length === 0) {
    resolveClaim(game);
  } else {
    game.claim.currentSeat = game.claim.pending[0];
    game.lastAction = {
      type: 'claim',
      seat,
      claimType: type,
      tile: game.claim.tile,
      at: new Date().toISOString(),
    };
  }
  return { collected: true };
}

export function declareSelfWin(game, seat) {
  if (!game || game.status !== 'playing' || game.phase !== 'discard' || game.currentSeat !== seat) {
    throw new GameError('现在不能胡牌', 'CANNOT_HU');
  }
  const win = canSelfWin(game, seat);
  if (!win) throw new GameError('手牌尚未胡牌', 'CANNOT_HU');
  finishWin(game, seat, { selfDraw: true, handType: win.type });
  return { finished: true, result: game.result };
}

export function getActingSeat(game) {
  if (!game || game.status !== 'playing') return null;
  if (game.phase === 'claiming') return game.claim?.currentSeat ?? null;
  return game.currentSeat;
}

export function getHand(game, seat) {
  if (!game?.hands?.[seat]) return [];
  return sortTiles(game.hands[seat]).map(publicTile);
}

export function getPublicGame(game, viewerSeat = null) {
  if (!game) return null;
  const claim = game.claim;
  const viewerClaim = claim?.currentSeat === viewerSeat && claim.options.get(viewerSeat)
    ? claim.options.get(viewerSeat)
    : null;
  const canWin = game.phase === 'discard' && game.currentSeat === viewerSeat
    ? Boolean(canSelfWin(game, viewerSeat))
    : false;
  const playerStates = Array.from({ length: 4 }, (_, seat) => ({
    seat,
    wind: windForSeat(game.dealerSeat, seat),
    dealer: seat === game.dealerSeat,
    handCount: game.hands[seat].length,
    melds: game.melds[seat],
    discards: game.discards[seat].map(publicTile),
    isTurn: game.phase === 'discard' && game.currentSeat === seat,
    isClaiming: claim?.currentSeat === seat,
  }));
  return {
    gameType: GAME_TYPE,
    status: game.status,
    phase: game.phase,
    playerCount: 4,
    dealerSeat: game.dealerSeat,
    currentSeat: game.currentSeat,
    wallCount: game.wall.length,
    handCounts: game.hands.map((hand) => hand.length),
    discards: game.discards.map((river) => river.map(publicTile)),
    melds: game.melds.map((melds) =>
      melds.map((meld) => ({ ...meld, tiles: meld.tiles.map(publicTile) })),
    ),
    lastDiscard: game.lastDiscard,
    lastDraw: game.lastDraw,
    claim: claim
      ? {
          discarder: claim.discarder,
          tile: claim.tile,
          currentSeat: claim.currentSeat,
          options: viewerClaim,
          pendingSeats: [...claim.pending],
        }
      : null,
    canWin,
    availableActions:
      game.status === 'playing'
        ? {
            discard:
              game.phase === 'discard' && game.currentSeat === viewerSeat,
            hu: canWin,
            claim: viewerClaim
              ? {
                  currentSeat: claim.currentSeat,
                  ...viewerClaim,
                }
              : null,
          }
        : null,
    playerStates,
    lastAction: game.lastAction,
    roundNumber: game.roundNumber,
    result: game.result,
    dealerWind: windForSeat(game.dealerSeat, game.dealerSeat),
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
  };
}

/* ---------- bots ---------- */

function discardScore(hand, tile) {
  const counts = countsOf(hand);
  const count = counts.get(tile.key) || 0;
  let score = count * 5;
  if (tile.kind === 'suited') {
    const suit = tile.suit;
    const number = tile.number;
    for (const delta of [-2, -1, 1, 2]) {
      const neighbor = `${suit}${number + delta}`;
      if (number + delta >= 1 && number + delta <= 9 && counts.has(neighbor)) {
        score += Math.abs(delta) === 1 ? 3 : 1;
      }
    }
    if (number >= 3 && number <= 7) score += 1;
  }
  if (tile.honor) score -= 1;
  return score;
}

function chooseDiscard(game, seat) {
  const hand = game.hands[seat];
  let best = hand[0];
  let bestScore = Infinity;
  for (const tile of hand) {
    const score = discardScore(hand, tile);
    if (score < bestScore) {
      best = tile;
      bestScore = score;
    }
  }
  return best?.id;
}

export function botAction(game, seat) {
  if (!game || game.status !== 'playing') return null;
  if (game.phase === 'claiming') {
    if (game.claim?.currentSeat !== seat) return null;
    const options = game.claim.options.get(seat);
    if (!options) return { type: 'pass', payload: {} };
    if (options.hu) return { type: 'hu', payload: {} };
    if (options.gang) return { type: 'gang', payload: {} };
    if (options.peng) return { type: 'peng', payload: {} };
    if (options.chi) return { type: 'chi', payload: {} };
    return { type: 'pass', payload: {} };
  }
  if (game.phase !== 'discard' || game.currentSeat !== seat) return null;
  if (canSelfWin(game, seat)) return { type: 'hu', payload: {} };
  return { type: 'discard', payload: { tileId: chooseDiscard(game, seat) } };
}

export function act(game, seat, type, payload = {}) {
  if (type === 'discard') {
    const result = discardTile(game, seat, payload.tileId);
    return {
      ...result,
      message: `打出 ${result.tile.label}`,
    };
  }
  if (type === 'hu') {
    if (game.phase === 'claiming') {
      const allowed = game.claim?.options.get(seat)?.hu;
      if (!allowed) throw new GameError('当前不能胡这张牌', 'CANNOT_HU');
      const tile = game.claim.rawTile;
      const win = isWinningHand([...game.hands[seat], tile], game.melds[seat].length);
      finishWin(game, seat, {
        selfDraw: false,
        discarder: game.claim.discarder,
        winningTile: tile,
        handType: win.type,
      });
      return { finished: true, result: game.result, message: '胡牌' };
    }
    const result = declareSelfWin(game, seat);
    return { ...result, message: '自摸胡牌' };
  }
  if (['peng', 'gang', 'chi', 'pass'].includes(type)) {
    const result = claim(game, seat, type, payload);
    const labels = { pass: '不要', peng: '碰', gang: '杠', chi: '吃' };
    return { ...result, message: labels[type] };
  }
  throw new GameError('未知操作', 'UNKNOWN_ACTION');
}

export function getHint() {
  return null;
}

export const _test = {
  canFormSets,
  isWinningHand,
  chiOptionsFor,
};
