import { createDeck, publicCard, shuffle, sortCards, combinations } from './cards54.js';

export const GAME_TYPE = 'texas-holdem';
export const GAME_NAME = '德州扑克';

export class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const STARTING_STACK = 1000;
const pokerRank = (card) => (card.rank === 15 ? 2 : card.rank);
const strengthOf = (card) => pokerRank(card);
const HAND_NAMES = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
];

function sortPoker(cards) {
  return [...cards].sort(
    (a, b) => pokerRank(b) - pokerRank(a) || b.suitOrder - a.suitOrder,
  );
}

function rankCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    const rank = pokerRank(card);
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }
  return counts;
}

function straightHigh(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  if (unique.length !== 5) return null;
  if (unique[4] - unique[0] === 4) return unique[4];
  // Wheel A-2-3-4-5: A acts low.
  if (unique.join(',') === '2,3,4,5,14') return 5;
  return null;
}

export function evaluateFive(rawCards) {
  if (rawCards.length !== 5) throw new GameError('需要五张牌', 'INVALID_HAND');
  const cards = sortPoker(rawCards);
  const counts = rankCounts(cards);
  const ranks = [...counts.keys()].sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const high = straightHigh(ranks);
  const countValues = [...counts.values()].sort((a, b) => b - a);

  let category = 0;
  let tiebreak = ranks;
  if (flush && high) {
    category = 8;
    tiebreak = [high];
  } else if (countValues[0] === 4) {
    const quad = ranks.find((rank) => counts.get(rank) === 4);
    const kicker = ranks.find((rank) => rank !== quad);
    category = 7;
    tiebreak = [quad, kicker];
  } else if (countValues[0] === 3 && countValues[1] === 2) {
    const trip = ranks.find((rank) => counts.get(rank) === 3);
    const pair = ranks.find((rank) => counts.get(rank) === 2);
    category = 6;
    tiebreak = [trip, pair];
  } else if (flush) {
    category = 5;
    tiebreak = ranks;
  } else if (high) {
    category = 4;
    tiebreak = [high];
  } else if (countValues[0] === 3) {
    const trip = ranks.find((rank) => counts.get(rank) === 3);
    category = 3;
    tiebreak = [trip, ...ranks.filter((rank) => rank !== trip)];
  } else if (countValues[0] === 2 && countValues[1] === 2) {
    const pairs = ranks.filter((rank) => counts.get(rank) === 2).sort((a, b) => b - a);
    const kicker = ranks.find((rank) => counts.get(rank) === 1);
    category = 2;
    tiebreak = [pairs[0], pairs[1], kicker];
  } else if (countValues[0] === 2) {
    const pair = ranks.find((rank) => counts.get(rank) === 2);
    category = 1;
    tiebreak = [pair, ...ranks.filter((rank) => rank !== pair)];
  }

  return {
    category,
    name: HAND_NAMES[category],
    tiebreak,
    cards: sortPoker(cards).map((card) => publicCard(card, pokerRank(card))),
  };
}

export function compareHands(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i += 1) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function bestHand(cards) {
  if (cards.length < 5) return null;
  let best = null;
  for (const five of combinations(cards, 5)) {
    const hand = evaluateFive(five);
    if (!best || compareHands(hand, best) > 0) best = hand;
  }
  return best;
}

function dealHoldem(playerCount) {
  const deck = shuffle(createDeck({ decks: 1, jokers: false }));
  const hands = Array.from({ length: playerCount }, () => []);
  let index = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let seat = 0; seat < playerCount; seat += 1) {
      hands[seat].push(deck[index]);
      index += 1;
    }
  }
  return {
    deck: deck.slice(index),
    hands: hands.map((hand) => sortPoker(hand)),
  };
}

function postBlind(game, seat, amount) {
  if (!Number.isInteger(seat) || seat < 0) return;
  const paid = Math.min(amount, game.stacks[seat]);
  game.stacks[seat] -= paid;
  game.bets[seat] += paid;
  game.totalBets[seat] += paid;
  if (game.stacks[seat] === 0) game.allIn[seat] = true;
}

