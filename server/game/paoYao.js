import {
  createDeck,
  groupByRank,
  publicCard,
  shuffle,
  sortCards,
} from './cards54.js';

export const GAME_TYPE = 'pao-yao';
export const GAME_NAME = '东北刨幺';

export class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export const TEAMS = [
  { id: 0, label: '红队', seats: [0, 2] },
  { id: 1, label: '蓝队', seats: [1, 3] },
];

const TEAM_LABEL = ['红队', '蓝队'];

/** 刨幺 strength: big joker > small joker > 3 > 2 > A > K ... > 4. */
export function paoStrength(rank) {
  if (rank === 17) return 18;
  if (rank === 16) return 17;
  if (rank === 3) return 16;
  if (rank === 15) return 15;
  return rank;
}

export const POINT_VALUE = { 5: 5, 10: 10, 13: 10 };

const strengthOf = (card) => paoStrength(card.rank);

const KIND_NAMES = {
  single: '单张',
  pair: '对子',
  straight: '单龙',
  'double-straight': '双龙',
};

function makeCombo(kind, cards, extra = {}) {
  return {
    kind,
    name: KIND_NAMES[kind] || extra.name || kind,
    size: cards.length,
    cards: sortCards(cards, strengthOf, 'desc').map((card) =>
      publicCard(card, paoStrength(card.rank)),
    ),
    power: false,
    powerScore: 0,
    ...extra,
  };
}

function isConsecutive(ranks) {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  if (sorted.length !== ranks.length) return false;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function rankCounts(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return counts;
}

function yaoPower(fours) {
  if (fours >= 5) return 4500 + fours;
  if (fours === 4) return 4400;
  if (fours === 3) return 3900;
  return 3400;
}

function jokerCombo(cards) {
  if (!cards.every((card) => card.joker)) return null;
  const small = cards.filter((card) => card.rank === 16).length;
  const big = cards.filter((card) => card.rank === 17).length;
  const lookup = {
    '1-1': { kind: 'joker-mixed', name: '大小王', powerScore: 3300 },
    '2-0': { kind: 'joker-small-pair', name: '双小王', powerScore: 3100 },
    '0-2': { kind: 'joker-big-pair', name: '大王对', powerScore: 3600 },
    '2-1': { kind: 'joker-one-big-two-small', name: '一大王两小王', powerScore: 3700 },
    '1-2': { kind: 'joker-two-big-one-small', name: '两大王一小王', powerScore: 4000 },
    '2-2': { kind: 'joker-four', name: '四张王', powerScore: 4300 },
  };
  const key = `${small}-${big}`;
  const meta = lookup[key];
  if (!meta) return null;
  return makeCombo(meta.kind, cards, {
    name: meta.name,
    power: true,
    powerScore: meta.powerScore,
  });
}

export function classifyCards(rawCards) {
  if (!Array.isArray(rawCards)) throw new GameError('牌型数据无效', 'INVALID_CARDS');
  const cards = [...rawCards];
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new GameError('包含重复的牌', 'DUPLICATE_CARDS');
  }
  const size = cards.length;
  if (size < 1 || size > 9) throw new GameError('牌数不合法', 'INVALID_SIZE');

  if (cards.every((card) => card.joker)) {
    if (size === 1) {
      return makeCombo('single', cards, { primary: paoStrength(cards[0].rank) });
    }
    const joker = jokerCombo(cards);
    if (joker) return joker;
    throw new GameError('这些王不能组成有效牌型', 'INVALID_COMBO');
  }
  if (cards.some((card) => card.joker)) {
    throw new GameError('王只能单独出，或组成王炸组合', 'INVALID_COMBO');
  }

  const counts = rankCounts(cards);
  const ranks = [...counts.keys()];

  // 幺牌：A + 2～8 张 4
  if (counts.size === 2 && counts.get(14) === 1 && counts.get(4) >= 2) {
    const fours = counts.get(4);
    return makeCombo('yao', cards, {
      name: fours === 2 ? '小幺' : fours === 3 ? '中幺' : fours === 4 ? '老幺' : '老老幺',
      power: true,
      powerScore: yaoPower(fours),
      fours,
    });
  }

  if (size === 1) {
    return makeCombo('single', cards, { primary: paoStrength(ranks[0]) });
  }

  if (size === 2) {
    if (ranks.length === 1 && counts.get(ranks[0]) === 2) {
      return makeCombo('pair', cards, { primary: paoStrength(ranks[0]) });
    }
    throw new GameError('两张牌需要点数相同', 'INVALID_COMBO');
  }

  // 3～8 路：同点数三张以上
  if (ranks.length === 1 && size >= 3 && size <= 8) {
    return makeCombo('road', cards, {
      name: `${size}路`,
      power: true,
      powerScore: {
        3: 3000,
        4: 3200,
        5: 3500,
        6: 3800,
        7: 4100,
        8: 4200,
      }[size] + paoStrength(ranks[0]),
      roadCount: size,
    });
  }

  if (size >= 3 && counts.size === size && ranks.every((rank) => rank >= 4 && rank <= 14) && isConsecutive(ranks)) {
    const high = Math.max(...ranks);
    const low = Math.min(...ranks);
    return makeCombo('straight', cards, { primary: high, low, chain: size });
  }

  if (
    size >= 6 &&
    size % 2 === 0 &&
    [...counts.values()].every((count) => count === 2) &&
    ranks.every((rank) => rank >= 4 && rank <= 14) &&
    isConsecutive(ranks)
  ) {
    const high = Math.max(...ranks);
    const low = Math.min(...ranks);
    return makeCombo('double-straight', cards, {
      primary: high,
      low,
      chain: size / 2,
    });
  }

  throw new GameError('这些牌不能组成有效牌型', 'INVALID_COMBO');
}

