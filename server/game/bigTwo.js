import crypto from 'node:crypto';

export const GAME_TYPE = 'big-two';
export const GAME_NAME = '锄大地';

export const SUITS = [
  { id: 'D', symbol: '♦', name: '方块', order: 0, red: true },
  { id: 'C', symbol: '♣', name: '梅花', order: 1, red: false },
  { id: 'H', symbol: '♥', name: '红桃', order: 2, red: true },
  { id: 'S', symbol: '♠', name: '黑桃', order: 3, red: false },
];

const SUIT_BY_ID = new Map(SUITS.map((suit) => [suit.id, suit]));
const RANK_LABELS = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
};

const KIND_META = {
  single: { name: '单张', category: 0 },
  pair: { name: '对子', category: 0 },
  triple: { name: '三条', category: 0 },
  straight: { name: '顺子', category: 1 },
  flush: { name: '同花', category: 2 },
  'full-house': { name: '葫芦', category: 3 },
  'four-kind': { name: '四条', category: 4 },
  'straight-flush': { name: '同花顺', category: 5 },
};

export class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 15; rank += 1) {
      deck.push({
        id: `${suit.id}${rank}`,
        rank,
        suit: suit.id,
        label: RANK_LABELS[rank],
        symbol: suit.symbol,
        red: suit.red,
        suitOrder: suit.order,
      });
    }
  }
  return deck;
}

export function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortCards(cards, direction = 'asc') {
  const sorted = [...cards].sort(
    (a, b) => a.rank - b.rank || a.suitOrder - b.suitOrder,
  );
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export function publicCard(card) {
  const suit = SUIT_BY_ID.get(card.suit);
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    suitSymbol: suit.symbol,
    label: card.label,
    red: suit.red,
    joker: false,
    strength: card.rank,
    display: `${suit.symbol}${card.label}`,
  };
}

function rankCounts(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return counts;
}

function highestSuit(cards) {
  return Math.max(...cards.map((card) => SUIT_BY_ID.get(card.suit).order));
}

/**
 * Return the high comparison value if the five cards form a sequence.
 * House rules: 3-4-5-6-7 through 10-J-Q-K-A, plus A-2-3-4-5 and 2-3-4-5-6.
 * 2 cannot appear at the top of a straight (J-Q-K-A-2 is invalid).
 */
export function straightHighValue(cards) {
  if (cards.length !== 5) return null;
  const ranks = cards.map((card) => card.rank);
  if (new Set(ranks).size !== 5) return null;

  if (!ranks.includes(15)) {
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted[4] - sorted[0] === 4) return sorted[4];
  }

  // Low mapping: A=1, 2=2; this covers A-2-3-4-5 and 2-3-4-5-6.
  const low = [...ranks]
    .map((rank) => (rank === 14 ? 1 : rank === 15 ? 2 : rank))
    .sort((a, b) => a - b);
  if (new Set(low).size === 5 && low[4] - low[0] === 4) {
    return low[4];
  }
  return null;
}

/**
 * Classify a set of 1, 2, 3 or 5 cards into a legal Big Two combination.
 */
export function classifyCards(rawCards) {
  if (!Array.isArray(rawCards)) throw new GameError('牌型数据无效', 'INVALID_CARDS');
  const cards = [...rawCards];
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) throw new GameError('包含重复的牌', 'DUPLICATE_CARDS');
  if (![1, 2, 3, 5].includes(cards.length)) {
    throw new GameError('只能出 1、2、3 或 5 张牌', 'INVALID_SIZE');
  }
  if (cards.some((card) => !card || !SUIT_BY_ID.has(card.suit) || !RANK_LABELS[card.rank])) {
    throw new GameError('包含未知的牌', 'INVALID_CARDS');
  }

  const counts = rankCounts(cards);

  if (cards.length === 1) {
    const [card] = cards;
    return makeCombo('single', cards, [card.rank], SUIT_BY_ID.get(card.suit).order);
  }

  if (cards.length === 2) {
    if (counts.size !== 1) throw new GameError('对子需要两张点数相同的牌', 'INVALID_COMBO');
    const rank = cards[0].rank;
    return makeCombo('pair', cards, [rank], highestSuit(cards));
  }

  if (cards.length === 3) {
    if (counts.size !== 1) throw new GameError('三条需要三张点数相同的牌', 'INVALID_COMBO');
    const rank = cards[0].rank;
    return makeCombo('triple', cards, [rank], highestSuit(cards));
  }

  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = straightHighValue(cards);
  const shape = [...counts.values()].sort((a, b) => b - a).join('-');

  if (flush && straightHigh !== null) {
    const topCards = cards.filter((card) => {
      if (card.rank === straightHigh) return true;
      return straightHigh === 5 && card.rank === 14;
    });
    return makeCombo(
      'straight-flush',
      cards,
      [straightHigh],
      Math.max(...topCards.map((card) => SUIT_BY_ID.get(card.suit).order)),
    );
  }

  if (straightHigh !== null) {
    const topCard = cards.find((card) => card.rank === straightHigh) || cards[0];
    return makeCombo(
      'straight',
      cards,
      [straightHigh],
      SUIT_BY_ID.get(topCard.suit).order,
    );
  }

  if (flush) {
    const ranks = [...counts.keys()].sort((a, b) => b - a);
    return makeCombo('flush', cards, ranks, highestSuit(cards));
  }

  if (shape === '4-1') {
    const quad = [...counts.entries()].find(([, count]) => count === 4)[0];
    const kicker = [...counts.keys()].find((rank) => rank !== quad);
    return makeCombo('four-kind', cards, [quad, kicker], 0);
  }

  if (shape === '3-2') {
    const triple = [...counts.entries()].find(([, count]) => count === 3)[0];
    const pair = [...counts.entries()].find(([, count]) => count === 2)[0];
    return makeCombo('full-house', cards, [triple, pair], 0);
  }

  throw new GameError('这五张牌不能组成合法牌型', 'INVALID_COMBO');
}

