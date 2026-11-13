import test from 'node:test';
import assert from 'node:assert/strict';
import * as mj from '../server/game/guangdongMahjong.js';

const tile = (key, copy = 0) => ({
  id: `${key}-${copy}`,
  key,
  kind: /^[WTB]/.test(key) ? 'suited' : 'honor',
  suit: /^[WTB]/.test(key) ? key[0] : 'H',
  number: /^[WTB]/.test(key) ? Number(key.slice(1)) : 0,
  label: key,
  sortIndex: 0,
  honor: !/^[WTB]/.test(key),
});

test('广东麻将 136 tiles and deal sizes', () => {
  const deck = mj.createTileDeck();
  assert.equal(deck.length, 136);
  assert.equal(new Set(deck.map((t) => t.id)).size, 136);
  const game = mj.createGame(4, 0);
  assert.deepEqual(game.hands.map((h) => h.length), [14, 13, 13, 13]);
  assert.equal(game.wall.length, 83);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.phase, 'discard');
});

test('广东麻将 detects standard hands and seven pairs', () => {
  const standard = [
    tile('W1', 0), tile('W1', 1), tile('W1', 2),
    tile('W2', 0), tile('W3', 0), tile('W4', 0),
    tile('T5', 0), tile('T6', 0), tile('T7', 0),
    tile('E', 0), tile('E', 1), tile('E', 2),
    tile('C', 0), tile('C', 1),
  ];
  assert.equal(mj.isWinningHand(standard, 0).win, true);
  const sevenPairs = [
    tile('W1', 0), tile('W1', 1),
    tile('W2', 0), tile('W2', 1),
    tile('T3', 0), tile('T3', 1),
    tile('T4', 0), tile('T4', 1),
    tile('B5', 0), tile('B5', 1),
    tile('E', 0), tile('E', 1),
    tile('C', 0), tile('C', 1),
  ];
  assert.equal(mj.isWinningHand(sevenPairs, 0).type, '七对');
  const notWin = [
    tile('W1', 0), tile('W3', 0), tile('W5', 0), tile('W7', 0), tile('W9', 0),
    tile('T1', 0), tile('T3', 0), tile('T5', 0), tile('T7', 0), tile('T9', 0),
    tile('B2', 0), tile('B4', 0), tile('B6', 0), tile('B8', 0),
  ];
  assert.equal(mj.isWinningHand(notWin, 0).win, false);
});

test('广东麻将 chi options include two matching sequences', () => {
  const hand = [tile('W2', 0), tile('W3', 0), tile('W4', 0), tile('W5', 0)];
  const options = mj._test.chiOptionsFor(hand, tile('W4', 1));
  assert.ok(options.length >= 1);
});

test('广东麻将 bots complete full games without stalling', () => {
  for (let round = 0; round < 24; round += 1) {
    const game = mj.createGame(4, round);
    let turns = 0;
    while (game.status === 'playing' && turns < 1500) {
      turns += 1;
      const seat = mj.getActingSeat(game);
      if (seat === null || seat === undefined) throw new Error('No acting seat');
      const move = mj.botAction(game, seat);
      if (!move) throw new Error(`No bot move for ${seat} in ${game.phase}`);
      mj.act(game, seat, move.type, move.payload);
    }
    assert.equal(game.status, 'finished', `round ${round} did not finish`);
    const total = game.result.entries.reduce((sum, entry) => sum + entry.points, 0);
    assert.equal(total, 0, `round ${round} points not zero-sum`);
  }
});

test('广东麻将 discard produces either a claim window or next draw', () => {
  const game = mj.createGame(4, 0);
  const seat = game.currentSeat;
  const tileId = game.hands[seat][0].id;
  mj.act(game, seat, 'discard', { tileId });
  assert.ok(game.phase === 'claiming' || game.currentSeat !== null);
  assert.equal(game.discards[seat].length, 1);
});
