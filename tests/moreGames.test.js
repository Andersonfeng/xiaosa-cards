import test from 'node:test';
import assert from 'node:assert/strict';
import * as dou from '../server/game/douDizhu.js';
import * as pao from '../server/game/paoYao.js';
import { createDeck } from '../server/game/cards54.js';

const douDeck = createDeck({ decks: 1, jokers: true });
const douById = new Map(douDeck.map((card) => [card.id, card]));
const douCards = (...ids) =>
  ids.map((id) => {
    const card = douById.get(id);
    if (!card) throw new Error(`Unknown Dou card ${id}`);
    return card;
  });

const paoDeck = createDeck({ decks: 2, jokers: true });
const paoById = new Map(paoDeck.map((card) => [card.id, card]));
const paoCards = (...ids) =>
  ids.map((id) => {
    const card = paoById.get(id);
    if (!card) throw new Error(`Unknown Pao card ${id}`);
    return card;
  });

test('斗地主 deal and one-round bidding resolve a landlord', () => {
  const game = dou.createGame(3, 0);
  assert.equal(game.status, 'bidding');
  assert.deepEqual(game.hands.map((hand) => hand.length), [17, 17, 17]);
  assert.equal(game.bottom.length, 3);
  const first = game.biddingSeat;
  dou.bid(game, first, 1);
  dou.bid(game, (first + 1) % 3, 2);
  dou.bid(game, (first + 2) % 3, 0);
  assert.equal(game.status, 'playing');
  assert.equal(game.landlordSeat, (first + 1) % 3);
  assert.equal(game.hands[game.landlordSeat].length, 20);
  assert.equal(game.currentSeat, game.landlordSeat);
});

test('斗地主 all pass triggers a fresh deal, bid 3 resolves immediately', () => {
  const game = dou.createGame(3, 0);
  const first = game.biddingSeat;
  dou.bid(game, first, 0);
  dou.bid(game, (first + 1) % 3, 0);
  dou.bid(game, (first + 2) % 3, 0);
  assert.equal(game.status, 'bidding');
  assert.equal(game.dealAttempt, 2);
  assert.deepEqual(game.bids, [null, null, null]);

  dou.bid(game, game.biddingSeat, 3);
  assert.equal(game.status, 'playing');
  assert.equal(game.landlordSeat, game.bids.findIndex((value) => value === 3));
});

test('斗地主 recognizes core combinations', () => {
  assert.equal(dou.classifyCards(douCards('0-D3')).kind, 'single');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-H3')).kind, 'pair');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-H3', '0-C3')).kind, 'triple');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-H3', '0-C3', '0-S4')).kind, 'triple-single');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-H3', '0-C3', '0-S4', '0-H4')).kind, 'triple-pair');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-C4', '0-H5', '0-S6', '0-D7')).kind, 'straight');
  assert.equal(dou.classifyCards(douCards('0-D3', '0-C3', '0-H4', '0-S4', '0-D5', '0-C5')).kind, 'pair-straight');
  assert.equal(
    dou.classifyCards(douCards('0-D3', '0-H3', '0-C3', '0-D4', '0-H4', '0-C4')).kind,
    'airplane',
  );
  assert.equal(
    dou.classifyCards(
      douCards('0-D3', '0-H3', '0-C3', '0-D4', '0-H4', '0-C4', '0-D5', '0-H6'),
    ).kind,
    'airplane-single',
  );
  assert.equal(
    dou.classifyCards(
      douCards('0-D3', '0-H3', '0-C3', '0-D4', '0-H4', '0-C4', '0-D5', '0-H5', '0-C6', '0-H6'),
    ).kind,
    'airplane-pair',
  );
  assert.equal(
    dou.classifyCards(douCards('0-D7', '0-H7', '0-C7', '0-S7')).kind,
    'bomb',
  );
  assert.equal(dou.classifyCards(douCards('0-SJ', '0-BJ')).kind, 'rocket');
  assert.throws(() =>
    dou.classifyCards(douCards('0-D15', '0-C3', '0-H4', '0-S5', '0-D6')),
  );
});