export function canBeat(candidate, previous) {
  if (!previous) return true;
  if (candidate.power && previous.power) return candidate.powerScore > previous.powerScore;
  if (candidate.power && !previous.power) {
    if (previous.kind === 'double-straight') return candidate.powerScore >= 3200;
    return true;
  }
  if (!candidate.power && previous.power) return false;
  if (candidate.kind === previous.kind && candidate.size === previous.size) {
    if (candidate.kind === 'single' || candidate.kind === 'pair') {
      return candidate.primary > previous.primary;
    }
    if (candidate.kind === 'straight' || candidate.kind === 'double-straight') {
      return candidate.primary > previous.primary;
    }
  }
  // 骑顺：双龙骑单龙，最小点数更大，且双龙对数等于单龙张数。
  if (
    candidate.kind === 'double-straight' &&
    previous.kind === 'straight' &&
    candidate.chain === previous.size &&
    candidate.low > previous.low
  ) {
    return true;
  }
  return false;
}

export function createGame(playerCount, roundNumber = 0, options = {}) {
  if (playerCount !== 4) throw new GameError('东北刨幺需要正好 4 位玩家', 'INVALID_PLAYER_COUNT');
  const deck = shuffle(createDeck({ decks: 2, jokers: true }));
  const hands = [[], [], [], []];
  for (let i = 0; i < deck.length; i += 1) hands[i % 4].push(deck[i]);
  const starterSeat = Number.isInteger(options.starterSeat)
    ? options.starterSeat % 4
    : roundNumber % 4;
  return {
    status: 'playing',
    hands: hands.map((hand) => sortCards(hand, strengthOf, 'desc')),
    playerCount: 4,
    teamScores: [0, 0],
    pilePoints: 0,
    pileCards: 0,
    currentSeat: starterSeat,
    starterSeat,
    lastPlay: null,
    passSeats: [],
    finishedSeats: [],
    firstOutSeat: null,
    firstOutTeam: null,
    lastAction: {
      type: 'start',
      seat: starterSeat,
      at: new Date().toISOString(),
    },
    roundNumber,
    startedAt: new Date().toISOString(),
    result: null,
  };
}

const teamOf = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % 4;

function activeCount(game) {
  return game.hands.filter((hand) => hand.length > 0).length;
}

function nextActiveSeat(game, from) {
  for (let offset = 1; offset <= 4; offset += 1) {
    const seat = (from + offset) % 4;
    if (game.hands[seat].length > 0 && !game.passSeats.includes(seat)) return seat;
  }
  return from;
}