function nextSeatFrom(seats, from) {
  const n = seats.length;
  for (let offset = 1; offset <= n; offset += 1) {
    const seat = (from + offset) % n;
    if (seats[seat]) return seat;
  }
  return from;
}

function activeSeats(game) {
  return game.folded.map((folded, seat) => !folded);
}

function queueFrom(game, startSeat, includeAllIn = false) {
  const active = activeSeats(game);
  const n = game.playerCount;
  const queue = [];
  for (let offset = 0; offset < n; offset += 1) {
    const seat = (startSeat + offset) % n;
    if (!active[seat]) continue;
    if (!includeAllIn && game.allIn[seat]) continue;
    queue.push(seat);
  }
  return queue;
}

function seatName(roomOrSeats, seat) {
  return roomOrSeats?.[seat]?.displayName || `座位 ${seat + 1}`;
}

function describeAction(game, seat, action) {
  if (action.type === 'fold') return '弃牌';
  if (action.type === 'check') return '过牌';
  if (action.type === 'call') return `跟注 ${action.amount}`;
  if (action.type === 'raise') return `加注到 ${action.to}`;
  return action.type;
}

function createAction(game, seat, type, extra = {}) {
  const action = {
    type,
    seat,
    at: new Date().toISOString(),
    ...extra,
  };
  game.lastAction = action;
  game.actions.push(action);
  return action;
}

function nextButtonSeat(game, seat) {
  for (let offset = 1; offset <= game.playerCount; offset += 1) {
    const next = (seat + offset) % game.playerCount;
    if (!game.folded[next]) return next;
  }
  return (seat + 1) % game.playerCount;
}

export function createGame(playerCount, roundNumber = 0, options = {}) {
  if (![2, 3, 4].includes(playerCount)) {
    throw new GameError('德州扑克支持 2–4 人', 'INVALID_PLAYER_COUNT');
  }
  const dealerSeat = Number.isInteger(options.starterSeat)
    ? options.starterSeat % playerCount
    : roundNumber % playerCount;
  const { deck, hands } = dealHoldem(playerCount);
  const game = {
    status: 'playing',
    phase: 'preflop',
    playerCount,
    hands,
    deck,
    community: [],
    stacks: Array(playerCount).fill(STARTING_STACK),
    startingStacks: Array(playerCount).fill(STARTING_STACK),
    bets: Array(playerCount).fill(0),
    totalBets: Array(playerCount).fill(0),
    folded: Array(playerCount).fill(false),
    allIn: Array(playerCount).fill(false),
    dealerSeat,
    smallBlindSeat: playerCount === 2 ? dealerSeat : (dealerSeat + 1) % playerCount,
    bigBlindSeat: playerCount === 2 ? (dealerSeat + 1) % playerCount : (dealerSeat + 2) % playerCount,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    currentSeat: null,
    actionQueue: [],
    acted: [],
    actions: [],
    lastAction: null,
    roundNumber,
    startedAt: new Date().toISOString(),
    result: null,
    showdown: false,
    revealedSeats: [],
    nextStarterSeat: (dealerSeat + 1) % playerCount,
  };

  postBlind(game, game.smallBlindSeat, SMALL_BLIND);
  postBlind(game, game.bigBlindSeat, BIG_BLIND);
  game.currentBet = Math.max(...game.bets);
  game.lastRaiseSize = BIG_BLIND;
  const firstPreflop =
    playerCount === 2
      ? dealerSeat
      : (game.bigBlindSeat + 1) % playerCount;
  game.actionQueue = queueFrom(game, firstPreflop).filter((seat) => seat !== undefined);
  game.currentSeat = game.actionQueue[0] ?? null;
  game.lastAction = {
    type: 'start',
    seat: game.currentSeat,
    at: new Date().toISOString(),
  };
  return game;
}

function activePlayers(game) {
  return game.folded.map((folded, seat) => !folded && game.hands[seat].length > 0);
}

function nonFoldedCount(game) {
  return game.folded.filter((folded) => !folded).length;
}