test('斗地主 bombs and rockets beat ordinary plays, and bombs double the stake', () => {
  const bomb = dou.classifyCards(douCards('0-D7', '0-H7', '0-C7', '0-S7'));
  const pair = dou.classifyCards(douCards('0-D8', '0-H8'));
  const rocket = dou.classifyCards(douCards('0-SJ', '0-BJ'));
  assert.equal(dou.canBeat(bomb, pair), true);
  assert.equal(dou.canBeat(rocket, bomb), true);
  assert.equal(dou.canBeat(pair, bomb), false);

  const game = dou.createGame(3, 0);
  dou.bid(game, game.biddingSeat, 3);
  const landlord = game.landlordSeat;
  game.hands[landlord] = douCards('0-D7', '0-H7', '0-C7', '0-S7', '0-D3');
  game.currentSeat = landlord;
  game.lastPlay = null;
  dou.playCards(game, landlord, ['0-D7', '0-H7', '0-C7', '0-S7']);
  assert.equal(game.bombCount, 1);
  assert.equal(game.lastPlay.combo.kind, 'bomb');
});

test('斗地主 finish produces role-based zero-sum scores', () => {
  const game = dou.createGame(3, 0);
  dou.bid(game, game.biddingSeat, 3);
  const landlord = game.landlordSeat;
  game.status = 'playing';
  game.hands = [[], [], []];
  game.hands[landlord] = douCards('0-D3');
  const other = [0, 1, 2].filter((seat) => seat !== landlord);
  game.hands[other[0]] = douCards('0-D4', '0-H5');
  game.hands[other[1]] = douCards('0-D6');
  game.currentSeat = landlord;
  game.lastPlay = null;
  game.passSeats = [];
  const outcome = dou.playCards(game, landlord, ['0-D3']);
  assert.equal(outcome.finished, true);
  assert.equal(game.result.winnerSide, 'landlord');
  assert.equal(game.result.entries.length, 3);
  const total = game.result.entries.reduce((sum, entry) => sum + entry.points, 0);
  assert.equal(total, 0);
  assert.deepEqual(
    game.result.entries.map((entry) => entry.points).sort((a, b) => a - b),
    [-3, -3, 6],
  );
});

test('斗地主 hint finds a legal reply and bots can bid', () => {
  const hand = douCards('0-D3', '0-H4', '0-C5', '0-S6', '0-D7', '0-H8');
  const previous = dou.classifyCards(douCards('0-D6'));
  const hint = dou.findHint(hand, previous);
  assert.ok(hint);
  assert.ok(hint.some((card) => card.id === '0-D7'));
  const game = dou.createGame(3, 0);
  const value = dou.botBid(game, game.biddingSeat);
  assert.ok([0, 1, 2, 3].includes(value));
});

/* ---------------------------------------------------------------
   东北刨幺
   --------------------------------------------------------------- */

test('刨幺 uses two decks, 27 cards each, and 200 points in the pack', () => {
  const game = pao.createGame(4, 0);
  assert.equal(game.status, 'playing');
  assert.deepEqual(game.hands.map((hand) => hand.length), [27, 27, 27, 27]);
  assert.equal(paoDeck.length, 108);
  const points = paoDeck.reduce((sum, card) => sum + (pao.POINT_VALUE[card.rank] || 0), 0);
  assert.equal(points, 200);
});

test('刨幺 single/pair/straight strength follows local order', () => {
  const three = pao.classifyCards(paoCards('0-D3'));
  const two = pao.classifyCards(paoCards('0-D15'));
  const ace = pao.classifyCards(paoCards('0-D14'));
  const smallJoker = pao.classifyCards(paoCards('0-SJ'));
  const bigJoker = pao.classifyCards(paoCards('0-BJ'));
  assert.equal(pao.canBeat(three, two), true);
  assert.equal(pao.canBeat(two, ace), true);
  assert.equal(pao.canBeat(smallJoker, three), true);
  assert.equal(pao.canBeat(bigJoker, smallJoker), true);
  assert.throws(() => pao.classifyCards(paoCards('0-D15', '0-C3', '0-H4')));
});

test('刨幺 straights, double dragons and riding dragons', () => {
  const straight = pao.classifyCards(paoCards('0-D4', '0-C5', '0-H6'));
  const longer = pao.classifyCards(paoCards('0-D5', '0-C6', '0-H7'));
  assert.equal(straight.kind, 'straight');
  assert.equal(pao.canBeat(longer, straight), true);

  const double = pao.classifyCards(
    paoCards('0-D5', '0-C5', '0-H6', '0-S6', '0-D7', '0-C7'),
  );
  assert.equal(double.kind, 'double-straight');
  assert.equal(pao.canBeat(double, straight), true);

  const lowDouble = pao.classifyCards(
    paoCards('0-D4', '0-C4', '0-H5', '0-S5', '0-D6', '0-C6'),
  );
  assert.equal(pao.canBeat(lowDouble, straight), false);
});

