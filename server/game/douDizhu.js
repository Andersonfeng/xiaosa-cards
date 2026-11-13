import {
  createDeck,
  combinations,
  groupByRank,
  publicCard,
  shuffle,
  sortCards,
} from './cards54.js';

export const GAME_TYPE = 'dou-dizhu';
export const GAME_NAME = '斗地主';

export class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const strengthOf = (card) => card.rank;

const KIND_META = {
  single: { name: '单张' },
  pair: { name: '对子' },
  triple: { name: '三条' },
  'triple-single': { name: '三带一' },
  'triple-pair': { name: '三带二' },
  straight: { name: '顺子' },
  'pair-straight': { name: '连对' },
  airplane: { name: '飞机' },
  'airplane-single': { name: '飞机带单' },
  'airplane-pair': { name: '飞机带对' },
  'four-two-single': { name: '四带二' },
  'four-two-pair': { name: '四带两对' },
  bomb: { name: '炸弹' },
  rocket: { name: '王炸' },
};

function makeCombo(kind, cards, primary, extra = {}) {
  const meta = KIND_META[kind];
  return {
    kind,
    name: meta.name,
    size: cards.length,
    primary,
    cards: sortCards(cards, strengthOf, 'desc').map((card) => publicCard(card, card.rank)),
    bomb: kind === 'bomb',
    rocket: kind === 'rocket',
    ...extra,
  };
}

function isConsecutive(ranks) {
  if (ranks.length < 2) return false;
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function findRuns(ranks, length) {
  const eligible = [...new Set(ranks)].filter((rank) => rank >= 3 && rank <= 14).sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i <= eligible.length - length; i += 1) {
    const slice = eligible.slice(i, i + length);
    if (isConsecutive(slice)) runs.push(slice);
  }
  return runs;
}

function classifyStraight(cards) {
  if (cards.length < 5) return null;
  const counts = rankCounts(cards);
  if (counts.size !== cards.length) return null;
  if ([...counts.keys()].some((rank) => rank > 14)) return null;
  if (!isConsecutive([...counts.keys()])) return null;
  return makeCombo('straight', cards, [Math.max(...counts.keys())]);
}

function classifyPairStraight(cards) {
  if (cards.length < 6 || cards.length % 2 !== 0) return null;
  const counts = rankCounts(cards);
  if ([...counts.values()].some((count) => count !== 2)) return null;
  if ([...counts.keys()].some((rank) => rank > 14)) return null;
  if (!isConsecutive([...counts.keys()])) return null;
  return makeCombo('pair-straight', cards, [Math.max(...counts.keys())]);
}

function rankCounts(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return counts;
}

function classifyAirplane(cards) {
  const counts = rankCounts(cards);
  const size = cards.length;
  const tripleRanks = [...counts.entries()]
    .filter(([rank, count]) => rank <= 14 && count >= 3)
    .map(([rank]) => rank);

  // Pure airplane: 333444, 333444555, ...
  if (size % 3 === 0 && size >= 6) {
    const n = size / 3;
    for (const run of findRuns(tripleRanks, n)) {
      if (run.every((rank) => counts.get(rank) === 3) && counts.size === n) {
        return makeCombo('airplane', cards, [run[run.length - 1]], { chain: n });
      }
    }
  }

  // Airplane with single wings: 333444 + 2 kickers.
  if (size % 4 === 0 && size >= 8) {
    const n = size / 4;
    for (const run of findRuns(tripleRanks, n)) {
      if (!run.every((rank) => counts.get(rank) >= 3)) continue;
      const remaining = new Map(counts);
      for (const rank of run) remaining.set(rank, remaining.get(rank) - 3);
      const wingsOk = run.every((rank) => remaining.get(rank) === 0);
      if (!wingsOk) continue;
      const wingCount = [...remaining.values()].reduce((sum, count) => sum + count, 0);
      if (wingCount !== n) continue;
      return makeCombo('airplane-single', cards, [run[run.length - 1]], { chain: n });
    }
  }

  // Airplane with pair wings: 333444 + 2 pairs.
  if (size % 5 === 0 && size >= 10) {
    const n = size / 5;
    for (const run of findRuns(tripleRanks, n)) {
      if (!run.every((rank) => counts.get(rank) >= 3)) continue;
      const remaining = new Map(counts);
      for (const rank of run) remaining.set(rank, remaining.get(rank) - 3);
      if (!run.every((rank) => remaining.get(rank) === 0)) continue;
      const pairs = [...remaining.values()].filter((count) => count === 2).length;
      const total = [...remaining.values()].reduce((sum, count) => sum + count, 0);
      if (pairs === n && total === n * 2) {
        return makeCombo('airplane-pair', cards, [run[run.length - 1]], { chain: n });
      }
    }
  }

  return null;
}