function awardPile(game, winningSeat) {
  if (game.pilePoints <= 0) return 0;
  const points = game.pilePoints;
  const team = teamOf(winningSeat);
  game.teamScores[team] += points;
  game.pilePoints = 0;
  game.pileCards = 0;
  return points;
}

function checkScoreWin(game, triggerTeam) {
  const score = game.teamScores[triggerTeam];
  if (score >= 200) return '200';
  if (score >= 140) return '140';
  if (game.firstOutTeam === triggerTeam && score >= 90) return '扛旗';
  return null;
}

function finishGame(game, winType, winnerTeam, winnerSeat) {
  game.status = 'finished';
  game.currentSeat = null;
  const winnerSeats = [0, 1, 2, 3].filter((seat) => teamOf(seat) === winnerTeam);
  const places = [
    ...winnerSeats.sort((a, b) => {
      if (a === game.firstOutSeat) return -1;
      if (b === game.firstOutSeat) return 1;
      return a - b;
    }),
    ...[0, 1, 2, 3]
      .filter((seat) => teamOf(seat) !== winnerTeam)
      .sort((a, b) => game.hands[a].length - game.hands[b].length || a - b),
  ];
  const points = winType === '200' ? 4 : 1;
  const entries = places.map((seat, index) => {
    const team = teamOf(seat);
    return {
      seat,
      place: index + 1,
      cardsLeft: game.hands[seat].length,
      penalty: 0,
      multiplier: points,
      points: team === winnerTeam ? points : -points,
      won: team === winnerTeam,
      team,
      role: TEAM_LABEL[team],
      roleKey: `team-${team}`,
      label: TEAM_LABEL[team],
    };
  });
  game.result = {
    winnerSeat: winnerSeat ?? winnerSeats[0],
    winnerSeats,
    winnerTeam,
    headline: `${TEAM_LABEL[winnerTeam]}胜利`,
    detail: `${winType} · 红队 ${game.teamScores[0]} 分 / 蓝队 ${game.teamScores[1]} 分`,
    winType,
    teamScores: [...game.teamScores],
    firstOutSeat: game.firstOutSeat,
    entries,
  };
  game.lastAction = {
    type: 'win',
    seat: winnerSeat,
    at: new Date().toISOString(),
  };
  game.finishedAt = new Date().toISOString();
}

function handlePlayerOut(game, seat) {
  if (!game.finishedSeats.includes(seat)) game.finishedSeats.push(seat);
  if (game.firstOutSeat === null) {
    game.firstOutSeat = seat;
    game.firstOutTeam = teamOf(seat);
  }
  const team = teamOf(seat);
  const bothOut = TEAM_SEATS[team].every((member) => game.hands[member].length === 0);
  if (bothOut) {
    const points = awardPile(game, seat);
    finishGame(game, '双飞', team, seat);
    game.lastAction.pointsAwarded = points;
    return { ended: true, winType: '双飞' };
  }
  // 扛旗：first player out, and their team already has 90+ banked points.
  if (game.firstOutSeat === seat && game.teamScores[team] >= 90) {
    const points = awardPile(game, seat);
    finishGame(game, '扛旗', team, seat);
    game.lastAction.pointsAwarded = points;
    return { ended: true, winType: '扛旗' };
  }
  return { ended: false };
}

const TEAM_SEATS = [
  [0, 2],
  [1, 3],
];

export function playCards(game, seat, cardIds) {
  if (!game || game.status !== 'playing') throw new GameError('牌局尚未开始或已结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你出牌', 'NOT_YOUR_TURN');
  if (!game.hands[seat].length) throw new GameError('你已经出完牌了', 'PLAYER_OUT');
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
  const points = selected.reduce((sum, card) => sum + (POINT_VALUE[card.rank] || 0), 0);
  game.pilePoints += points;
  game.pileCards += selected.length;
  game.lastPlay = { seat, combo };
  game.lastAction = {
    type: 'play',
    seat,
    combo,
    points,
    pilePoints: game.pilePoints,
    at: new Date().toISOString(),
  };

  if (game.hands[seat].length === 0) {
    const out = handlePlayerOut(game, seat);
    if (out.ended) return { combo, finished: true, result: game.result };
  }

  if (game.status === 'finished') return { combo, finished: true, result: game.result };
  game.currentSeat = nextActiveSeat(game, seat);
  return { combo, finished: false, nextSeat: game.currentSeat };
}