function eligibleActionSeats(game) {
  return game.folded
    .map((folded, seat) => !folded && !game.allIn[seat] && game.stacks[seat] > 0)
    .map((value, seat) => (value ? seat : -1))
    .filter((seat) => seat >= 0);
}

function isBettingComplete(game) {
  return game.actionQueue.length === 0;
}

function resetQueueAfterRaise(game, raiserSeat) {
  game.actionQueue = queueFrom(game, (raiserSeat + 1) % game.playerCount);
}

function normalizeQueue(game) {
  game.actionQueue = game.actionQueue.filter(
    (seat) => !game.folded[seat] && !game.allIn[seat] && game.hands[seat].length > 0,
  );
  if (game.actionQueue.length === 0) return;
  const nonAllIn = eligibleActionSeats(game);
  if (nonAllIn.length <= 1) {
    const only = nonAllIn[0];
    if (only === undefined) {
      game.actionQueue = [];
      return;
    }
    if (game.bets[only] >= game.currentBet) {
      game.actionQueue = [];
      return;
    }
    game.actionQueue = [only];
  }
}

function collectBoard(game, count) {
  for (let i = 0; i < count; i += 1) {
    const card = game.deck.shift();
    if (card) game.community.push(card);
  }
}

function activeWithHands(game) {
  return game.folded
    .map((folded, seat) => (!folded ? seat : -1))
    .filter((seat) => seat >= 0);
}

