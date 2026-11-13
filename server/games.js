import * as bigTwo from './game/bigTwo.js';
import * as douDizhu from './game/douDizhu.js';
import * as paoYao from './game/paoYao.js';

const BIG_TWO_RULES = {
  summary: '先出完手牌者获胜；其余玩家按剩余手牌计分。',
  sections: [
    {
      title: '牌力与花色',
      body: '点数 2 > A > K > Q > J > 10 … > 3。同点数比花色：黑桃 > 红桃 > 梅花 > 方块。',
    },
    {
      title: '合法牌型',
      body: '单张、对子、三条，以及五张牌型：顺子 < 同花 < 葫芦 < 四条 < 同花顺。五张牌型可以跨类型压制。',
    },
    {
      title: '顺子规则',
      body: '支持 3-4-5-6-7 至 10-J-Q-K-A，另设 A-2-3-4-5 与 2-3-4-5-6 两种小顺；J-Q-K-A-2 不算顺子。',
    },
    {
      title: '轮流出牌',
      body: '持有方块 3 的玩家先手，首轮必须带出方块 3。之后每轮需出相同张数且更大的牌，或选择不要。其余玩家全部不要后，最后出牌者重新领出。',
    },
    {
      title: '计分',
      body: '一局结束时，剩牌 1–9 张每张 1 分，达到起始手牌 75% 每张 2 分，未出过牌每张 3 分。赢家获得所有失分之和。',
    },
    {
      title: '房间人数',
      body: '支持 2–4 人。两人各 26 张，三人 18/17/17 张，四人各 13 张。房主可补入电脑玩家。',
    },
  ],
};

const DOU_DIZHU_RULES = {
  summary: '三人斗地主：叫地主、抢底牌，地主先出完牌则地主胜，任一农民先出完则农民胜。',
  sections: [
    {
      title: '人数与发牌',
      body: '3 人使用一副 54 张牌（含大小王），每人 17 张，留 3 张底牌。',
    },
    {
      title: '叫地主',
      body: '从先叫位开始轮流叫 1 / 2 / 3 分或「不叫」，每人一轮，最高分成为地主并拿走 3 张底牌；叫 3 分立即成为地主。全部不叫会重新发牌。',
    },
    {
      title: '牌型',
      body: '单张、对子、三条、三带一、三带二、顺子（5 张以上）、连对（3 对以上）、飞机、飞机带单/带对、四带二、四带两对、炸弹、王炸。',
    },
    {
      title: '牌力',
      body: '点数 3 < 4 < … < A < 2 < 小王 < 大王。普通牌型需同类型、同张数比较；炸弹压普通牌，王炸最大。',
    },
    {
      title: '计分',
      body: '底分为最高叫分；每打出一次炸弹或王炸，倍数翻倍。地主胜：地主 +2×底分×倍数，两位农民各扣 1×；农民胜则相反。',
    },
    {
      title: '房间人数',
      body: '斗地主固定 3 人。房主可以在等待房补入电脑玩家。',
    },
  ],
};

const PAO_YAO_RULES = {
  summary: '东北刨幺：四人两副牌，对家一队，先抢分并出完手牌。',
  sections: [
    {
      title: '人数与发牌',
      body: '4 人使用两副牌共 108 张，每人 27 张。对角座位为同一队：红队 1、3 号位，蓝队 2、4 号位（界面按座位显示）。',
    },
    {
      title: '牌力',
      body: '单张：大王 > 小王 > 3 > 2 > A > K > Q > J > 10 … > 4。对子按同一点数比较。3 和 2 不能进入顺子。',
    },
    {
      title: '牌型',
      body: '单张、对子、单龙（3 张以上连续单牌）、双龙（3 对以上连续对牌）、3–8 路（同点数 3 张以上）、幺牌（A + 2～8 张 4）、王炸组合。双龙可以「骑」同张数的单龙。',
    },
    {
      title: '幺牌与王炸',
      body: '小幺 44A < 中幺 444A < 老幺 4444A < 老老幺（5 张以上 4 + A）。王炸组合从双小王、大小王、大王对，到四张王。',
    },
    {
      title: '抓分',
      body: '5 算 5 分，10 和 K 各算 10 分，两副牌共 200 分。一墩牌被一方收下时，该队获得本墩所有分数。',
    },
    {
      title: '出牌与接风',
      body: '首局由房主座位先出，之后由上局最先出完牌的玩家先出。玩家选择「不要」后本轮不再出牌，直到本轮结束。一名玩家出完后，若其最后一手无人压住，则由其对家接风领出；一队两人都出完则直接「双飞」。',
    },
    {
      title: '胜负',
      body: '一队达到 140 分，或先出完牌的一方（扛旗）且队伍达到 90 分，即获胜；一队两人都先出完则为「双飞」获胜。达到 200 分按大雪 4 倍结算。',
    },
    {
      title: '本馆规则',
      body: '为保持线上节奏，本店暂不启用「雪牌」追加阶段：达到条件即结束，按 1 倍结算；200 分按 4 倍结算。其余核心牌型与比较顺序遵循东北刨幺通行规则。',
    },
  ],
};