export function passTurn(game, seat) {
  if (!game || game.status !== 'playing') throw new GameError('牌局尚未开始或已结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你', 'NOT_YOUR_TURN');
  if (!game.lastPlay) throw new GameError('你是本轮先手，必须出牌', 'MUST_LEAD');
  if (game.passSeats.includes(seat)) throw new GameError('你已经不要过了', 'ALREADY_PASSED');
  game.passSeats.push(seat);
  game.lastAction = {
    type: 'pass',
    seat,
    at: new Date().toISOString(),
  };

  const lastSeat = game.lastPlay.seat;
  const lastSeatActive = game.hands[lastSeat].length > 0;
  const active = activeCount(game);
  const needed = active - (lastSeatActive ? 1 : 0);

  if (game.passSeats.length >= needed) {
    const points = awardPile(game, lastSeat);
    const leader = lastSeatActive ? lastSeat : partnerOf(lastSeat);
    const winningTeam = teamOf(lastSeat);
    game.lastPlay = null;
    game.passSeats = [];
    game.currentSeat = leader;
    const winType = checkScoreWin(game, winningTeam);
    game.lastAction = {
      type: winType ? 'win' : 'new-trick',
      seat: leader,
      pointsAwarded: points,
      teamScores: [...game.teamScores],
      at: new Date().toISOString(),
    };
    if (winType) {
      finishGame(game, winType, winningTeam, lastSeat);
      return { finished: true, result: game.result, team: winningTeam, pointsAwarded: points };
    }
    return { newTrick: true, nextSeat: leader, pointsAwarded: points, team: winningTeam };
  }

  game.currentSeat = nextActiveSeat(game, seat);
  return { newTrick: false, nextSeat: game.currentSeat };
}

export function getHand(game, seat) {
  if (!game?.hands?.[seat]) return [];
  return sortCards(game.hands[seat], strengthOf, 'desc').map((card) =>
    publicCard(card, paoStrength(card.rank)),
  );
}

export function getPublicGame(game) {
  if (!game) return null;
  return {
    gameType: GAME_TYPE,
    status: game.status,
    phase: game.status,
    playerCount: 4,
    currentSeat: game.currentSeat,
    handCounts: game.hands.map((hand) => hand.length),
    lastPlay: game.lastPlay
      ? {
          seat: game.lastPlay.seat,
          combo: {
            kind: game.lastPlay.combo.kind,
            name: game.lastPlay.combo.name,
            size: game.lastPlay.combo.size,
            power: game.lastPlay.combo.power,
            powerScore: game.lastPlay.combo.powerScore,
            cards: game.lastPlay.combo.cards,
          },
        }
      : null,
    passSeats: [...game.passSeats],
    lastAction: game.lastAction,
    teamScores: [...game.teamScores],
    teams: TEAMS.map((team) => ({ ...team, score: game.teamScores[team.id] })),
    pilePoints: game.pilePoints,
    pileCards: game.pileCards,
    finishedSeats: [...game.finishedSeats],
    firstOutSeat: game.firstOutSeat,
    firstOutTeam: game.firstOutTeam,
    roundNumber: game.roundNumber,
    result: game.result,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt || null,
  };
}

/* ---------- candidate generation and hints ---------- */

function chooseLowest(cards, count) {
  return sortCards(cards, strengthOf, 'asc').slice(0, count);
}

function runs(ranks, length) {
  const eligible = [...new Set(ranks)].filter((rank) => rank >= 4 && rank <= 14).sort((a, b) => a - b);
  const output = [];
  for (let i = 0; i <= eligible.length - length; i += 1) {
    const slice = eligible.slice(i, i + length);
    if (isConsecutive(slice)) output.push(slice);
  }
  return output;
}

