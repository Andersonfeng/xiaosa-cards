import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCards,
  compareCombos,
  createDeck,
  dealCards,
  createGame,
  findHint,
  generateCandidates,
  passTurn,
  playCards,
  straightHighValue,
  GameError,
} from '../server/game/bigTwo.js';

const deck = createDeck();
const byId = new Map(deck.map((card) => [card.id, card]));
const cards = (...ids) => ids.map((id) => {
  const card = byId.get(id);
  if (!card) throw new Error(`Unknown card ${id}`);
  return card;
});

test('deck contains 52 unique cards and ranks 2 as highest', () => {
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.id)).size, 52);
  assert.equal(byId.get('S15').rank, 15);
  assert.equal(byId.get('D3').rank, 3);
  assert.ok(compareCombos(classifyCards(cards('S15')), classifyCards(cards('S14'))) > 0);
});

test('single, pair and triple compare rank and then suit', () => {
  assert.ok(compareCombos(classifyCards(cards('S3')), classifyCards(cards('H3'))) > 0);
  assert.ok(compareCombos(classifyCards(cards('H5')), classifyCards(cards('S4'))) > 0);
  const pairA = classifyCards(cards('S9', 'H9'));
  const pairB = classifyCards(cards('C9', 'D9'));
  assert.ok(compareCombos(pairA, pairB) > 0);
  assert.equal(classifyCards(cards('S9', 'H9')).name, '对子');
  assert.equal(classifyCards(cards('S9', 'H9', 'C9')).name, '三条');
});

test('five-card categories follow poker order', () => {
  const straight = classifyCards(cards('D3', 'C4', 'H5', 'S6', 'D7'));
  const flush = classifyCards(cards('D3', 'D7', 'D9', 'D11', 'D13'));
  const fullHouse = classifyCards(cards('S9', 'H9', 'C9', 'D4', 'C4'));
  const fourKind = classifyCards(cards('S9', 'H9', 'C9', 'D9', 'C4'));
  const straightFlush = classifyCards(cards('H4', 'H5', 'H6', 'H7', 'H8'));

  assert.equal(straight.name, '顺子');
  assert.equal(flush.name, '同花');
  assert.equal(fullHouse.name, '葫芦');
  assert.equal(fourKind.name, '四条');
  assert.equal(straightFlush.name, '同花顺');

  assert.ok(compareCombos(flush, straight) > 0);
  assert.ok(compareCombos(fullHouse, flush) > 0);
  assert.ok(compareCombos(fourKind, fullHouse) > 0);
  assert.ok(compareCombos(straightFlush, fourKind) > 0);
});

test('straight rules include A-2-3-4-5 and 2-3-4-5-6 but not J-Q-K-A-2', () => {
  assert.equal(straightHighValue(cards('D14', 'C15', 'H3', 'S4', 'D5')), 5);
  assert.equal(straightHighValue(cards('D15', 'C3', 'H4', 'S5', 'D6')), 6);
  assert.equal(straightHighValue(cards('D11', 'C12', 'H13', 'S14', 'D15')), null);
  assert.equal(straightHighValue(cards('D10', 'C11', 'H12', 'S13', 'D14')), 14);
  assert.throws(
    () => classifyCards(cards('D11', 'C12', 'H13', 'S14', 'D15')),
    (error) => error instanceof GameError,
  );
});

test('five-card hands can beat lower categories with different shapes', () => {
  const straight = classifyCards(cards('D3', 'C4', 'H5', 'S6', 'D7'));
  const flush = classifyCards(cards('D8', 'D9', 'D11', 'D12', 'D13'));
  assert.ok(compareCombos(flush, straight) > 0);
  const lowStraight = classifyCards(cards('D3', 'C4', 'H5', 'S6', 'D7'));
  const highStraight = classifyCards(cards('C8', 'H9', 'S10', 'D11', 'C12'));
  assert.ok(compareCombos(highStraight, lowStraight) > 0);
});