function classifyFourWithKickers(cards) {
  const counts = rankCounts(cards);
  const quads = [...counts.entries()].filter(([, count]) => count === 4).map(([rank]) => rank);
  if (quads.length !== 1) return null;
  const quad = quads[0];
  if (cards.length === 6) {
    const others = [...counts.entries()].filter(([rank]) => rank !== quad);
    const total = others.reduce((sum, [, count]) => sum + count, 0);
    if (total === 2) {
      return makeCombo('four-two-single', cards, [quad]);
    }
  }
  if (cards.length === 8) {
    const pairs = [...counts.entries()].filter(([rank, count]) => rank !== quad && count === 2);
    if (pairs.length === 2) return makeCombo('four-two-pair', cards, [quad]);
  }
  return null;
}

export function classifyCards(rawCards) {
  if (!Array.isArray(rawCards)) throw new GameError('牌型数据无效', 'INVALID_CARDS');
  const cards = [...rawCards];
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new GameError('包含重复的牌', 'DUPLICATE_CARDS');
  }
  const size = cards.length;
  if (size < 1 || size > 20) throw new GameError('牌数不合法', 'INVALID_SIZE');

  const counts = rankCounts(cards);
  const ranks = [...counts.keys()];

  if (size === 1) return makeCombo('single', cards, [ranks[0]]);

  if (size === 2) {
    if (ranks.length === 2 && ranks.includes(16) && ranks.includes(17)) {
      return makeCombo('rocket', cards, [17]);
    }
    if (ranks.length === 1 && counts.get(ranks[0]) === 2 && ranks[0] <= 15) {
      return makeCombo('pair', cards, [ranks[0]]);
    }
    throw new GameError('两张牌不能组成有效牌型', 'INVALID_COMBO');
  }

  if (size === 3) {
    if (ranks.length === 1 && counts.get(ranks[0]) === 3 && ranks[0] <= 15) {
      return makeCombo('triple', cards, [ranks[0]]);
    }
    throw new GameError('三张牌需要点数相同', 'INVALID_COMBO');
  }

  if (size === 4) {
    if (ranks.length === 1 && counts.get(ranks[0]) === 4 && ranks[0] <= 15) {
      return makeCombo('bomb', cards, [ranks[0]]);
    }
    if (ranks.length === 2) {
      const triple = ranks.find((rank) => counts.get(rank) === 3);
      if (triple !== undefined) return makeCombo('triple-single', cards, [triple]);
    }
    throw new GameError('四张牌不能组成有效牌型', 'INVALID_COMBO');
  }

  if (size === 5) {
    if (ranks.length === 2) {
      const triple = ranks.find((rank) => counts.get(rank) === 3);
      const pair = ranks.find((rank) => counts.get(rank) === 2);
      if (triple !== undefined && pair !== undefined) {
        return makeCombo('triple-pair', cards, [triple]);
      }
    }
    const straight = classifyStraight(cards);
    if (straight) return straight;
    throw new GameError('五张牌不能组成有效牌型', 'INVALID_COMBO');
  }

  const straight = classifyStraight(cards);
  if (straight) return straight;

  const pairStraight = classifyPairStraight(cards);
  if (pairStraight) return pairStraight;

  const airplane = classifyAirplane(cards);
  if (airplane) return airplane;

  const four = classifyFourWithKickers(cards);
  if (four) return four;

  throw new GameError('这些牌不能组成有效牌型', 'INVALID_COMBO');
}