function normalCandidates(hand, target) {
  const grouped = groupByRank(hand);
  const lists = [];
  if (target.kind === 'single') {
    lists.push(...hand.map((card) => [card]));
  } else if (target.kind === 'pair') {
    for (const cards of grouped.values()) {
      if (cards.length >= 2) lists.push(chooseLowest(cards, 2));
    }
  } else if (target.kind === 'straight') {
    for (const run of runs([...grouped.keys()].filter((rank) => grouped.get(rank).length), target.size)) {
      lists.push(run.flatMap((rank) => chooseLowest(grouped.get(rank), 1)));
    }
    // 骑顺：同长度的双龙也能压单龙。
    for (const run of runs(
      [...grouped.keys()].filter((rank) => rank <= 14 && grouped.get(rank).length >= 2),
      target.size,
    )) {
      lists.push(run.flatMap((rank) => chooseLowest(grouped.get(rank), 2)));
    }
  } else if (target.kind === 'double-straight') {
    for (const run of runs(
      [...grouped.keys()].filter((rank) => rank <= 14 && grouped.get(rank).length >= 2),
      target.chain,
    )) {
      lists.push(run.flatMap((rank) => chooseLowest(grouped.get(rank), 2)));
    }
  }
  return lists;
}

function allPowerCandidates(hand) {
  const grouped = groupByRank(hand);
  const lists = [];
  for (const [rank, cards] of grouped.entries()) {
    if (rank <= 15) {
      for (let size = 3; size <= Math.min(8, cards.length); size += 1) {
        lists.push(chooseLowest(cards, size));
      }
    }
  }
  const aceCards = grouped.get(14) || [];
  const fours = grouped.get(4) || [];
  if (aceCards.length >= 1 && fours.length >= 2) {
    const ace = chooseLowest(aceCards, 1)[0];
    for (let count = 2; count <= Math.min(8, fours.length); count += 1) {
      lists.push([ace, ...chooseLowest(fours, count)]);
    }
  }
  const small = grouped.get(16) || [];
  const big = grouped.get(17) || [];
  if (small.length >= 2) lists.push(chooseLowest(small, 2));
  if (big.length >= 2) lists.push(chooseLowest(big, 2));
  if (small.length >= 1 && big.length >= 1) lists.push([small[0], big[0]]);
  if (small.length >= 2 && big.length >= 1) lists.push([...chooseLowest(small, 2), big[0]]);
  if (big.length >= 2 && small.length >= 1) lists.push([...chooseLowest(big, 2), small[0]]);
  if (small.length >= 2 && big.length >= 2) lists.push([...chooseLowest(small, 2), ...chooseLowest(big, 2)]);
  return lists;
}

export function findHint(hand, previousCombo) {
  if (!previousCombo) {
    const lowest = sortCards(hand, strengthOf, 'asc')[0];
    return lowest ? [lowest] : null;
  }

  let normalBest = null;
  let normalBestCombo = null;
  for (const cards of normalCandidates(hand, previousCombo)) {
    let combo;
    try {
      combo = classifyCards(cards);
    } catch {
      continue;
    }
    if (!canBeat(combo, previousCombo)) continue;
    if (!normalBestCombo || combo.primary < normalBestCombo.primary) {
      normalBest = cards;
      normalBestCombo = combo;
    }
  }
  if (normalBest) return sortCards(normalBest, strengthOf, 'desc');

  let powerBest = null;
  let powerBestCombo = null;
  for (const cards of allPowerCandidates(hand)) {
    let combo;
    try {
      combo = classifyCards(cards);
    } catch {
      continue;
    }
    if (!combo.power || !canBeat(combo, previousCombo)) continue;
    if (!powerBestCombo || combo.powerScore < powerBestCombo.powerScore) {
      powerBest = cards;
      powerBestCombo = combo;
    }
  }
  return powerBest ? sortCards(powerBest, strengthOf, 'desc') : null;
}

export function hasPlayable(hand, previousCombo) {
  return Boolean(findHint(hand, previousCombo));
}

export function getHint(game, seat) {
  if (!game || game.status !== 'playing') return null;
  const cards = findHint(game.hands[seat], game.lastPlay?.combo || null);
  return cards ? cards.map((card) => card.id) : null;
}

export function pointsForCard(card) {
  return POINT_VALUE[card.rank] || 0;
}

export const _test = {
  normalCandidates,
  allPowerCandidates,
  teamOf,
};
