import test from 'node:test';
import assert from 'node:assert/strict';
import * as texas from '../server/game/texasHoldem.js';
import { createDeck } from '../server/game/cards54.js';

const deck = createDeck({ decks: 1, jokers: false });
const byId = new Map(deck.map((card) => [card.id, card]));
const cards = (...ids) =>
  ids.map((id) => {
    const card = byId.get(id);
    if (!card) throw new Error(`Unknown card ${id}`);
    return card;
  });

test('德州扑克 evaluates poker hands with ace-low straights', () => {
  const wheel = texas.evaluateFive(cards('0-D14', '0-C15', '0-H3', '0-S4', '0-D5'));
  assert.equal(wheel.name, '顺子');
  const straightFlush = texas.evaluateFive(cards('0-D14', '0-D15', '0-D3', '0-D4', '0-D5'));
  assert.equal(straightFlush.name, '同花顺');
  const quads = texas.evaluateFive(cards('0-D9', '0-C9', '0-H9', '0-S9', '0-D5'));
  assert.equal(quads.name, '四条');
  const fullHouse = texas.evaluateFive(cards('0-D9', '0-C9', '0-H9', '0-S5', '0-D5'));
  assert.equal(fullHouse.name, '葫芦');
  const flush = texas.evaluateFive(cards('0-D3', '0-D7', '0-D9', '0-D11', '0-D13'));
  assert.equal(flush.name, '同花');
  const pair = texas.evaluateFive(cards('0-D3', '0-C3', '0-H9', '0-S11', '0-D13'));
  assert.equal(pair.name, '一对');
});

test('德州扑克 compares hands and finds best five of seven', () => {
  const higherFlush = texas.evaluateFive(cards('0-D4', '0-D7', '0-D9', '0-D11', '0-D13'));
  const lowerFlush = texas.evaluateFive(cards('0-C15', '0-C4', '0-C7', '0-C9', '0-C11'));
  assert.ok(texas.compareHands(higherFlush, lowerFlush) > 0);

  const seven = cards(
    '0-D14',
    '0-D13',
    '0-D12',
    '0-D11',
    '0-D10',
    '0-C9',
    '0-H9',
  );
  const best = texas.bestHand(seven);
  assert.equal(best.name, '同花顺');
});

test('德州扑克 posts blinds and advances betting streets', () => {
  const game = texas.createGame(3, 0);
  assert.equal(game.dealerSeat, 0);
  assert.equal(game.smallBlindSeat, 1);
  assert.equal(game.bigBlindSeat, 2);
  assert.deepEqual(game.stacks, [1000, 990, 980]);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.currentBet, 20);
  texas.act(game, 0, 'call');
  texas.act(game, 1, 'call');
  texas.act(game, 2, 'check');
  assert.equal(game.phase, 'flop');
  assert.equal(game.community.length, 3);
  assert.equal(game.currentBet, 0);
  texas.act(game, 1, 'check');
  texas.act(game, 2, 'check');
  texas.act(game, 0, 'check');
  assert.equal(game.phase, 'turn');
  assert.equal(game.community.length, 4);
});

test('德州扑克 fold ends the hand and awards the pot', () => {
  const game = texas.createGame(2, 0);
  assert.equal(game.currentSeat, 0);
  texas.act(game, 0, 'fold');
  assert.equal(game.status, 'finished');
  assert.equal(game.result.winnerSeats[0], 1);
  assert.equal(game.stacks[1], 1010);
  assert.equal(game.stacks[0], 990);
  const total = game.result.entries.reduce((sum, entry) => sum + entry.points, 0);
  assert.equal(total, 0);
});

test('德州扑克 bots can complete hands without stalling', () => {
  for (let round = 0; round < 120; round += 1) {
    const game = texas.createGame(2 + (round % 3), round);
    let guard = 0;
    while (game.status === 'playing' && guard < 600) {
      guard += 1;
      const seat = game.currentSeat;
      const move = texas.botAction(game, seat);
      if (!move) throw new Error(`No bot move for seat ${seat}`);
      texas.act(game, seat, move.type, move.payload);
    }
    assert.equal(game.status, 'finished', `round ${round} did not finish`);
    const total = game.result.entries.reduce((sum, entry) => sum + entry.points, 0);
    assert.equal(total, 0);
    assert.equal(
      game.result.entries.reduce((sum, entry) => sum + entry.net, 0),
      0,
    );
  }
});

test('德州扑克 raises are bounded and turns advance', () => {
  const game = texas.createGame(3, 0);
  texas.act(game, 0, 'raise', { amount: 60 });
  assert.equal(game.currentBet, 60);
  assert.equal(game.currentSeat, 1);
  assert.throws(() => texas.act(game, 1, 'raise', { amount: 65 }), /最少加注/);
  texas.act(game, 1, 'fold');
  assert.equal(game.currentSeat, 2);
  texas.act(game, 2, 'call');
  assert.equal(game.phase, 'flop');
});

test('德州扑克 builds a side pot when a short stack is all-in', () => {
  const game = texas.createGame(3, 0);
  game.stacks[0] = 50;
  game.startingStacks[0] = 50;
  texas.act(game, 0, 'raise', { amount: 50 });
  texas.act(game, 1, 'call');
  texas.act(game, 2, 'raise', { amount: 100 });
  texas.act(game, 1, 'call');
  let guard = 0;
  while (game.status === 'playing' && guard < 20) {
    guard += 1;
    const seat = game.currentSeat;
    const actions = texas._test.validActions(game, seat);
    if (actions.canCheck) texas.act(game, seat, 'check');
    else texas.act(game, seat, 'call');
  }
  assert.equal(game.status, 'finished');
  assert.equal(game.totalBets[0], 50);
  assert.equal(game.totalBets[1], 100);
  assert.equal(game.totalBets[2], 100);
  assert.equal(game.stacks.reduce((sum, stack) => sum + stack, 0), 2050);
  assert.equal(game.result.entries.reduce((sum, entry) => sum + entry.net, 0), 0);
});