function showdown(game) {
  if (game.status === 'finished') return;
  game.showdown = true;
  while (game.community.length < 5) collectBoard(game, 1);
  game.phase = 'showdown';
  game.revealedSeats = activeWithHands(game);
  const contenders = activeWithHands(game).map((seat) => ({
    seat,
    hand: bestHand([...game.hands[seat], ...game.community]),
  }));
  const levels = [...new Set(game.totalBets.filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = game.totalBets.filter((amount) => amount >= level).length;
    const amount = (level - previous) * contributors;
    previous = level;
    if (amount <= 0) continue;
    const eligible = contenders.filter((entry) => game.totalBets[entry.seat] >= level);
    pots.push({ level, amount, eligible });
  }
  if (pots.length === 0) {
    pots.push({ level: 0, amount: game.totalBets.reduce((sum, value) => sum + value, 0), eligible: contenders });
  }
  const winnings = new Map(contenders.map((entry) => [entry.seat, 0]));
  for (const pot of pots) {
    if (pot.amount <= 0) continue;
    if (pot.eligible.length === 0) {
      // Refund an uncalled excess chip layer to its only contributor.
      const contributors = game.totalBets
        .map((total, seat) => (total >= pot.level ? seat : -1))
        .filter((seat) => seat >= 0);
      if (contributors.length === 1) game.stacks[contributors[0]] += pot.amount;
      continue;
    }
    const best = pot.eligible.reduce((winner, entry) =>
      !winner || compareHands(entry.hand, winner.hand) > 0 ? entry : winner,
    null);
    const winners = pot.eligible.filter((entry) => compareHands(entry.hand, best.hand) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const ordered = [...winners].sort((a, b) => a.seat - b.seat);
    for (const winner of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      winnings.set(winner.seat, (winnings.get(winner.seat) || 0) + share + extra);
    }
  }
  for (const [seat, amount] of winnings.entries()) game.stacks[seat] += amount;
  finishGame(game, {
    showdown: true,
    winners: [...winnings.entries()].filter(([, amount]) => amount > 0).map(([seat]) => seat),
    handResults: contenders,
  });
}

function finishGame(game, { showdown: didShowdown = false, winners = [], handResults = [] } = {}) {
  if (game.status === 'finished') return;
  game.status = 'finished';
  game.phase = 'finished';
  game.currentSeat = null;
  game.actionQueue = [];
  const handBySeat = new Map(handResults.map((entry) => [entry.seat, entry.hand]));
  const nets = game.stacks.map((stack, seat) => stack - game.startingStacks[seat]);
  const order = [0, 1, 2, 3]
    .filter((seat) => seat < game.playerCount)
    .sort((a, b) => nets[b] - nets[a] || a - b);
  const winnerSeats = [];
  for (const seat of order) {
    if (nets[seat] === nets[order[0]]) winnerSeats.push(seat);
  }
  const entries = order.map((seat, index) => ({
    seat,
    place: index + 1,
    cardsLeft: game.hands[seat]?.length || 0,
    penalty: 0,
    multiplier: 1,
    points: Math.round(nets[seat] / 10),
    won: winnerSeats.includes(seat),
    role: handBySeat.get(seat)?.name || (didShowdown ? '已弃牌' : ''),
    label: `${nets[seat] >= 0 ? '+' : ''}${nets[seat]} 筹码`,
    chips: game.stacks[seat],
    net: nets[seat],
    handName: handBySeat.get(seat)?.name || null,
    folded: game.folded[seat],
    allIn: game.allIn[seat],
  }));
  const pointDelta = entries.reduce((sum, entry) => sum + entry.points, 0);
  if (pointDelta !== 0) entries[0].points -= pointDelta;
  game.revealedSeats = didShowdown ? activeWithHands(game) : [];
  game.result = {
    winnerSeat: winnerSeats[0] ?? order[0],
    winnerSeats,
    headline: didShowdown ? '德州扑克 · 摊牌' : '德州扑克 · 收池',
    detail: `底池 ${game.totalBets.reduce((sum, value) => sum + value, 0)} · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`,
    winType: didShowdown ? 'showdown' : 'fold',
    entries,
    showdown: didShowdown,
    pot: game.totalBets.reduce((sum, value) => sum + value, 0),
    nextStarterSeat: (game.dealerSeat + 1) % game.playerCount,
    firstOutSeat: null,
  };
  game.lastAction = {
    type: 'win',
    seat: winnerSeats[0] ?? null,
    at: new Date().toISOString(),
  };
  game.finishedAt = new Date().toISOString();
}

function validActions(game, seat) {
  if (game.status !== 'playing' || game.currentSeat !== seat) return null;
  const toCall = Math.max(0, game.currentBet - game.bets[seat]);
  const maxRaiseTo = game.bets[seat] + game.stacks[seat];
  const minRaiseTo = game.currentBet === 0
    ? BIG_BLIND
    : game.currentBet + Math.max(game.lastRaiseSize, BIG_BLIND);
  return {
    toCall: Math.min(toCall, game.stacks[seat]),
    canCheck: toCall === 0,
    canCall: toCall > 0 && game.stacks[seat] > 0,
    minRaiseTo: Math.min(maxRaiseTo, minRaiseTo),
    maxRaiseTo,
    canRaise: maxRaiseTo > game.currentBet && game.stacks[seat] > 0,
    canAllIn: game.stacks[seat] > 0,
    stack: game.stacks[seat],
    bet: game.bets[seat],
    pot: game.totalBets.reduce((sum, value) => sum + value, 0),
  };
}

function afterAction(game, seat) {
  game.actionQueue = game.actionQueue.filter((queuedSeat) => queuedSeat !== seat);
  normalizeQueue(game);
  if (nonFoldedCount(game) === 1) {
    const winner = game.folded.findIndex((folded) => !folded);
    const pot = game.totalBets.reduce((sum, value) => sum + value, 0);
    game.stacks[winner] += pot;
    finishGame(game, { showdown: false, winners: [winner] });
    return;
  }
  if (isBettingComplete(game)) {
    advanceStreet(game);
    return;
  }
  game.currentSeat = game.actionQueue[0] ?? null;
}

function advanceStreet(game) {
  const remainingStacks = eligibleActionSeats(game);
  if (game.phase === 'river') {
    showdown(game);
    return;
  }
  game.bets = Array(game.playerCount).fill(0);
  game.currentBet = 0;
  game.lastRaiseSize = BIG_BLIND;
  if (game.phase === 'preflop') {
    collectBoard(game, 3);
    game.phase = 'flop';
  } else if (game.phase === 'flop') {
    collectBoard(game, 1);
    game.phase = 'turn';
  } else if (game.phase === 'turn') {
    collectBoard(game, 1);
    game.phase = 'river';
  }

  if (remainingStacks.length <= 1 && nonFoldedCount(game) > 1) {
    showdown(game);
    return;
  }
  const first = nextSeatFrom(activeSeats(game), game.dealerSeat);
  game.actionQueue = queueFrom(game, first);
  normalizeQueue(game);
  if (game.actionQueue.length === 0) {
    if (game.phase === 'river') showdown(game);
    else advanceStreet(game);
    return;
  }
  game.currentSeat = game.actionQueue[0];
  game.lastAction = {
    type: 'street',
    seat: game.currentSeat,
    street: game.phase,
    at: new Date().toISOString(),
  };
}

function takeChips(game, seat, amount) {
  const paid = Math.min(amount, game.stacks[seat]);
  game.stacks[seat] -= paid;
  game.bets[seat] += paid;
  game.totalBets[seat] += paid;
  if (game.stacks[seat] === 0) game.allIn[seat] = true;
  return paid;
}

export function act(game, seat, type, payload = {}) {
  if (!game || game.status !== 'playing') throw new GameError('牌局已经结束', 'NOT_PLAYING');
  if (game.currentSeat !== seat) throw new GameError('还没有轮到你', 'NOT_YOUR_TURN');
  const actions = validActions(game, seat);
  const amount = Number(payload.amount);

  if (type === 'fold') {
    game.folded[seat] = true;
    createAction(game, seat, 'fold');
    const message = '弃牌';
    afterAction(game, seat);
    return { status: game.status, action: game.lastAction, message };
  }
  if (type === 'check') {
    if (!actions.canCheck) throw new GameError('当前不能过牌', 'CANNOT_CHECK');
    createAction(game, seat, 'check');
    const message = '过牌';
    afterAction(game, seat);
    return { status: game.status, action: game.lastAction, message };
  }
  if (type === 'call') {
    if (!actions.canCall) throw new GameError('当前不能跟注', 'CANNOT_CALL');
    const paid = takeChips(game, seat, actions.toCall);
    createAction(game, seat, 'call', { amount: paid, allIn: game.allIn[seat] });
    const message = `跟注 ${paid}${game.allIn[seat] ? '（全下）' : ''}`;
    afterAction(game, seat);
    return { status: game.status, action: game.lastAction, message };
  }
  if (type === 'raise') {
    if (!actions.canRaise) throw new GameError('当前不能加注', 'CANNOT_RAISE');
    if (!Number.isFinite(amount)) throw new GameError('加注金额不合法', 'INVALID_RAISE');
    const to = Math.floor(amount);
    if (to > actions.maxRaiseTo) throw new GameError('加注超过可用筹码', 'INVALID_RAISE');
    const previousBet = game.currentBet;
    const isAllIn = to === actions.maxRaiseTo;
    if (to < actions.minRaiseTo && !isAllIn) {
      throw new GameError(`最少加注到 ${actions.minRaiseTo}`, 'INVALID_RAISE');
    }
    if (to <= game.bets[seat]) throw new GameError('加注必须高于当前下注', 'INVALID_RAISE');
    takeChips(game, seat, to - game.bets[seat]);
    if (to > game.currentBet) {
      const raiseSize = to - game.currentBet;
      if (raiseSize >= game.lastRaiseSize) game.lastRaiseSize = raiseSize;
      game.currentBet = to;
      resetQueueAfterRaise(game, seat);
    }
    createAction(game, seat, 'raise', { to, allIn: game.allIn[seat] });
    const message = `加注到 ${to}${game.allIn[seat] ? '（全下）' : ''}`;
    afterAction(game, seat);
    return { status: game.status, action: game.lastAction, message };
  }
  throw new GameError('未知操作', 'UNKNOWN_ACTION');
}

export function getHand(game, seat) {
  if (!game?.hands?.[seat]) return [];
  return sortPoker(game.hands[seat]).map((card) => publicCard(card, pokerRank(card)));
}

export function getPublicGame(game, viewerSeat = null) {
  if (!game) return null;
  const revealAll = game.result?.showdown || game.revealedSeats.includes(viewerSeat);
  const playerStates = Array.from({ length: game.playerCount }, (_, seat) => {
    const reveal = revealAll || game.revealedSeats.includes(seat) || seat === viewerSeat;
    return {
      seat,
      stack: game.stacks[seat],
      bet: game.bets[seat],
      totalBet: game.totalBets[seat],
      folded: game.folded[seat],
      allIn: game.allIn[seat],
      dealer: seat === game.dealerSeat,
      sb: seat === game.smallBlindSeat,
      bb: seat === game.bigBlindSeat,
      holeCards: reveal
        ? game.hands[seat].map((card) => publicCard(card, pokerRank(card)))
        : [],
      handName: game.showdown ? bestHand([...game.hands[seat], ...game.community])?.name || null : null,
    };
  });
  const availableActions = viewerSeat !== null ? validActions(game, viewerSeat) : null;
  return {
    gameType: GAME_TYPE,
    status: game.status,
    phase: game.phase,
    playerCount: game.playerCount,
    currentSeat: game.currentSeat,
    dealerSeat: game.dealerSeat,
    smallBlindSeat: game.smallBlindSeat,
    bigBlindSeat: game.bigBlindSeat,
    pot: game.totalBets.reduce((sum, value) => sum + value, 0),
    currentBet: game.currentBet,
    minRaiseTo: availableActions?.minRaiseTo ?? 0,
    maxRaiseTo: availableActions?.maxRaiseTo ?? 0,
    availableActions,
    communityCards: game.community.map((card) => publicCard(card, pokerRank(card))),
    playerStates,
    handCounts: game.hands.map((hand) => hand.length),
    lastAction: game.lastAction,
    actions: game.actions.slice(-8),
    showdown: Boolean(game.showdown),
    revealedSeats: [...game.revealedSeats],
    roundNumber: game.roundNumber,
    result: game.result,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt || null,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
  };
}

/* ---------- bots ---------- */

function preflopStrength(cards) {
  const [a, b] = [...cards].sort((x, y) => pokerRank(y) - pokerRank(x));
  const ra = pokerRank(a);
  const rb = pokerRank(b);
  let score = (ra + rb) / 28;
  if (ra === rb) score += 0.45;
  if (a.suit === b.suit) score += 0.08;
  if (Math.abs(ra - rb) === 1) score += 0.06;
  if (ra === 14) score += 0.06;
  return score;
}

function handStrength(game, seat) {
  if (game.community.length === 0) return preflopStrength(game.hands[seat]);
  const hand = bestHand([...game.hands[seat], ...game.community]);
  if (!hand) return 0;
  return Math.min(1, 0.15 + hand.category * 0.1 + (hand.tiebreak[0] || 0) / 80);
}

export function botAction(game, seat) {
  if (!game || game.status !== 'playing' || game.currentSeat !== seat) return null;
  const actions = validActions(game, seat);
  if (!actions) return null;
  const strength = handStrength(game, seat);
  const pot = Math.max(BIG_BLIND, actions.pot);
  const toCall = actions.toCall;

  if (actions.canCheck) {
    if (strength > 0.68 && actions.canRaise && Math.random() < 0.28) {
      return { type: 'raise', payload: { amount: Math.min(actions.maxRaiseTo, Math.max(actions.minRaiseTo, Math.round(pot * 0.55))) } };
    }
    return { type: 'check' };
  }

  if (strength > 0.8 && actions.canRaise && Math.random() < 0.3) {
    return {
      type: 'raise',
      payload: {
        amount: Math.min(
          actions.maxRaiseTo,
          Math.max(actions.minRaiseTo, game.currentBet + Math.round(pot * 0.6)),
        ),
      },
    };
  }
  if (toCall <= actions.stack) {
    if (toCall <= Math.max(BIG_BLIND, pot * 0.18) || strength > 0.48) {
      return { type: 'call' };
    }
    if (toCall <= actions.stack && Math.random() < 0.12 && strength > 0.3) {
      return { type: 'call' };
    }
  }
  return { type: 'fold' };
}

export function getHint() {
  return null;
}

export const _test = {
  activePlayers,
  validActions,
  pokerRank,
};