export const GAME_REGISTRY = [
  {
    id: 'big-two',
    name: '锄大地',
    englishName: 'Big Two',
    tagline: '广东 / 香港经典扑克',
    description: '先出完手牌者胜。单张、对子、三条与五种五张牌型轮流出击。',
    minPlayers: 2,
    maxPlayers: 4,
    enabled: true,
    accent: 'jade',
    rules: BIG_TWO_RULES,
  },
  {
    id: 'dou-dizhu',
    name: '斗地主',
    englishName: 'Dou Dizhu',
    tagline: '三人叫地主攻防',
    description: '叫分抢地主，炸弹翻倍，地主与两位农民三足鼎立。',
    minPlayers: 3,
    maxPlayers: 3,
    enabled: true,
    accent: 'amber',
    rules: DOU_DIZHU_RULES,
  },
  {
    id: 'pao-yao',
    name: '东北刨幺',
    englishName: 'Pao Yao',
    tagline: '四人两副牌 · 对家协作',
    description: '108 张牌、对家一队，抢 5/10/K 分数，路、幺、王炸层层压制。',
    minPlayers: 4,
    maxPlayers: 4,
    enabled: true,
    accent: 'rose',
    rules: PAO_YAO_RULES,
  },
];

export const GAME_MAP = new Map(GAME_REGISTRY.map((game) => [game.id, game]));

const ENGINE_ADAPTERS = {
  'big-two': {
    create({ playerCount, roundNumber }) {
      return bigTwo.createGame(playerCount, roundNumber);
    },
    play: bigTwo.playCards,
    pass: bigTwo.passTurn,
    getHand: bigTwo.getHand,
    getPublic(game) {
      return { ...bigTwo.getPublicGame(game), gameType: 'big-two' };
    },
    getHint(game, seat) {
      const cards = bigTwo.findHint(game.hands[seat], game.lastPlay?.combo || null);
      return cards ? cards.map((card) => card.id) : null;
    },
    bid: null,
    botBid: null,
    isBidding: () => false,
    startText(room, game) {
      const starter = room.players[game.starterSeat]?.displayName || '玩家';
      return `第 ${room.roundNumber} 局开始，${starter} 持有方块 3 先手`;
    },
  },
  'dou-dizhu': {
    create({ playerCount, roundNumber, starterSeat }) {
      return douDizhu.createGame(playerCount, roundNumber, { starterSeat });
    },
    play: douDizhu.playCards,
    pass: douDizhu.passTurn,
    getHand: douDizhu.getHand,
    getPublic: douDizhu.getPublicGame,
    getHint: douDizhu.getHint,
    bid: douDizhu.bid,
    botBid: douDizhu.botBid,
    isBidding: (game) => game.status === 'bidding',
    startText(room, game) {
      const starter = room.players[game.biddingSeat]?.displayName || '玩家';
      return `第 ${room.roundNumber} 局开始，${starter} 先叫地主`;
    },
  },
  'pao-yao': {
    create({ playerCount, roundNumber, starterSeat }) {
      return paoYao.createGame(playerCount, roundNumber, { starterSeat });
    },
    play: paoYao.playCards,
    pass: paoYao.passTurn,
    getHand: paoYao.getHand,
    getPublic: paoYao.getPublicGame,
    getHint: paoYao.getHint,
    bid: null,
    botBid: null,
    isBidding: () => false,
    startText(room, game) {
      const starter = room.players[game.currentSeat]?.displayName || '玩家';
      return `第 ${room.roundNumber} 局开始，红队对蓝队，${starter} 先出牌`;
    },
  },
};

export function getEngine(gameType) {
  const engine = ENGINE_ADAPTERS[gameType];
  if (!engine) throw new Error(`Unknown game engine: ${gameType}`);
  return engine;
}

export function formatCards(combo) {
  return (combo?.cards || [])
    .map((card) => card.display || `${card.label || ''}${card.suitSymbol || ''}`)
    .join(' ');
}

export { BIG_TWO_RULES, DOU_DIZHU_RULES, PAO_YAO_RULES };