function makeCombo(kind, cards, primary, tieSuit) {
  const meta = KIND_META[kind];
  return {
    kind,
    name: meta.name,
    category: meta.category,
    size: cards.length,
    primary,
    tieSuit,
    cards: sortCards(cards, 'desc').map(publicCard),
  };
}

/**
 * Returns >0 when a is stronger, <0 when b is stronger, 0 on an exact tie,
 * and null when the two plays cannot be compared.
 */
export function compareCombos(a, b) {
  if (!a || !b || a.size !== b.size) return null;
  if (a.size < 5 && a.kind !== b.kind) return null;
  if (a.size === 5 && a.category !== b.category) return a.category - b.category;

  const len = Math.max(a.primary.length, b.primary.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.primary[i] ?? 0;
    const bv = b.primary[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  if (a.tieSuit !== b.tieSuit) return a.tieSuit - b.tieSuit;
  return 0;
}

export function canBeat(candidate, previous) {
  const result = compareCombos(candidate, previous);
  return result !== null && result > 0;
}

function combinations(items, size) {
  const output = [];
  const chosen = [];
  function walk(start) {
    if (chosen.length === size) {
      output.push([...chosen]);
      return;
    }
    const remaining = size - chosen.length;
    for (let i = start; i <= items.length - remaining; i += 1) {
      chosen.push(items[i]);
      walk(i + 1);
      chosen.pop();
    }
  }
  walk(0);
  return output;
}

const STRAIGHT_SEQUENCES = [
  [3, 4, 5, 6, 7],
  [4, 5, 6, 7, 8],
  [5, 6, 7, 8, 9],
  [6, 7, 8, 9, 10],
  [7, 8, 9, 10, 11],
  [8, 9, 10, 11, 12],
  [9, 10, 11, 12, 13],
  [10, 11, 12, 13, 14],
  [14, 15, 3, 4, 5],
  [15, 3, 4, 5, 6],
];

function groupByRank(hand) {
  const grouped = new Map();
  for (const card of hand) {
    if (!grouped.has(card.rank)) grouped.set(card.rank, []);
    grouped.get(card.rank).push(card);
  }
  return grouped;
}

function dedupeCombos(comboLists) {
  const seen = new Set();
  const output = [];
  for (const list of comboLists) {
    for (const cards of list) {
      const key = cards
        .map((card) => card.id)
        .sort()
        .join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(cards);
    }
  }
  return output;
}

/**
 * Generate every candidate card set of the requested size from a hand.
 * Generation is structural rather than powerset-based so that 26-card
 * two-player hands remain fast enough for hints and bots.
 */
export function generateCandidates(hand, size) {
  const grouped = groupByRank(hand);
  if (size === 1) {
    return hand.map((card) => [card]);
  }
  if (size === 2 || size === 3) {
    const result = [];
    for (const cards of grouped.values()) {
      if (cards.length >= size) result.push(...combinations(cards, size));
    }
    return result;
  }
  if (size !== 5) return [];

  const lists = [];

  // Straight-shaped candidates (also discovers straight flushes).
  for (const sequence of STRAIGHT_SEQUENCES) {
    if (!sequence.every((rank) => grouped.has(rank))) continue;
    const choices = sequence.map((rank) => grouped.get(rank));
    let hands = [[]];
    for (const cards of choices) {
      const next = [];
      for (const partial of hands) {
        for (const card of cards) next.push([...partial, card]);
      }
      hands = next;
    }
    lists.push(hands);
  }

  // Flushes.
  for (const suit of SUITS) {
    const cards = hand.filter((card) => card.suit === suit.id);
    if (cards.length >= 5) lists.push(combinations(cards, 5));
  }

  const triples = [...grouped.values()].filter((cards) => cards.length >= 3);
  const pairs = [...grouped.values()].filter((cards) => cards.length >= 2);
  const quads = [...grouped.values()].filter((cards) => cards.length === 4);

  // Full houses.
  for (const tripleCards of triples) {
    for (const pairCards of pairs) {
      if (tripleCards[0].rank === pairCards[0].rank) continue;
      for (const three of combinations(tripleCards, 3)) {
        for (const two of combinations(pairCards, 2)) lists.push([[...three, ...two]]);
      }
    }
  }

  // Four of a kind plus a kicker.
  for (const quadCards of quads) {
    for (const kicker of hand) {
      if (kicker.rank === quadCards[0].rank) continue;
      lists.push([[...quadCards, kicker]]);
    }
  }

  return dedupeCombos(lists);
}

export function findHint(hand, previousCombo) {
  if (!previousCombo) {
    const lowest = sortCards(hand, 'asc')[0];
    return lowest ? [lowest] : null;
  }
  const candidates = generateCandidates(hand, previousCombo.size);
  let best = null;
  let bestCombo = null;
  for (const cards of candidates) {
    let combo;
    try {
      combo = classifyCards(cards);
    } catch {
      continue;
    }
    if (!canBeat(combo, previousCombo)) continue;
    const diff = compareCombos(combo, bestCombo);
    if (!bestCombo || diff < 0) {
      best = cards;
      bestCombo = combo;
    }
  }
  return best ? sortCards(best, 'desc') : null;
}

export function hasPlayable(hand, previousCombo) {
  return Boolean(findHint(hand, previousCombo));
}

export function dealCards(playerCount, roundNumber = 0) {
  const deck = shuffle(createDeck());
  const extraSeat = playerCount === 3 ? roundNumber % playerCount : 0;
  const counts = Array.from({ length: playerCount }, () => Math.floor(52 / playerCount));
  for (let i = 0; i < 52 % playerCount; i += 1) {
    counts[(extraSeat + i) % playerCount] += 1;
  }
  const hands = Array.from({ length: playerCount }, () => []);
  let deckIndex = 0;
  let round = 0;
  while (deckIndex < deck.length) {
    for (let offset = 0; offset < playerCount && deckIndex < deck.length; offset += 1) {
      const seat = (extraSeat + offset) % playerCount;
      if (hands[seat].length >= counts[seat]) continue;
      hands[seat].push(deck[deckIndex]);
      deckIndex += 1;
    }
    round += 1;
    if (round > 40) break;
  }
  return hands.map((hand) => sortCards(hand, 'desc'));
}

export function createGame(playerCount, roundNumber = 0) {
  const hands = dealCards(playerCount, roundNumber);
  const starterSeat = hands.findIndex((hand) => hand.some((card) => card.id === 'D3'));
  const startSeat = starterSeat >= 0 ? starterSeat : 0;
  return {
    status: 'playing',
    hands,
    initialCounts: hands.map((hand) => hand.length),
    playerCount,
    starterSeat: startSeat,
    currentSeat: startSeat,
    lastPlay: null,
    passSeats: [],
    turnCount: 0,
    roundNumber,
    startedAt: new Date().toISOString(),
    lastAction: {
      type: 'start',
      seat: startSeat,
      combo: null,
      at: new Date().toISOString(),
    },
    result: null,
  };
}

function nextSeat(game, fromSeat) {
  for (let offset = 1; offset <= game.playerCount; offset += 1) {
    const seat = (fromSeat + offset) % game.playerCount;
    if (!game.passSeats.includes(seat) && game.hands[seat].length > 0) return seat;
  }
  return fromSeat;
}

function scoreRound(game, winnerSeat) {
  const winnerHand = game.hands[winnerSeat].length;
  if (winnerHand !== 0) return null;

  const seats = Array.from({ length: game.playerCount }, (_, seat) => seat);
  const others = seats
    .filter((seat) => seat !== winnerSeat)
    .sort((a, b) => {
      const diff = game.hands[a].length - game.hands[b].length;
      return diff !== 0 ? diff : a - b;
    });
  const ranking = [winnerSeat, ...others];

  const entries = ranking.map((seat, index) => {
    const cardsLeft = game.hands[seat].length;
    const initial = game.initialCounts[seat];
    let multiplier = 1;
    if (cardsLeft >= initial) multiplier = 3;
    else if (cardsLeft >= Math.ceil(initial * 0.75)) multiplier = 2;
    const penalty = cardsLeft === 0 ? 0 : cardsLeft * multiplier;
    return {
      seat,
      place: index + 1,
      cardsLeft,
      multiplier,
      penalty,
      points: 0,
      won: seat === winnerSeat,
      initial,
    };
  });

  const totalPenalty = entries.reduce((sum, entry) => sum + entry.penalty, 0);
  for (const entry of entries) {
    entry.points = entry.seat === winnerSeat ? totalPenalty : -entry.penalty;
  }

  return {
    winnerSeat,
    winnerSeats: [winnerSeat],
    ranking,
    entries,
    totalPenalty,
    headline: '锄大地胜利',
    detail: `本局共 ${totalPenalty} 分`,
    winType: '出完手牌',
  };
}

export function playCards(game, seat, cardIds) {
  if (!game || game.status !== 'playing') throw new GameError('牌局尚未开始或已结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你出牌', 'NOT_YOUR_TURN');
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    throw new GameError('请选择要出的牌', 'NO_CARDS');
  }
  if (new Set(cardIds).size !== cardIds.length) {
    throw new GameError('包含重复的牌', 'DUPLICATE_CARDS');
  }

  const hand = game.hands[seat];
  const selected = [];
  for (const id of cardIds) {
    const card = hand.find((item) => item.id === id);
    if (!card) throw new GameError('手牌中没有这张牌', 'CARD_NOT_IN_HAND');
    selected.push(card);
  }

  if (game.turnCount === 0 && !selected.some((card) => card.id === 'D3')) {
    throw new GameError('首轮出牌必须包含方块 3', 'MUST_INCLUDE_THREE');
  }

  const combo = classifyCards(selected);
  if (game.lastPlay && !canBeat(combo, game.lastPlay.combo)) {
    throw new GameError(
      `需要出大过「${game.lastPlay.combo.name}」的同张数牌型`,
      'NOT_BEATING',
    );
  }

  const selectedIds = new Set(cardIds);
  game.hands[seat] = hand.filter((card) => !selectedIds.has(card.id));
  game.lastPlay = { seat, combo };
  game.turnCount += 1;
  game.lastAction = {
    type: 'play',
    seat,
    combo,
    at: new Date().toISOString(),
  };

  if (game.hands[seat].length === 0) {
    const result = scoreRound(game, seat);
    game.status = 'finished';
    game.currentSeat = null;
    game.result = result;
    game.finishedAt = new Date().toISOString();
    game.lastAction.type = 'win';
    return { combo, finished: true, result };
  }

  game.currentSeat = nextSeat(game, seat);
  return { combo, finished: false, nextSeat: game.currentSeat };
}

export function passTurn(game, seat) {
  if (!game || game.status !== 'playing') throw new GameError('牌局尚未开始或已结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你', 'NOT_YOUR_TURN');
  if (!game.lastPlay) throw new GameError('你是本轮先手，必须出牌', 'MUST_LEAD');

  if (!game.passSeats.includes(seat)) game.passSeats.push(seat);
  game.lastAction = {
    type: 'pass',
    seat,
    combo: null,
    at: new Date().toISOString(),
  };

  const leader = game.lastPlay.seat;
  const otherPlayers = game.playerCount - 1;
  if (game.passSeats.length >= otherPlayers) {
    game.lastPlay = null;
    game.passSeats = [];
    game.currentSeat = leader;
    game.lastAction = {
      type: 'new-trick',
      seat: leader,
      combo: null,
      at: new Date().toISOString(),
    };
    return { newTrick: true, nextSeat: leader };
  }

  game.currentSeat = nextSeat(game, seat);
  return { newTrick: false, nextSeat: game.currentSeat };
}

export function getHand(game, seat) {
  if (!game || !game.hands[seat]) return [];
  return sortCards(game.hands[seat], 'desc').map(publicCard);
}

export function getPublicGame(game) {
  if (!game) return null;
  return {
    status: game.status,
    playerCount: game.playerCount,
    currentSeat: game.currentSeat,
    starterSeat: game.starterSeat,
    lastPlay: game.lastPlay
      ? {
          seat: game.lastPlay.seat,
          combo: {
            kind: game.lastPlay.combo.kind,
            name: game.lastPlay.combo.name,
            category: game.lastPlay.combo.category,
            size: game.lastPlay.combo.size,
            cards: game.lastPlay.combo.cards,
          },
        }
      : null,
    passSeats: [...game.passSeats],
    handCounts: game.hands.map((hand) => hand.length),
    turnCount: game.turnCount,
    roundNumber: game.roundNumber,
    lastAction: game.lastAction,
    result: game.result,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt || null,
  };
}

export function describeCombo(cards) {
  try {
    return classifyCards(cards);
  } catch {
    return null;
  }
}