export function compareCombos(a, b) {
  if (!a || !b) return null;
  if (a.rocket) return b.rocket ? 0 : 1;
  if (b.rocket) return -1;
  if (a.bomb) {
    if (!b.bomb) return 1;
    return a.primary[0] - b.primary[0];
  }
  if (b.bomb) return -1;
  if (a.kind !== b.kind || a.size !== b.size) return null;
  for (let i = 0; i < Math.max(a.primary.length, b.primary.length); i += 1) {
    const diff = (a.primary[i] ?? 0) - (b.primary[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function canBeat(candidate, previous) {
  const result = compareCombos(candidate, previous);
  return result !== null && result > 0;
}

function deal() {
  const deck = shuffle(createDeck({ decks: 1, jokers: true }));
  const hands = [[], [], []];
  for (let i = 0; i < 51; i += 1) hands[i % 3].push(deck[i]);
  const bottom = deck.slice(51);
  return {
    hands: hands.map((hand) => sortCards(hand, strengthOf, 'desc')),
    bottom: sortCards(bottom, strengthOf, 'desc'),
  };
}

export function createGame(playerCount, roundNumber = 0, options = {}) {
  if (playerCount !== 3) throw new GameError('斗地主需要正好 3 位玩家', 'INVALID_PLAYER_COUNT');
  const { hands, bottom } = deal();
  const starterSeat = Number.isInteger(options.starterSeat)
    ? options.starterSeat % 3
    : roundNumber % 3;
  return {
    status: 'bidding',
    hands,
    bottom,
    playerCount: 3,
    biddingSeat: starterSeat,
    bids: [null, null, null],
    highestBid: 0,
    highestBidSeat: null,
    landlordSeat: null,
    currentSeat: null,
    lastPlay: null,
    passSeats: [],
    bombCount: 0,
    dealAttempt: 1,
    roundNumber,
    starterSeat,
    startedAt: new Date().toISOString(),
    lastAction: {
      type: 'bid-start',
      seat: starterSeat,
      at: new Date().toISOString(),
    },
    result: null,
  };
}

function nextBiddingSeat(game, from) {
  for (let offset = 1; offset <= 3; offset += 1) {
    const seat = (from + offset) % 3;
    if (game.bids[seat] === null) return seat;
  }
  return from;
}

function resolveLandlord(game) {
  const landlord = game.highestBidSeat;
  game.landlordSeat = landlord;
  game.hands[landlord] = sortCards([...game.hands[landlord], ...game.bottom], strengthOf, 'desc');
  game.status = 'playing';
  game.biddingSeat = null;
  game.currentSeat = landlord;
  game.lastPlay = null;
  game.passSeats = [];
  game.bids = [...game.bids];
  game.lastAction = {
    type: 'landlord',
    seat: landlord,
    bottom: game.bottom.map((card) => publicCard(card, card.rank)),
    at: new Date().toISOString(),
  };
}

function redeal(game) {
  const { hands, bottom } = deal();
  game.hands = hands;
  game.bottom = bottom;
  game.bids = [null, null, null];
  game.highestBid = 0;
  game.highestBidSeat = null;
  game.landlordSeat = null;
  game.dealAttempt += 1;
  game.starterSeat = (game.starterSeat + 1) % 3;
  game.biddingSeat = game.starterSeat;
  game.lastAction = {
    type: 'redeal',
    seat: game.biddingSeat,
    at: new Date().toISOString(),
  };
}

export function bid(game, seat, value) {
  if (!game || game.status !== 'bidding') throw new GameError('现在不是叫地主阶段', 'NOT_BIDDING');
  if (seat !== game.biddingSeat) throw new GameError('还没有轮到你叫地主', 'NOT_YOUR_BID');
  const amount = Number(value);
  if (![0, 1, 2, 3].includes(amount)) throw new GameError('叫分不合法', 'INVALID_BID');
  if (amount > 0 && amount <= game.highestBid) {
    throw new GameError(`叫分必须高于 ${game.highestBid} 分`, 'BID_TOO_LOW');
  }

  game.bids[seat] = amount;
  if (amount > 0) {
    game.highestBid = amount;
    game.highestBidSeat = seat;
  }
  game.lastAction = {
    type: amount === 0 ? 'bid-pass' : 'bid',
    seat,
    value: amount,
    at: new Date().toISOString(),
  };

  if (amount === 3) {
    resolveLandlord(game);
    return { status: game.status, resolved: true };
  }

  if (game.bids.every((value) => value !== null)) {
    if (game.highestBid === 0) {
      redeal(game);
      return { status: game.status, redealt: true };
    }
    resolveLandlord(game);
    return { status: game.status, resolved: true };
  }

  game.biddingSeat = nextBiddingSeat(game, seat);
  return { status: game.status, resolved: false, nextSeat: game.biddingSeat };
}

export function playCards(game, seat, cardIds) {
  if (!game || game.status !== 'playing') throw new GameError('牌局尚未开始或已结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你出牌', 'NOT_YOUR_TURN');
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new GameError('请选择要出的牌', 'NO_CARDS');
  if (new Set(cardIds).size !== cardIds.length) throw new GameError('包含重复的牌', 'DUPLICATE_CARDS');

  const hand = game.hands[seat];
  const selected = [];
  for (const id of cardIds) {
    const card = hand.find((item) => item.id === id);
    if (!card) throw new GameError('手牌中没有这张牌', 'CARD_NOT_IN_HAND');
    selected.push(card);
  }
  const combo = classifyCards(selected);
  if (game.lastPlay && !canBeat(combo, game.lastPlay.combo)) {
    throw new GameError(`需要大过「${game.lastPlay.combo.name}」`, 'NOT_BEATING');
  }

  const ids = new Set(cardIds);
  game.hands[seat] = hand.filter((card) => !ids.has(card.id));
  game.lastPlay = { seat, combo };
  game.passSeats = [];
  if (combo.bomb || combo.rocket) game.bombCount += 1;
  game.lastAction = {
    type: 'play',
    seat,
    combo,
    at: new Date().toISOString(),
  };

  if (game.hands[seat].length === 0) {
    game.status = 'finished';
    game.currentSeat = null;
    game.result = buildResult(game, seat);
    game.lastAction.type = 'win';
    return { combo, finished: true, result: game.result };
  }

  game.currentSeat = (seat + 1) % 3;
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
  if (game.passSeats.length >= 2) {
    game.currentSeat = game.lastPlay.seat;
    game.lastPlay = null;
    game.passSeats = [];
    game.lastAction = {
      type: 'new-trick',
      seat: game.currentSeat,
      at: new Date().toISOString(),
    };
    return { newTrick: true, nextSeat: game.currentSeat };
  }
  game.currentSeat = (seat + 1) % 3;
  return { newTrick: false, nextSeat: game.currentSeat };
}

function buildResult(game, winnerSeat) {
  const landlordWon = winnerSeat === game.landlordSeat;
  const stake = Math.max(1, game.highestBid) * 2 ** game.bombCount;
  const seats = [0, 1, 2];
  const roles = seats.map((seat) => (seat === game.landlordSeat ? 'landlord' : 'farmer'));
  let places;
  if (landlordWon) {
    const farmers = seats
      .filter((seat) => seat !== game.landlordSeat)
      .sort((a, b) => game.hands[a].length - game.hands[b].length || a - b);
    places = [game.landlordSeat, ...farmers];
  } else {
    const farmers = seats
      .filter((seat) => seat !== game.landlordSeat)
      .sort((a, b) => {
        if (a === winnerSeat) return -1;
        if (b === winnerSeat) return 1;
        return game.hands[a].length - game.hands[b].length || a - b;
      });
    places = [...farmers, game.landlordSeat];
  }

  const entries = places.map((seat, index) => {
    const role = roles[seat];
    let points;
    if (landlordWon) points = role === 'landlord' ? 2 * stake : -stake;
    else points = role === 'landlord' ? -2 * stake : stake;
    return {
      seat,
      place: index + 1,
      cardsLeft: game.hands[seat].length,
      penalty: 0,
      multiplier: stake,
      points,
      won: (landlordWon && role === 'landlord') || (!landlordWon && role === 'farmer'),
      role: role === 'landlord' ? '地主' : '农民',
      roleKey: role,
      label: role === 'landlord' ? '地主' : '农民',
    };
  });

  const winnerSeats = entries.filter((entry) => entry.won).map((entry) => entry.seat);
  return {
    winnerSeat,
    winnerSeats,
    winnerSide: landlordWon ? 'landlord' : 'farmers',
    headline: landlordWon ? '地主胜利' : '农民胜利',
    detail: `底分 ${Math.max(1, game.highestBid)} · 炸弹 ${game.bombCount} · 结算倍数 ${stake}`,
    stake,
    landlordSeat: game.landlordSeat,
    entries,
    firstOutSeat: winnerSeat,
  };
}

export function getHand(game, seat) {
  if (!game?.hands?.[seat]) return [];
  return sortCards(game.hands[seat], strengthOf, 'desc').map((card) => publicCard(card, card.rank));
}

export function getPublicGame(game) {
  if (!game) return null;
  const revealed = game.status !== 'bidding';
  return {
    gameType: GAME_TYPE,
    status: game.status,
    phase: game.status,
    playerCount: 3,
    currentSeat: game.currentSeat,
    biddingSeat: game.biddingSeat,
    landlordSeat: game.landlordSeat,
    bids: [...game.bids],
    highestBid: game.highestBid,
    highestBidSeat: game.highestBidSeat,
    bottomCount: 3,
    bottomCards: revealed
      ? game.bottom.map((card) => publicCard(card, card.rank))
      : game.bottom.map((card) => ({ id: card.id, hidden: true })),
    handCounts: game.hands.map((hand) => hand.length),
    lastPlay: game.lastPlay
      ? {
          seat: game.lastPlay.seat,
          combo: {
            kind: game.lastPlay.combo.kind,
            name: game.lastPlay.combo.name,
            size: game.lastPlay.combo.size,
            bomb: game.lastPlay.combo.bomb,
            rocket: game.lastPlay.combo.rocket,
            cards: game.lastPlay.combo.cards,
          },
        }
      : null,
    passSeats: [...game.passSeats],
    lastAction: game.lastAction,
    bombCount: game.bombCount,
    stake: Math.max(1, game.highestBid) * 2 ** game.bombCount,
    dealAttempt: game.dealAttempt,
    roundNumber: game.roundNumber,
    result: game.result,
    startedAt: game.startedAt || null,
    finishedAt: game.finishedAt || null,
  };
}

/* ---------- candidate generation and hints ---------- */

function chooseLowest(cards, count) {
  return sortCards(cards, (card) => card.rank, 'asc').slice(0, count);
}

function allRunsOfExactLength(ranks, length) {
  return findRuns(ranks, length);
}

function pairRanks(hand, excluded = new Set()) {
  const grouped = groupByRank(hand);
  return [...grouped.entries()]
    .filter(([rank, cards]) => rank <= 15 && cards.length >= 2 && !excluded.has(rank))
    .map(([rank]) => rank)
    .sort((a, b) => a - b);
}

function tripleRanks(hand, excluded = new Set()) {
  const grouped = groupByRank(hand);
  return [...grouped.entries()]
    .filter(([rank, cards]) => rank <= 15 && cards.length >= 3 && !excluded.has(rank))
    .map(([rank]) => rank)
    .sort((a, b) => a - b);
}

function quadCandidates(hand) {
  const grouped = groupByRank(hand);
  return [...grouped.entries()]
    .filter(([rank, cards]) => rank <= 15 && cards.length >= 4)
    .map(([rank, cards]) => chooseLowest(cards, 4))
    .sort((a, b) => a[0].rank - b[0].rank);
}

function rocketCandidate(hand) {
  const small = hand.find((card) => card.rank === 16);
  const big = hand.find((card) => card.rank === 17);
  return small && big ? [small, big] : null;
}

function buildSingleGroup(hand, count) {
  const grouped = groupByRank(hand);
  return [...grouped.entries()]
    .filter(([rank, cards]) => rank <= 15 && cards.length >= count)
    .map(([, cards]) => chooseLowest(cards, count));
}

function tripleWithKickers(hand, withPair) {
  const grouped = groupByRank(hand);
  const result = [];
  for (const [rank, cards] of grouped.entries()) {
    if (rank > 15 || cards.length < 3) continue;
    const triple = chooseLowest(cards, 3);
    const rest = hand.filter((card) => card.rank !== rank);
    if (withPair) {
      for (const [pairRank, pairCards] of groupByRank(rest).entries()) {
        if (pairRank > 15 || pairCards.length < 2) continue;
        result.push([...triple, ...chooseLowest(pairCards, 2)]);
      }
    } else {
      for (const kicker of rest) result.push([...triple, kicker]);
    }
  }
  return result;
}

function straightCandidates(hand, length) {
  const grouped = groupByRank(hand);
  const ranks = [...grouped.keys()].filter((rank) => rank >= 3 && rank <= 14);
  const result = [];
  for (const run of allRunsOfExactLength(ranks, length)) {
    result.push(run.flatMap((rank) => chooseLowest(grouped.get(rank), 1)));
  }
  return result;
}

function pairStraightCandidates(hand, length) {
  const grouped = groupByRank(hand);
  const ranks = [...grouped.keys()].filter(
    (rank) => rank >= 3 && rank <= 14 && grouped.get(rank).length >= 2,
  );
  const result = [];
  for (const run of allRunsOfExactLength(ranks, length)) {
    result.push(run.flatMap((rank) => chooseLowest(grouped.get(rank), 2)));
  }
  return result;
}

function airplaneCandidates(hand, length) {
  const grouped = groupByRank(hand);
  const ranks = [...grouped.keys()].filter(
    (rank) => rank >= 3 && rank <= 14 && grouped.get(rank).length >= 3,
  );
  return allRunsOfExactLength(ranks, length).map((run) =>
    run.flatMap((rank) => chooseLowest(grouped.get(rank), 3)),
  );
}

function airplaneWithWings(hand, length, withPairs) {
  const grouped = groupByRank(hand);
  const ranks = [...grouped.keys()].filter(
    (rank) => rank >= 3 && rank <= 14 && grouped.get(rank).length >= 3,
  );
  const result = [];
  for (const run of allRunsOfExactLength(ranks, length)) {
    const used = new Set(run);
    const base = run.flatMap((rank) => chooseLowest(grouped.get(rank), 3));
    const rest = hand.filter((card) => !used.has(card.rank));
    if (withPairs) {
      const candidates = pairRanks(rest);
      for (const pairSet of combinations(candidates, length)) {
        const wings = pairSet.flatMap((rank) => chooseLowest(grouped.get(rank), 2));
        if (wings.length === length * 2) result.push([...base, ...wings]);
      }
    } else {
      for (const wings of combinations(rest, length)) {
        result.push([...base, ...wings]);
      }
    }
  }
  return result;
}

function fourWithKickers(hand, withPairs) {
  const result = [];
  for (const quad of quadCandidates(hand)) {
    const quadRank = quad[0].rank;
    const rest = hand.filter((card) => card.rank !== quadRank);
    if (withPairs) {
      const pairs = pairRanks(rest);
      for (const pairSet of combinations(pairs, 2)) {
        result.push([...quad, ...pairSet.flatMap((rank) => chooseLowest(groupByRank(rest).get(rank), 2))]);
      }
    } else {
      for (const wing of combinations(rest, 2)) result.push([...quad, ...wing]);
    }
  }
  return result;
}

function generateCandidates(hand, target) {
  const lists = [];
  if (!target) {
    const lowest = sortCards(hand, (card) => card.rank, 'asc')[0];
    return lowest ? [[lowest]] : [];
  }
  if (target.rocket) return [];
  if (target.kind === 'bomb') {
    lists.push(...quadCandidates(hand).filter((cards) => cards[0].rank > target.primary[0]));
    const rocket = rocketCandidate(hand);
    if (rocket) lists.push(rocket);
    return lists;
  }
  if (target.kind === 'single') lists.push(...hand.map((card) => [card]));
  if (target.kind === 'pair') lists.push(...buildSingleGroup(hand, 2));
  if (target.kind === 'triple') lists.push(...buildSingleGroup(hand, 3));
  if (target.kind === 'triple-single') lists.push(...tripleWithKickers(hand, false));
  if (target.kind === 'triple-pair') lists.push(...tripleWithKickers(hand, true));
  if (target.kind === 'straight') lists.push(...straightCandidates(hand, target.size));
  if (target.kind === 'pair-straight') lists.push(...pairStraightCandidates(hand, target.size / 2));
  if (target.kind === 'airplane') lists.push(...airplaneCandidates(hand, target.size / 3));
  if (target.kind === 'airplane-single') lists.push(...airplaneWithWings(hand, target.size / 4, false));
  if (target.kind === 'airplane-pair') lists.push(...airplaneWithWings(hand, target.size / 5, true));
  if (target.kind === 'four-two-single') lists.push(...fourWithKickers(hand, false));
  if (target.kind === 'four-two-pair') lists.push(...fourWithKickers(hand, true));

  // Bombs and rocket are always legal replies to a non-bomb play.
  lists.push(...quadCandidates(hand));
  const rocket = rocketCandidate(hand);
  if (rocket) lists.push(rocket);

  const seen = new Set();
  return lists.filter((cards) => {
    const key = cards.map((card) => card.id).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findHint(hand, previousCombo) {
  const candidates = generateCandidates(hand, previousCombo);
  let best = null;
  let bestCombo = null;
  for (const cards of candidates) {
    let combo;
    try {
      combo = classifyCards(cards);
    } catch {
      continue;
    }
    if (previousCombo && !canBeat(combo, previousCombo)) continue;
    if (!bestCombo || compareCombos(combo, bestCombo) < 0) {
      best = cards;
      bestCombo = combo;
    }
  }
  return best ? sortCards(best, (card) => card.rank, 'desc') : null;
}

export function hasPlayable(hand, previousCombo) {
  return Boolean(findHint(hand, previousCombo));
}

export function botBid(game, seat) {
  if (!game || game.status !== 'bidding') return 0;
  const hand = game.hands[seat];
  const grouped = groupByRank(hand);
  let strength = 0;
  strength += (grouped.get(17)?.length || 0) * 2.2;
  strength += (grouped.get(16)?.length || 0) * 1.6;
  strength += (grouped.get(15)?.length || 0) * 0.8;
  strength += (grouped.get(14)?.length || 0) * 0.3;
  for (const [rank, cards] of grouped.entries()) {
    if (rank <= 15 && cards.length === 4) strength += 1.8;
  }
  if (grouped.get(16)?.length && grouped.get(17)?.length) strength += 1.8;
  const desired = strength >= 6.2 ? 3 : strength >= 4.2 ? 2 : strength >= 2.3 ? 1 : 0;
  if (desired === 0) return 0;
  if (desired <= game.highestBid) return 0;
  return desired;
}

export function getHint(game, seat) {
  if (!game || game.status !== 'playing') return null;
  const cards = findHint(game.hands[seat], game.lastPlay?.combo || null);
  return cards ? cards.map((card) => card.id) : null;
}

export const _test = {
  generateCandidates,
  getBiddingSeat: (game) => game.biddingSeat,
};