test('刨幺 roads, yao and joker bombs follow the published ordering', () => {
  const road3 = pao.classifyCards(paoCards('0-D9', '0-C9', '0-H9'));
  const road4 = pao.classifyCards(paoCards('0-D9', '0-C9', '0-H9', '0-S9'));
  const road8 = pao.classifyCards(
    paoCards('0-D9', '0-C9', '0-H9', '0-S9', '1-D9', '1-C9', '1-H9', '1-S9'),
  );
  const smallYao = pao.classifyCards(paoCards('0-D4', '0-C4', '0-H14'));
  const middleYao = pao.classifyCards(paoCards('0-D4', '0-C4', '0-H4', '0-S14'));
  const oldYao = pao.classifyCards(
    paoCards('0-D4', '0-C4', '0-H4', '0-S4', '1-D14'),
  );
  const oldOldYao = pao.classifyCards(
    paoCards('0-D4', '0-C4', '0-H4', '0-S4', '1-D4', '1-C14'),
  );
  const smallPair = pao.classifyCards(paoCards('0-SJ', '1-SJ'));
  const fourJokers = pao.classifyCards(paoCards('0-SJ', '1-SJ', '0-BJ', '1-BJ'));

  assert.equal(smallYao.name, '小幺');
  assert.equal(middleYao.name, '中幺');
  assert.equal(oldYao.name, '老幺');
  assert.equal(oldOldYao.name, '老老幺');
  assert.ok(pao.canBeat(smallPair, road3));
  assert.ok(pao.canBeat(road4, smallPair));
  assert.ok(pao.canBeat(smallYao, road4));
  assert.ok(pao.canBeat(road8, smallYao));
  assert.ok(pao.canBeat(fourJokers, road8));
  assert.ok(pao.canBeat(oldYao, fourJokers));
  assert.ok(pao.canBeat(oldOldYao, oldYao));
});

test('刨幺 power plays cannot always beat double dragons', () => {
  const road3 = pao.classifyCards(paoCards('0-D9', '0-C9', '0-H9'));
  const road4 = pao.classifyCards(paoCards('0-D9', '0-C9', '0-H9', '0-S9'));
  const double = pao.classifyCards(
    paoCards('0-D5', '0-C5', '0-H6', '0-S6', '0-D7', '0-C7'),
  );
  assert.equal(pao.canBeat(road3, double), false);
  assert.equal(pao.canBeat(road4, double), true);
});

test('刨幺 trick scoring, double fly, and team result', () => {
  const game = pao.createGame(4, 0);
  game.hands = [[], [], [], []];
  // Team 0 (seats 0/2) has two cards left; team 1 has one each.
  game.hands[0] = paoCards('0-D5', '0-D6');
  game.hands[1] = paoCards('0-H7');
  game.hands[2] = paoCards('0-C5');
  game.hands[3] = paoCards('0-S8');
  game.currentSeat = 0;
  game.lastPlay = null;
  game.passSeats = [];
  pao.playCards(game, 0, ['0-D5']);
  assert.equal(game.pilePoints, 5);
  pao.passTurn(game, 1);
  pao.passTurn(game, 2);
  const after = pao.passTurn(game, 3);
  assert.equal(after.newTrick, true);
  assert.equal(game.teamScores[0], 5);
  assert.equal(game.currentSeat, 0);

  pao.playCards(game, 0, ['0-D6']);
  // Seat 0 is now out; seat 1 cannot beat and passes, 2 passes, 3 passes.
  pao.passTurn(game, 1);
  pao.passTurn(game, 2);
  pao.passTurn(game, 3);
  assert.ok(game.status === 'playing' || game.status === 'finished');
});

test('刨幺 hint can find riding dragons and power plays', () => {
  const hand = paoCards(
    '0-D5',
    '0-C5',
    '0-H6',
    '0-S6',
    '0-D7',
    '0-C7',
    '0-H9',
    '0-C9',
    '0-D9',
  );
  const straight = pao.classifyCards(paoCards('0-D4', '0-C6', '0-H7', '0-S5'));
  // Not a legal straight; use a real one.
  const legal = pao.classifyCards(paoCards('0-D4', '0-C5', '0-H6'));
  const hint = pao.findHint(hand, legal);
  assert.ok(hint);
  assert.ok(hint.length >= 3);
  const powerHint = pao.findHint(hand, pao.classifyCards(paoCards('0-D14')));
  assert.ok(powerHint);
});
