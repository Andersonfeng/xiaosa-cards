import crypto from 'node:crypto';

export const SUITS = [
  { id: 'D', symbol: '♦', name: '方块', order: 0, red: true },
  { id: 'C', symbol: '♣', name: '梅花', order: 1, red: false },
  { id: 'H', symbol: '♥', name: '红桃', order: 2, red: true },
  { id: 'S', symbol: '♠', name: '黑桃', order: 3, red: false },
];

export const RANK_LABELS = {
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
  16: '小',
  17: '大',
};

export const SUIT_BY_ID = new Map(SUITS.map((suit) => [suit.id, suit]));

export function createDeck({ decks = 1, jokers = false } = {}) {
  const cards = [];
  for (let deckIndex = 0; deckIndex < decks; deckIndex += 1) {
    for (const suit of SUITS) {
      for (let rank = 3; rank <= 15; rank += 1) {
        cards.push({
          id: `${deckIndex}-${suit.id}${rank}`,
          rank,
          suit: suit.id,
          suitSymbol: suit.symbol,
          label: RANK_LABELS[rank],
          red: suit.red,
          suitOrder: suit.order,
          deckIndex,
          joker: false,
        });
      }
    }
    if (jokers) {
      cards.push({
        id: `${deckIndex}-SJ`,
        rank: 16,
        suit: 'J',
        suitSymbol: '王',
        label: '小',
        red: false,
        suitOrder: 4,
        deckIndex,
        joker: true,
      });
      cards.push({
        id: `${deckIndex}-BJ`,
        rank: 17,
        suit: 'J',
        suitSymbol: '王',
        label: '大',
        red: true,
        suitOrder: 5,
        deckIndex,
        joker: true,
      });
    }
  }
  return cards;
}

export function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function publicCard(card, strength = card.rank) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    suitSymbol: card.suitSymbol,
    label: card.label,
    red: card.red,
    joker: Boolean(card.joker),
    strength,
    display: card.joker ? `${card.label}王` : `${card.suitSymbol}${card.label}`,
  };
}

export function groupByRank(cards) {
  const grouped = new Map();
  for (const card of cards) {
    if (!grouped.has(card.rank)) grouped.set(card.rank, []);
    grouped.get(card.rank).push(card);
  }
  return grouped;
}

export function combinations(items, size) {
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

export function sortCards(cards, strengthOf, direction = 'desc') {
  const sorted = [...cards].sort(
    (a, b) =>
      strengthOf(a) - strengthOf(b) ||
      a.suitOrder - b.suitOrder ||
      String(a.id).localeCompare(String(b.id)),
  );
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export function normalizedCards(cards) {
  return cards.map((card) => publicCard(card));
}