test('a full deal is complete and the holder of 3D starts', () => {
  for (const playerCount of [2, 3, 4]) {
    const dealt = dealCards(playerCount, 1);
    assert.equal(dealt.length, playerCount);
    const all = dealt.flat();
    assert.equal(all.length, 52);
    assert.equal(new Set(all.map((card) => card.id)).size, 52);
    assert.ok(dealt.some((hand) => hand.some((card) => card.id === 'D3')));
    const game = createGame(playerCount, 1);
    assert.ok(game.hands[game.starterSeat].some((card) => card.id === 'D3'));
    assert.equal(game.currentSeat, game.starterSeat);
    assert.deepEqual(
      game.hands.map((hand) => hand.length).sort((a, b) => a - b),
      playerCount === 2 ? [26, 26] : playerCount === 3 ? [17, 17, 18] : [13, 13, 13, 13],
    );
  }
});

test('first play must include 3D and passing while leading is rejected', () => {
  const game = {
    status: 'playing',
    hands: [cards('D3', 'C4'), cards('C3', 'H4')],
    initialCounts: [2, 2],
    playerCount: 2,
    currentSeat: 0,
    starterSeat: 0,
    lastPlay: null,
    passSeats: [],
    turnCount: 0,
    lastAction: null,
  };
  assert.throws(() => playCards(game, 0, ['C4']), /方块 3/);
  assert.throws(() => passTurn(game, 0), /必须出牌/);
  const result = playCards(game, 0, ['D3']);
  assert.equal(result.finished, false);
  assert.equal(game.currentSeat, 1);
});

test('passing ends a trick and returns the lead to the last player', () => {
  const game = createGame(2, 0);
  const starter = game.starterSeat;
  const leadCard = game.hands[starter].find((card) => card.id === 'D3');
  playCards(game, starter, [leadCard.id]);
  const other = (starter + 1) % 2;
  game.currentSeat = other;
  const outcome = passTurn(game, other);
  assert.equal(outcome.newTrick, true);
  assert.equal(game.currentSeat, starter);
  assert.equal(game.lastPlay, null);
  assert.deepEqual(game.passSeats, []);
});

test('finishing a hand produces ranking and zero-sum points', () => {
  const game = {
    status: 'playing',
    hands: [cards('D3'), cards('C4', 'H5')],
    initialCounts: [1, 2],
    playerCount: 2,
    currentSeat: 0,
    starterSeat: 0,
    lastPlay: null,
    passSeats: [],
    turnCount: 0,
    lastAction: null,
  };
  const outcome = playCards(game, 0, ['D3']);
  assert.equal(outcome.finished, true);
  assert.equal(game.status, 'finished');
  assert.equal(game.result.winnerSeat, 0);
  assert.equal(game.result.entries[0].place, 1);
  assert.equal(game.result.entries[1].penalty, 6);
  assert.equal(game.result.entries[0].points, 6);
  assert.equal(game.result.entries[1].points, -6);
  const total = game.result.entries.reduce((sum, entry) => sum + entry.points, 0);
  assert.equal(total, 0);
});

test('hint returns the weakest legal beat, or a low lead', () => {
  const hand = cards('C4', 'D7', 'H9', 'S15');
  const previous = classifyCards(cards('H5'));
  const hint = findHint(hand, previous);
  assert.deepEqual(hint.map((card) => card.id), ['D7']);
  const lead = findHint(hand, null);
  assert.deepEqual(lead.map((card) => card.id), ['C4']);
  assert.equal(findHint(cards('C4', 'D7'), classifyCards(cards('S15'))), null);
});

test('candidate generation finds five-card combinations without powerset blowup', () => {
  const hand = cards('D3', 'D4', 'D5', 'D6', 'D9', 'C3', 'C4', 'C5', 'C6', 'C7');
  const candidates = generateCandidates(hand, 5);
  assert.ok(candidates.length > 0);
  const names = new Set(
    candidates
      .map((candidate) => {
        try {
          return classifyCards(candidate).name;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
  assert.ok(names.has('顺子'));
  assert.ok(names.has('同花'));
  assert.ok(names.has('同花顺'));
});
