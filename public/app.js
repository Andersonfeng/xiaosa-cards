/* =========================================================
   潇洒纸牌屋 · Xiaosa Club
   Client application (no framework, no build step)
   ========================================================= */

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦' };
const SUIT_ORDER = { D: 0, C: 1, H: 2, S: 3 };
const FACE_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };

const RULES_FALLBACK = {
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
  ],
};

const state = {
  token: localStorage.getItem('xiaosa_token') || '',
  user: null,
  route: { name: 'landing', code: null },
  games: [],
  rooms: [],
  roomsLoaded: false,
  room: null,
  homeRoomCode: null,
  pendingRoute: null,
  loginError: '',
  loginPortal: 'game',
  adminTab: 'overview',
  adminLoading: false,
  adminOverview: null,
  adminUsers: [],
  adminSearch: '',
  adminLoaded: false,
  sseLobby: false,
  sseRoom: false,
  sound: localStorage.getItem('xiaosa_sound') !== 'off',
  booted: false,
  ui: {
    selected: new Set(),
    handSort: 'desc',
    chatDraft: '',
    busy: false,
    actionBusy: false,
    dealAnimate: false,
    modalOpen: false,
    lastFocused: null,
    mjSelected: null,
    texasRaise: '',
  },
};

let routeNonce = 0;
let lobbyES = null;
let roomES = null;
let adminTimer = null;
let chatAutoScroll = true;

/* ---------- tiny helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);

const icon = (name, cls = '') => {
  const paths = {
    arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    users:
      '<path d="M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 18.4V20"/><circle cx="9.5" cy="7.5" r="3.2"/><path d="M17 4.4a3.2 3.2 0 0 1 0 6.2M21 20v-1.6a3.4 3.4 0 0 0-2.7-3.3"/>',
    userPlus:
      '<path d="M15 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H5.4A3.4 3.4 0 0 0 2 18.4V20"/><circle cx="8.5" cy="7.5" r="3.2"/><path d="M19 8v6M22 11h-6"/>',
    shield:
      '<path d="M12 3 20 6v5.4c0 4.8-3.3 8.1-8 9.6-4.7-1.5-8-4.8-8-9.6V6z"/><path d="m8.8 11.9 2.1 2.1 4.4-4.4"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    refresh:
      '<path d="M20 11a8 8 0 0 0-14.7-4.4L3 9m0-6v6h6M4 13a8 8 0 0 0 14.7 4.4L21 15m0 6v-6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    door:
      '<path d="M14 4h4v16h-4M10 17l5-5-5-5M15 12H3"/>',
    logout:
      '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
    copy:
      '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search:
      '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    edit:
      '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:
      '<path d="M4 7h16M9 7V5h6v2M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5"/>',
    power:
      '<path d="M12 2v9M6.3 5.5a8 8 0 1 0 11.4 0"/>',
    volume:
      '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>',
    mute:
      '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 5M21 9l-5 5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
    chat:
      '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.8-.9L3 21l2.1-5.5a8.1 8.1 0 0 1-1.1-4A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
    crown:
      '<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 11H5z"/><path d="M5 21h14"/>',
    bot:
      '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 13h.01M16 13h.01M9 17h6"/>',
    cards:
      '<rect x="7" y="4" width="12" height="16" rx="2"/><path d="M7 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2"/>',
    trophy:
      '<path d="M8 3h8v5a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6"/>',
    clock:
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart:
      '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    list:
      '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    eye:
      '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff:
      '<path d="M3 3l18 18M10.6 5.7A10.4 10.4 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17.4 17.4 0 0 1-3.2 4M6.6 6.7A17 17 0 0 0 2 12s3.5 6.5 10 6.5a10.6 10.6 0 0 0 4.2-.9"/>',
    info:
      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    key:
      '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 3h5v5"/>',
    link:
      '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    spark:
      '<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/>',
    sort:
      '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
    bulb:
      '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.7-1.5 2.5h-4c0-.8-.6-1.8-1.5-2.5z"/>',
    xCircle:
      '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    clockArrow:
      '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/><path d="M12 8v4l3 2"/>',
    table:
      '<path d="M3 10h18M5 10V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M4 10v10M20 10v10M3 16h18"/>',
    wifi:
      '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01"/>',
  };
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};

const cardSuit = (card) => card?.suitSymbol || SUIT_SYMBOLS[card?.suit] || '?';
const cardRank = (card) => card?.label || FACE_LABELS[card?.rank] || String(card?.rank ?? '?');

function cardHTML(card, options = {}) {
  if (!card) return '';
  const {
    clickable = false,
    selected = false,
    small = false,
    tiny = false,
    index = 0,
    extraClass = '',
    style = '',
  } = options;
  const label = cardRank(card);
  const suit = cardSuit(card);
  const red = card.red ?? (card.suit === 'H' || card.suit === 'D');
  const rankNum = Number(card.rank);
  const face = rankNum >= 11;
  const classes = [
    'playing-card',
    red ? 'red' : 'black',
    small ? 'small' : '',
    tiny ? 'tiny' : '',
    clickable ? 'clickable' : '',
    selected ? 'selected hand-card' : '',
    face ? 'face-card' : '',
    extraClass,
  ]
    .filter(Boolean)
    .join(' ');
  const tag = clickable ? 'button' : 'div';
  const type = clickable ? ' type="button"' : '';
  const cardIdAttr = clickable && card.id ? ` data-card-id="${esc(card.id)}"` : '';
  const inlineStyle = [style, `--i:${index}`, `z-index:${index + 1}`]
    .filter(Boolean)
    .join(';');
  const aria = clickable
    ? ` aria-label="${esc(`${label}${suit}，${selected ? '已选中' : '点击选牌'}`)}" aria-pressed="${selected}"`
    : ` aria-hidden="true"`;
  return `<${tag}${type} class="${classes}"${cardIdAttr}${aria} style="${inlineStyle}">
    <span class="card-weave"></span>
    <span class="corner"><span class="rank">${esc(label)}</span><span class="suit">${suit}</span></span>
    ${face ? `<span class="face-letter">${esc(label)}</span>` : ''}
    <span class="center-suit">${suit}</span>
    <span class="corner corner-bottom"><span class="rank">${esc(label)}</span><span class="suit">${suit}</span></span>
  </${tag}>`;
}

function cardBack(extraClass = '') {
  return `<div class="playing-card back ${extraClass}" aria-hidden="true"></div>`;
}

function initials(name) {
  const chars = [...String(name || '?').trim()];
  if (chars.length === 0) return '?';
  if (/^[a-zA-Z0-9]/.test(chars[0])) return chars.slice(0, 2).join('').toUpperCase();
  return chars.slice(0, 2).join('');
}

const AVATAR_PALETTES = [
  ['#5b9b80', '#214b3c'],
  ['#b07b4e', '#55351f'],
  ['#7589b8', '#2f3f63'],
  ['#a56d88', '#512d3d'],
  ['#7c9d54', '#344b24'],
  ['#b5665d', '#552c29'],
  ['#58a0a2', '#1f4447'],
];

function avatarPalette(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 997;
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function avatarHTML(player, options = {}) {
  const { size = '', ring = false } = options;
  const name = player?.displayName || player?.name || player?.username || '玩家';
  const [a, b] = avatarPalette(name);
  const isBot = Boolean(player?.isBot);
  const content = isBot
    ? esc(player?.avatar || '🤖')
    : esc(initials(name));
  return `<span class="avatar ${size} ${ring ? 'avatar-ring' : ''} ${isBot ? 'avatar-bot' : ''}" style="--avatar-a:${a};--avatar-b:${b}" title="${esc(name)}">${content}</span>`;
}

function formatDate(iso, withTime = true) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(iso, false);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深喇';
  if (hour < 12) return '朝早好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function todayLabel() {
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function sortHandClient(hand) {
  const sorted = [...hand].sort(
    (a, b) =>
      Number(a.strength ?? a.rank) - Number(b.strength ?? b.rank) ||
      (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return state.ui.handSort === 'desc' ? sorted.reverse() : sorted;
}

function gameGlyph(gameId) {
  return {
    'big-two': '♠',
    'dou-dizhu': '♣',
    'pao-yao': '♥',
    'texas-holdem': '♦',
    'guangdong-mahjong': '中',
  }[gameId] || '♦';
}

function roomGameName(room) {
  return room?.game?.name || '牌桌';
}

function isBidding(room) {
  return room?.gamePublic?.phase === 'bidding' || room?.gamePublic?.status === 'bidding';
}

function isPaoYao(room) {
  return room?.gameType === 'pao-yao';
}

function isDouDizhu(room) {
  return room?.gameType === 'dou-dizhu';
}

function isTexasHoldem(room) {
  return room?.gameType === 'texas-holdem';
}

function isMahjong(room) {
  return room?.gameType === 'guangdong-mahjong';
}

function gamePlayerRange(game) {
  if (!game) return '';
  return game.minPlayers === game.maxPlayers
    ? `${game.maxPlayers} 人`
    : `${game.minPlayers}–${game.maxPlayers} 人`;
}

function teamLabel(team) {
  return team === 0 ? '红队' : team === 1 ? '蓝队' : '';
}

function statusLabel(status) {
  return { waiting: '等待中', playing: '进行中', finished: '已结束' }[status] || status;
}

function playerBySeat(room, seat) {
  return room?.players?.find((player) => player.seat === seat) || null;
}

async function refreshSelfProfile() {
  try {
    const data = await api('/api/auth/me');
    if (data.user) state.user = data.user;
    if (data.roomCode) state.homeRoomCode = data.roomCode;
  } catch {
    // A profile refresh is a nicety, not a reason to interrupt the table.
  }
}

function escapeAttr(value) {
  return esc(value).replace(/\n/g, ' ');
}

/* ---------- API ---------- */

async function api(path, options = {}) {
  const { method = 'GET', body, signal } = options;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const networkError = new Error('连接不到潇洒纸牌屋服务器，请检查网络后重试');
    networkError.code = 'NETWORK_ERROR';
    throw networkError;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message = payload?.error?.message || `请求失败（${response.status}）`;
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.code = payload?.error?.code || 'API_ERROR';
    if (response.status === 401 && state.token && !path.startsWith('/api/auth/login')) {
      handleSessionExpired('登录状态已失效，请重新登录');
    }
    throw requestError;
  }
  return payload;
}

function handleSessionExpired(message = '登录状态已失效') {
  if (!state.token) return;
  const route = state.route?.name;
  const pending =
    route === 'room' ? location.hash :
    route === 'lobby' ? '#/lobby' :
    null;
  clearSession();
  toast(message, 'error');
  const target = pending || (route === 'admin' ? '#/login/admin' : '#/login/game');
  state.pendingRoute = pending;
  navigate(target.slice(1), { replace: true });
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('xiaosa_token', token);
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.room = null;
  state.homeRoomCode = null;
  state.rooms = [];
  state.roomsLoaded = false;
  state.adminLoaded = false;
  state.adminOverview = null;
  state.adminUsers = [];
  state.ui.selected.clear();
  localStorage.removeItem('xiaosa_token');
  closeLobbySSE();
  closeRoomSSE();
}

/* ---------- toast, modal, confirm ---------- */

function toast(message, type = 'info', duration = 3600) {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const glyph = type === 'error' ? '!' : type === 'success' ? '✓' : '·';
  el.innerHTML = `<span class="toast-icon">${glyph}</span><span>${esc(message)}</span>`;
  toastRoot.appendChild(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

function openModal({ title, subtitle = '', body = '', wide = false, light = false, onMount = null }) {
  state.ui.modalOpen = true;
  state.ui.lastFocused = document.activeElement;
  document.body.classList.add('modal-open');
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <section class="modal-card ${wide ? 'wide' : ''} ${light ? 'modal-light' : ''}" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <div class="modal-head">
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="modal-close" type="button" data-modal-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
    </section>
  </div>`;
  const root = $('.modal-card', modalRoot);
  onMount?.(root);
  setTimeout(() => {
    const target = root.querySelector('[autofocus], input:not([type="hidden"]), select, textarea');
    target?.focus();
  }, 80);
}

function closeModal() {
  if (!state.ui.modalOpen) return;
  state.ui.modalOpen = false;
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  const previous = state.ui.lastFocused;
  state.ui.lastFocused = null;
  if (previous && previous.isConnected) previous.focus();
}

function setButtonBusy(button, busy, busyLabel = '处理中') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${esc(busyLabel)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function confirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  light = false,
  onConfirm,
}) {
  openModal({
    title,
    body: `<p class="confirm-message">${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-modal-close>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-gold'}" type="button" data-confirm>${esc(confirmText)}</button>
      </div>`,
    light,
    onMount(root) {
      const button = $('[data-confirm]', root);
      button.addEventListener('click', async () => {
        setButtonBusy(button, true, '请稍候');
        try {
          await onConfirm();
          closeModal();
        } catch (error) {
          setButtonBusy(button, false);
          toast(error.message || '操作失败', 'error');
        }
      });
    },
  });
}

function rulesModal(rules = RULES_FALLBACK, light = false, gameName = '锄大地') {
  openModal({
    title: `${gameName} · 规则`,
    subtitle: '潇洒纸牌屋现行桌规',
    wide: true,
    light,
    body: `<div class="rules-list">${(rules?.sections || RULES_FALLBACK.sections)
      .map(
        (section) => `<section class="rule-block">
          <h4>${esc(section.title)}</h4><p>${esc(section.body)}</p>
        </section>`,
      )
      .join('')}</div>
      <div class="modal-actions"><button class="btn btn-gold" type="button" data-modal-close>明白了</button></div>`,
  });
}

/* ---------- realtime ---------- */

function closeLobbySSE() {
  if (lobbyES) {
    lobbyES.close();
    lobbyES = null;
  }
  state.sseLobby = false;
}

function closeRoomSSE() {
  if (roomES) {
    roomES.close();
    roomES = null;
  }
  state.sseRoom = false;
}

function connectLobbySSE() {
  if (!state.token) return;
  closeLobbySSE();
  const source = new EventSource(`/api/events/lobby?token=${encodeURIComponent(state.token)}`);
  lobbyES = source;
  source.addEventListener('open', () => {
    state.sseLobby = true;
  });
  source.addEventListener('lobby', (event) => {
    state.sseLobby = true;
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data.rooms)) {
        state.rooms = data.rooms;
        state.roomsLoaded = true;
        if (Array.isArray(data.games) && data.games.length) state.games = data.games;
        updateLobbyRoomList();
      }
    } catch {
      // Ignore malformed events; the next snapshot will arrive.
    }
  });
  source.addEventListener('session-ended', (event) => {
    let message = '登录状态已失效';
    try {
      message = JSON.parse(event.data).message || message;
    } catch {
      // Use default.
    }
    source.close();
    lobbyES = null;
    handleSessionExpired(message);
  });
  source.addEventListener('error', () => {
    state.sseLobby = false;
    updateConnectionDots();
  });
}

function connectRoomSSE(code) {
  if (!state.token || !code) return;
  closeRoomSSE();
  const source = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events?token=${encodeURIComponent(state.token)}`);
  roomES = source;
  source.addEventListener('open', () => {
    state.sseRoom = true;
    updateConnectionDots();
  });
  source.addEventListener('room', (event) => {
    state.sseRoom = true;
    try {
      const data = JSON.parse(event.data);
      if (data.room && state.route.name === 'room' && data.room.code === state.route.code) {
        applyRoomState(data.room);
      }
    } catch {
      // Ignore.
    }
  });
  source.addEventListener('kicked', (event) => {
    let message = '你已被房主移出房间';
    try {
      message = JSON.parse(event.data).message || message;
    } catch {
      // Use default.
    }
    closeRoomSSE();
    state.room = null;
    state.homeRoomCode = null;
    toast(message, 'error');
    navigate('/lobby', { replace: true });
  });
  source.addEventListener('session-ended', (event) => {
    let message = '登录状态已失效';
    try {
      message = JSON.parse(event.data).message || message;
    } catch {
      // Use default.
    }
    source.close();
    roomES = null;
    handleSessionExpired(message);
  });
  source.addEventListener('error', () => {
    state.sseRoom = false;
    updateConnectionDots();
  });
}

function updateConnectionDots() {
  const roomDot = $('#room-connection');
  if (roomDot) {
    roomDot.classList.toggle('offline', !state.sseRoom);
    const text = roomDot.querySelector('span:last-child');
    if (text) text.textContent = state.sseRoom ? '实时连接' : '正在重连';
  }
}

/* ---------- simple sound ---------- */

let audioContext = null;

function ensureAudio() {
  if (!state.sound) return null;
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function tone(freq, duration = 0.08, type = 'sine', gain = 0.035, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const volume = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + delay;
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(volume);
  volume.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function soundForAction(action) {
  if (!state.sound || !action) return;
  if (action.type === 'play') {
    tone(520, 0.06, 'triangle', 0.03);
    tone(720, 0.05, 'triangle', 0.022, 0.04);
  } else if (action.type === 'pass') {
    tone(250, 0.09, 'sine', 0.018);
  } else if (action.type === 'bid' || action.type === 'bid-pass') {
    tone(action.type === 'bid' ? 560 : 260, 0.07, 'triangle', 0.018);
  } else if (action.type === 'landlord') {
    [392, 523, 659].forEach((freq, i) => tone(freq, 0.13, 'triangle', 0.022, i * 0.08));
  } else if (action.type === 'redeal') {
    tone(300, 0.07, 'sine', 0.015);
    tone(240, 0.08, 'sine', 0.012, 0.08);
  } else if (action.type === 'win') {
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, 0.22, 'triangle', 0.027, i * 0.11));
  }
}

function soundClick(kind = 'soft') {
  if (!state.sound) return;
  if (kind === 'soft') tone(480, 0.035, 'sine', 0.015);
  else if (kind === 'select') tone(620, 0.035, 'triangle', 0.012);
  else if (kind === 'error') tone(180, 0.15, 'sawtooth', 0.018);
}

function toggleSound() {
  state.sound = !state.sound;
  localStorage.setItem('xiaosa_sound', state.sound ? 'on' : 'off');
  if (state.sound) soundClick('soft');
  toast(state.sound ? '音效已开启' : '音效已关闭', 'info', 1500);
  syncSoundButtons();
}

function syncSoundButtons() {
  $$('[data-sound-icon]').forEach((el) => {
    el.innerHTML = icon(state.sound ? 'volume' : 'mute');
    const label = el.closest('[data-action="toggle-sound"]');
    if (label) label.setAttribute('aria-label', state.sound ? '关闭音效' : '开启音效');
  });
}

/* ---------- routing ---------- */

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  if (raw === '/' || raw === '') return { name: 'landing', code: null };
  if (raw === '/login/game') return { name: 'login', portal: 'game', code: null };
  if (raw === '/login/admin') return { name: 'login', portal: 'admin', code: null };
  if (raw === '/lobby') return { name: 'lobby', code: null };
  if (raw === '/admin') return { name: 'admin', code: null };
  const roomMatch = raw.match(/^\/room\/([A-Za-z0-9]+)/);
  if (roomMatch) return { name: 'room', code: roomMatch[1].toUpperCase() };
  return { name: 'notfound', code: null };
}

function navigate(path, options = {}) {
  const clean = path.startsWith('#') ? path.slice(1) : path;
  const target = `#${clean}`;
  if (options.replace) {
    history.replaceState(null, '', target);
  } else if (location.hash === target) {
    handleRoute();
    return;
  } else {
    location.hash = clean;
    return;
  }
  handleRoute();
}

async function handleRoute() {
  const nonce = ++routeNonce;
  const route = parseRoute();
  state.route = route;
  stopAdminTimer();
  if (route.name !== 'lobby') closeLobbySSE();
  if (route.name !== 'room') closeRoomSSE();
  closeModal();

  if (route.name === 'landing') {
    renderLanding();
    return;
  }

  if (route.name === 'notfound') {
    state.pendingRoute = null;
    navigate('/', { replace: true });
    return;
  }

  if (route.name === 'login') {
    state.loginPortal = route.portal;
    if (state.user && (route.portal === 'game' || state.user.role === 'admin')) {
      navigate(state.user.role === 'admin' ? '/admin' : '/lobby', { replace: true });
      return;
    }
    renderLogin(route.portal);
    return;
  }

  if (!state.user) {
    if (route.name === 'room') state.pendingRoute = `#/room/${route.code}`;
    if (route.name === 'lobby') state.pendingRoute = '#/lobby';
    if (route.name === 'admin') state.pendingRoute = '#/admin';
    const portal = route.name === 'admin' ? 'admin' : 'game';
    navigate(`/login/${portal}`, { replace: true });
    return;
  }

  if (route.name === 'admin') {
    if (state.user.role !== 'admin') {
      renderAdminDenied();
      return;
    }
    renderAdminShell();
    if (!state.adminLoaded) await loadAdminData();
    else renderAdminContent();
    startAdminTimer();
    return;
  }

  if (route.name === 'lobby') {
    renderLobby();
    connectLobbySSE();
    if (!state.roomsLoaded) {
      await loadLobbyData();
    }
    if (nonce !== routeNonce) return;
    return;
  }

  if (route.name === 'room') {
    if (state.room?.code === route.code) {
      renderRoom();
      connectRoomSSE(route.code);
    } else {
      await enterRoom(route.code);
    }
  }
}

function goBack() {
  if (history.length > 1) history.back();
  else navigate('/');
}

function stopAdminTimer() {
  if (adminTimer) {
    clearInterval(adminTimer);
    adminTimer = null;
  }
}

/* ---------- landing ---------- */

const DEMO_CARDS = [
  { id: 'demo-s14', label: 'A', suitSymbol: '♠', red: false },
  { id: 'demo-h13', label: 'K', suitSymbol: '♥', red: true },
  { id: 'demo-d12', label: 'Q', suitSymbol: '♦', red: true },
  { id: 'demo-c11', label: 'J', suitSymbol: '♣', red: false },
  { id: 'demo-s15', label: '2', suitSymbol: '♠', red: false },
];

function renderLanding() {
  document.title = '潇洒纸牌屋 · 五款经典纸牌';
  state.loginError = '';
  const loggedIn = Boolean(state.user);
  const portalGameHref = loggedIn ? '#/lobby' : '#/login/game';
  const portalAdminHref = loggedIn && state.user.role === 'admin' ? '#/admin' : '#/login/admin';
  const navAction = loggedIn
    ? `<a class="btn btn-soft btn-sm" href="${state.user.role === 'admin' ? '#/admin' : '#/lobby'}">
        ${icon('arrowRight')} <span>继续进入</span>
      </a>`
    : `<a class="btn btn-soft btn-sm" href="#/login/game">${icon('play')} <span>玩家登录</span></a>`;

  app.innerHTML = `<div class="landing">
    <nav class="landing-nav">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
        <span class="brand-text"><strong>潇洒纸牌屋</strong><small>XIAOSA CLUB</small></span>
      </a>
      <div class="landing-nav-right">
        <a class="nav-link" href="#/login/admin">管理后台</a>
        <button class="nav-link" type="button" data-action="open-rules">玩法规则</button>
        ${navAction}
      </div>
    </nav>

    <section class="hero">
      <div class="hero-copy slide-up">
        <div class="eyebrow hero-kicker">GAME ROOM · HONG KONG / GUANGDONG</div>
        <h1>一桌好牌，<br /><em>等紧你埋位。</em></h1>
        <p class="hero-desc">
          锄大地、斗地主、东北刨幺、德州扑克、广东麻将，一屋五味。开一间房，叫齐朋友，或者补几位电脑玩家——
          二至四人，实时开局。牌要够大，心要够定。
        </p>
        <div class="hero-actions">
          <a class="btn btn-gold btn-lg" href="${portalGameHref}">
            ${icon('play')} 进入游戏大厅
          </a>
          <a class="btn btn-soft btn-lg" href="${portalAdminHref}">
            ${icon('shield')} 管理后台
          </a>
        </div>
        <div class="hero-meta">
          <div><strong>2–4 人</strong><span>ROOM SIZE</span></div>
          <div><strong>5 款</strong><span>GAME TYPES</span></div>
          <div><strong>实时</strong><span>LIVE TABLE</span></div>
        </div>
      </div>

      <div class="hero-art slide-up" style="animation-delay:.12s">
        <div class="table-aura"></div>
        <div class="table-preview">
          <div class="fan">
            ${DEMO_CARDS.map((card, index) => cardHTML(card, { index })).join('')}
          </div>
        </div>
        <div class="floating-chip one"><span class="chip-icon">♣</span> 2–4 人实时牌桌</div>
        <div class="floating-chip two"><span class="chip-icon">♦</span> 方块 3 先手</div>
        <div class="floating-chip three"><span class="chip-icon">♠</span> 五款经典 · 实时开局</div>
      </div>
    </section>

    <section class="portal-section">
      <div class="portal-head">
        <div>
          <div class="eyebrow" style="color:var(--gold)">TWO WAYS IN</div>
          <h2 style="margin-top:7px">选择你的入口</h2>
        </div>
        <p>玩家打牌 · 管理员管家</p>
      </div>
      <div class="portal-grid">
        <a class="portal-card" href="${portalGameHref}">
          <span class="portal-icon">${icon('cards')}</span>
          <span class="portal-info">
            <h3>玩家入口</h3>
            <p>锄大地、斗地主、刨幺，开房埋位实时对局</p>
          </span>
          <span class="portal-arrow">${icon('arrowUpRight')}</span>
        </a>
        <a class="portal-card admin" href="${portalAdminHref}">
          <span class="portal-icon">${icon('shield')}</span>
          <span class="portal-info">
            <h3>管理入口</h3>
            <p>创建会员、管理账号、查看牌桌与战绩</p>
          </span>
          <span class="portal-arrow">${icon('arrowUpRight')}</span>
        </a>
      </div>
    </section>

    <footer class="landing-footer">
      <span class="footer-mark"><span>♠</span> XIAOSA CLUB · 2026</span>
      <span>一桌好牌，胜负在牌，亦在人心。</span>
    </footer>
  </div>`;
  syncSoundButtons();
}

/* ---------- login ---------- */

function renderLogin(portal = 'game') {
  document.title = `${portal === 'admin' ? '管理后台' : '玩家入口'} · 潇洒纸牌屋`;
  state.loginPortal = portal;
  state.loginError = '';
  const isAdmin = portal === 'admin';
  const story = isAdmin
    ? {
        kicker: 'ADMIN CONSOLE',
        title: '把纸牌屋，<br /><em>交给数据。</em>',
        desc: '创建会员、管理账号状态、查看实时牌桌与对局记录。所有操作都留在这间纸牌屋里。',
        quote: '「牌局有输赢，管理要有数。」',
      }
    : {
        kicker: 'PLAYER LOUNGE',
        title: '埋位，<br /><em>打好呢副牌。</em>',
        desc: '用管理员为你开通的账号登录，创建房间、邀请朋友，或者与电脑玩家即场开一局：锄大地、斗地主、东北刨幺、德州扑克、广东麻将。',
        quote: '「先出完手牌的人，才有资格讲下一局。」',
      };

  app.innerHTML = `<div class="auth-shell">
    <section class="auth-story">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
        <span class="brand-text"><strong>潇洒纸牌屋</strong><small>XIAOSA CLUB</small></span>
      </a>
      <div class="auth-story-copy slide-up">
        <div class="eyebrow">${story.kicker}</div>
        <h1 style="margin-top:20px">${story.title}</h1>
        <p>${story.desc}</p>
      </div>
      <div class="auth-quote">${story.quote}</div>
      <div class="auth-side-cards">
        ${DEMO_CARDS.slice(1, 4).map((card, index) => cardHTML(card, { index })).join('')}
      </div>
    </section>

    <section class="auth-form-side">
      <div class="auth-panel slide-up">
        <div class="auth-portal-tag ${isAdmin ? 'admin' : ''}">
          ${isAdmin ? icon('shield') : icon('cards')}
          ${isAdmin ? 'ADMIN PORTAL' : 'PLAYER PORTAL'}
        </div>
        <h2>${isAdmin ? '管理员登录' : '返嚟开局'}</h2>
        <p class="auth-sub">${isAdmin ? '使用管理员账号进入纸牌屋后台' : '使用纸牌屋会员账号登录游戏大厅'}</p>

        <form class="auth-form" data-form="login" data-portal="${portal}" novalidate>
          <div class="field">
            <label for="login-username">账号</label>
            <input id="login-username" name="username" autocomplete="username" placeholder="${isAdmin ? '管理员账号' : '输入你的账号'}" maxlength="24" required />
          </div>
          <div class="field">
            <label for="login-password">密码</label>
            <div class="input-wrap">
              <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="输入密码" maxlength="72" required />
              <button class="input-action" type="button" data-action="toggle-password" aria-label="显示密码">${icon('eye')}</button>
            </div>
          </div>
          <div class="auth-error" hidden></div>
          <button class="btn auth-submit" type="submit">${isAdmin ? '进入管理后台' : '进入游戏大厅'} ${icon('arrowRight')}</button>
        </form>

        <div class="auth-note">
          ${
            isAdmin
              ? `首次使用默认管理员：<code>admin</code> / <code>admin123</code>。登录后请尽快在账号设置中修改密码。`
              : `玩家账号由纸牌屋管理员创建。若尚未开通，请联系管理员。`
          }
        </div>

        <div class="auth-switch">
          <span>${isAdmin ? '想打牌？' : '是管理员？'}</span>
          <a href="${isAdmin ? '#/login/game' : '#/login/admin'}">${isAdmin ? '前往玩家入口' : '前往管理后台'}</a>
        </div>
        <a class="back-home" href="#/">${icon('arrowLeft')} 返回纸牌屋首页</a>
      </div>
    </section>
  </div>`;
}

function showAuthError(message) {
  const box = $('.auth-error');
  if (!box) {
    toast(message, 'error');
    return;
  }
  box.hidden = false;
  box.textContent = message;
  box.classList.remove('flash-error');
  void box.offsetWidth;
  box.classList.add('flash-error');
}

async function handleLoginSubmit(form) {
  const portal = form.dataset.portal || 'game';
  const button = $('button[type="submit"]', form);
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  if (!username || !password) {
    showAuthError('请输入账号和密码');
    return;
  }
  const errorBox = $('.auth-error', form);
  if (errorBox) errorBox.hidden = true;
  setButtonBusy(button, true, '验证中');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { username, password, portal },
    });
    saveSession(data.token, data.user);
    state.homeRoomCode = data.roomCode || null;
    soundClick('soft');
    toast(`欢迎回来，${data.user.displayName}`, 'success', 2200);
    let target = portal === 'admin' ? '/admin' : '/lobby';
    if (state.pendingRoute) {
      const pending = state.pendingRoute.startsWith('#')
        ? state.pendingRoute.slice(1)
        : state.pendingRoute;
      if (pending.startsWith('/room/') || pending === '/lobby') {
        target = pending;
      } else if (pending === '/admin' && data.user.role === 'admin') {
        target = '/admin';
      }
    }
    state.pendingRoute = null;
    navigate(target, { replace: true });
  } catch (error) {
    setButtonBusy(button, false);
    showAuthError(error.message || '登录失败');
    soundClick('error');
  }
}

/* ---------- game header ---------- */

function gameHeader() {
  const user = state.user;
  if (!user) return '';
  const adminLink =
    user.role === 'admin'
      ? `<a class="btn btn-ghost btn-sm" href="#/admin">${icon('shield')} <span class="btn-label">管理后台</span></a>`
      : '';
  return `<header class="game-header">
    <div class="game-header-inner">
      <a class="brand" href="#/lobby">
        <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
        <span class="brand-text"><strong>潇洒纸牌屋</strong><small>XIAOSA CLUB</small></span>
      </a>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-action="open-rules">
          ${icon('info')} <span class="btn-label">玩法</span>
        </button>
        ${adminLink}
        <button class="btn btn-ghost btn-sm sound-toggle" type="button" data-action="toggle-sound" aria-label="${state.sound ? '关闭音效' : '开启音效'}">
          <span data-sound-icon>${icon(state.sound ? 'volume' : 'mute')}</span>
        </button>
        <span class="header-divider"></span>
        <div class="user-chip">
          ${avatarHTML(user, { size: 'avatar-sm' })}
          <span class="user-chip-info">
            <strong>${esc(user.displayName)}</strong>
            <small>${user.role === 'admin' ? 'ADMIN' : 'MEMBER'}</small>
          </span>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm" type="button" data-action="logout" aria-label="退出登录">
          ${icon('logout')}
        </button>
      </div>
    </div>
  </header>`;
}

/* ---------- lobby ---------- */

function renderLobby() {
  document.title = '游戏大厅 · 潇洒纸牌屋';
  const user = state.user;
  if (!user) return;
  const games = state.games.length ? state.games : defaultGames();
  app.innerHTML = `<div class="lobby-page">
    ${gameHeader()}
    <main class="lobby-wrap">
      <section class="lobby-intro slide-up">
        <div>
          <div class="eyebrow">PLAYER LOBBY · ${esc(todayLabel())}</div>
          <h1>${greeting()}，<em>${esc(user.displayName)}</em></h1>
          <p>揾张台，埋位开局。所有牌桌即时同步，等你落场。</p>
        </div>
        <div class="lobby-intro-actions">
          <button class="btn btn-gold" type="button" data-action="create-room">${icon('plus')} 创建牌桌</button>
          <button class="btn btn-soft" type="button" data-action="refresh-lobby" aria-label="刷新房间">${icon('refresh')} <span class="btn-label">刷新</span></button>
        </div>
      </section>

      ${
        state.homeRoomCode
          ? `<div class="resume-banner">
              <span class="resume-icon">${icon('cards')}</span>
              <div><strong>你仍有一间牌桌未离开</strong><p>房间 ${esc(state.homeRoomCode)} · 点此返回继续</p></div>
              <a class="btn btn-sm btn-gold" href="#/room/${esc(state.homeRoomCode)}">返回牌局 ${icon('arrowRight')}</a>
            </div>`
          : ''
      }

      <div class="lobby-grid">
        <section class="panel slide-up" style="animation-delay:.05s">
          <div class="panel-head">
            <div>
              <h2>开放牌桌</h2>
              <p><span id="open-room-count">${state.rooms.length}</span> 间房正在等紧玩家</p>
            </div>
            <div class="panel-head-actions">
              <span class="pill pill-green"><span class="dot"></span> LIVE</span>
              <button class="icon-btn" type="button" data-action="refresh-lobby" aria-label="刷新房间">${icon('refresh')}</button>
            </div>
          </div>
          <div id="room-list-container">${roomListHTML()}</div>
        </section>

        <aside class="side-stack slide-up" style="animation-delay:.1s">
          <section class="profile-card">
            <div class="profile-top">
              ${avatarHTML(user, { size: 'avatar-lg', ring: true })}
              <div>
                <h3>${esc(user.displayName)}</h3>
                <p>@${esc(user.username)} · ${user.role === 'admin' ? '纸牌屋管理员' : '纸牌屋会员'}</p>
              </div>
            </div>
            <div class="profile-stats">
              <div class="profile-stat"><strong>${user.gamesPlayed ?? 0}</strong><span>对局</span></div>
              <div class="profile-stat"><strong>${user.gamesWon ?? 0}</strong><span>胜局</span></div>
              <div class="profile-stat"><strong>${user.winRate ?? 0}%</strong><span>胜率</span></div>
            </div>
          </section>

          <section class="panel quick-card">
            <h3>输入房间码</h3>
            <p>朋友开好房？输入 5 位房间码直接埋位。</p>
            <form class="join-form" data-form="quick-join">
              <input name="code" placeholder="例如 A7K2M" maxlength="5" autocomplete="off" spellcheck="false" aria-label="房间码" />
              <button class="btn" type="submit">加入</button>
            </form>
          </section>

          <section class="panel game-library">
            <div class="game-library-head"><h3>纸牌屋游戏</h3><span>${games.filter((g) => g.enabled).length} 款开放</span></div>
            ${games
              .map(
                (game) => `<div class="game-mini">
                  <span class="game-mini-icon">${gameGlyph(game.id)}</span>
                  <div class="game-mini-info">
                    <strong>${esc(game.name)}</strong>
                    <span>${esc(game.tagline)}</span>
                  </div>
                  <span class="game-mini-status ${game.enabled ? '' : 'soon'}">${game.enabled ? '开放中' : '敬请期待'}</span>
                </div>`,
              )
              .join('')}
          </section>
        </aside>
      </div>
    </main>
  </div>`;
  syncSoundButtons();
}

function defaultGames() {
  return [
    { id: 'big-two', name: '锄大地', tagline: '广东 / 香港经典扑克', enabled: true, minPlayers: 2, maxPlayers: 4 },
    { id: 'dou-dizhu', name: '斗地主', tagline: '三人叫地主攻防', enabled: true, minPlayers: 3, maxPlayers: 3 },
    { id: 'pao-yao', name: '东北刨幺', tagline: '四人两副牌 · 对家协作', enabled: true, minPlayers: 4, maxPlayers: 4 },
    { id: 'texas-holdem', name: '德州扑克', tagline: '盲注、全下与摊牌', enabled: true, minPlayers: 2, maxPlayers: 4 },
    { id: 'guangdong-mahjong', name: '广东麻将', tagline: '四人 136 张 · 鸡平胡', enabled: true, minPlayers: 4, maxPlayers: 4 },
  ];
}

function roomListHTML() {
  if (!state.roomsLoaded) {
    return `<div class="lobby-loading">
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
    </div>`;
  }
  if (!state.rooms.length) {
    return `<div class="empty-state">
      <div class="empty-art">${cardBack()}${cardHTML(DEMO_CARDS[0])}</div>
      <h3>暂时未有人开台</h3>
      <p>做第一个开局的人。创建牌桌，邀请朋友，或者补入电脑玩家即刻开波。</p>
      <button class="btn btn-gold btn-sm" type="button" data-action="create-room">${icon('plus')} 创建第一间牌桌</button>
    </div>`;
  }
  return `<div class="room-list">${state.rooms
    .map((room) => {
      const full = room.playerCount >= room.maxPlayers;
      const hosting = room.hostId === state.user?.id;
      const isMine = room.players.some((player) => !player.isBot && player.id === state.user?.id);
      const canJoin = room.status === 'waiting' && !full;
      const actionLabel = isMine ? '返回牌桌' : hosting ? '主持中' : room.status === 'playing' ? '牌局中' : full ? '已满员' : '入座';
      return `<article class="room-card ${room.status === 'playing' ? 'is-playing' : ''}">
        <div class="room-code-block">
          <strong>${esc(room.code)}</strong>
          <small>${esc(room.gameName || '牌桌')}</small>
        </div>
        <div class="room-info">
          <div class="room-title-line">
            <h3>${esc(room.name)}</h3>
            ${room.retained ? '<span class="pill pill-gold">保留中</span>' : room.status === 'playing' ? '<span class="pill pill-red">进行中</span>' : '<span class="pill pill-green"><span class="dot"></span>等待中</span>'}
            ${hosting ? '<span class="pill pill-gold">我的牌桌</span>' : ''}
          </div>
          <div class="room-subline">
            <span>${icon('crown')} ${esc(room.hostName)}</span>
            <span>${icon('users')} ${room.playerCount}/${room.maxPlayers} 人</span>
            <span class="mini-avatars">
              ${room.players
                .slice(0, 4)
                .map((player) => avatarHTML({ displayName: player.name, isBot: player.isBot }, { size: '' }))
                .join('')}
              ${room.playerCount > 4 ? `<span class="more">+${room.playerCount - 4}</span>` : ''}
            </span>
          </div>
        </div>
        <div class="room-action">
          <span class="seat-count">${room.status === 'waiting' ? `${room.maxPlayers - room.playerCount} SEAT${room.maxPlayers - room.playerCount === 1 ? '' : 'S'} LEFT` : 'IN PLAY'}</span>
          <button class="btn ${canJoin || isMine ? 'btn-gold' : 'btn-soft'} btn-sm" type="button"
            data-action="${canJoin || isMine ? 'join-room' : 'noop'}"
            data-code="${esc(room.code)}"
            ${!canJoin && !isMine ? 'disabled' : ''}>
            ${actionLabel}
          </button>
        </div>
      </article>`;
    })
    .join('')}</div>`;
}

function updateLobbyRoomList() {
  if (state.route.name !== 'lobby') return;
  const container = $('#room-list-container');
  if (container) container.innerHTML = roomListHTML();
  const count = $('#open-room-count');
  if (count) count.textContent = String(state.rooms.filter((room) => room.status === 'waiting').length);
}

async function loadLobbyData() {
  try {
    const data = await api('/api/rooms');
    state.rooms = data.rooms || [];
    state.games = data.games || state.games;
    state.roomsLoaded = true;
    if (state.route.name === 'lobby') {
      updateLobbyRoomList();
      const count = $('#open-room-count');
      if (count) count.textContent = String(state.rooms.filter((room) => room.status === 'waiting').length);
    }
  } catch (error) {
    state.roomsLoaded = true;
    toast(error.message, 'error');
    updateLobbyRoomList();
  }
}

function openCreateRoomModal() {
  const games = (state.games.length ? state.games : defaultGames()).filter((game) => game.enabled);
  const initialGame = games.find((game) => game.id === 'big-two') || games[0];
  openModal({
    title: '创建牌桌',
    subtitle: '选择玩法与人数，等朋友埋位，或者先补电脑玩家练手',
    body: `<form data-form="create-room" novalidate>
      <div class="field">
        <label for="room-name">牌桌名称</label>
        <input id="room-name" name="name" maxlength="24" placeholder="例如：周末夜战" autocomplete="off" />
        <span class="field-hint">留空将使用「你的昵称的牌局」</span>
      </div>
      <div class="field" style="margin-top:16px">
        <label>游戏类型</label>
        <div class="game-options modal-game-options">
          ${games
            .map(
              (game) => `<button class="game-option ${game.id === initialGame.id ? 'is-active' : ''}" type="button" data-create-game="${esc(game.id)}">
                <span class="game-option-icon">${gameGlyph(game.id)}</span>
                <span class="game-option-info"><strong>${esc(game.name)}</strong><span>${esc(game.tagline)}</span></span>
                <span class="game-state">${gamePlayerRange(game)}</span>
              </button>`,
            )
            .join('')}
        </div>
        <input type="hidden" name="gameType" value="${esc(initialGame.id)}" />
      </div>
      <div class="field" style="margin-top:16px">
        <label>房间人数</label>
        <div class="capacity-options" data-capacity-group>
          ${[2, 3, 4]
            .map(
              (count) => `<button class="capacity-option ${count === initialGame.maxPlayers ? 'is-active' : ''}" type="button" data-capacity="${count}">
                <strong>${count}</strong><span>${count === 2 ? '双人对战' : count === 3 ? '三人成局' : '四人满桌'}</span>
              </button>`,
            )
            .join('')}
        </div>
        <input type="hidden" name="maxPlayers" value="${initialGame.maxPlayers}" />
        <span class="field-hint" data-capacity-hint>「${esc(initialGame.name)}」支持 ${gamePlayerRange(initialGame)}</span>
      </div>
      <div class="modal-error" hidden></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-modal-close>取消</button>
        <button class="btn btn-gold" type="submit">${icon('plus')} 创建并进入</button>
      </div>
    </form>`,
    onMount(root) {
      const gameInput = root.querySelector('input[name="gameType"]');
      const capacityInput = root.querySelector('input[name="maxPlayers"]');
      const hint = root.querySelector('[data-capacity-hint]');
      const capacityButtons = $$('.capacity-option', root);

      function chooseCapacity(count) {
        const button = capacityButtons.find((item) => Number(item.dataset.capacity) === count);
        if (!button || button.disabled) return;
        capacityButtons.forEach((item) => item.classList.toggle('is-active', item === button));
        capacityInput.value = String(count);
      }

      function chooseGame(gameId) {
        const game = games.find((item) => item.id === gameId);
        if (!game) return;
        gameInput.value = game.id;
        $$('.game-option[data-create-game]', root).forEach((button) => {
          button.classList.toggle('is-active', button.dataset.createGame === game.id);
        });
        capacityButtons.forEach((button) => {
          const count = Number(button.dataset.capacity);
          button.disabled = count < game.minPlayers || count > game.maxPlayers;
        });
        chooseCapacity(
          Number(capacityInput.value) >= game.minPlayers &&
            Number(capacityInput.value) <= game.maxPlayers
            ? Number(capacityInput.value)
            : game.maxPlayers,
        );
        hint.textContent = `「${game.name}」支持 ${gamePlayerRange(game)}`;
        soundClick('soft');
      }

      $$('.game-option[data-create-game]', root).forEach((button) => {
        button.addEventListener('click', () => chooseGame(button.dataset.createGame));
      });
      capacityButtons.forEach((button) => {
        button.addEventListener('click', () => {
          if (button.disabled) return;
          chooseCapacity(Number(button.dataset.capacity));
          soundClick('soft');
        });
      });
      chooseGame(initialGame.id);
    },
  });
}

async function handleCreateRoom(form) {
  const button = $('button[type="submit"]', form);
  const errorBox = $('.modal-error', form);
  if (errorBox) errorBox.hidden = true;
  setButtonBusy(button, true, '开台中');
  try {
    const data = await api('/api/rooms', {
      method: 'POST',
      body: {
        name: form.elements.name.value.trim(),
        maxPlayers: Number(form.elements.maxPlayers.value),
        gameType: form.elements.gameType.value,
      },
    });
    closeModal();
    state.homeRoomCode = data.room.code;
    toast('牌桌已开好，等紧你埋位', 'success');
    navigate(`/room/${data.room.code}`);
  } catch (error) {
    setButtonBusy(button, false);
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    } else {
      toast(error.message, 'error');
    }
  }
}

async function joinRoomByCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    toast('请输入 5 位房间码', 'error');
    return;
  }
  try {
    const data = await api('/api/rooms/join', { method: 'POST', body: { code } });
    state.homeRoomCode = data.room.code;
    navigate(`/room/${data.room.code}`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------- room entry ---------- */

async function enterRoom(code) {
  document.title = '进入牌桌 · 潇洒纸牌屋';
  closeRoomSSE();
  state.ui.selected.clear();
  state.ui.chatDraft = '';
  app.innerHTML = `<div class="room-loading">
    ${cardBack('room-loading-card one')}
    ${cardBack('room-loading-card two')}
    <p>正在揾你张台...</p>
  </div>`;
  try {
    let data;
    try {
      data = await api(`/api/rooms/${encodeURIComponent(code)}`);
    } catch (error) {
      if (error.status === 403) {
        data = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST' });
      } else {
        throw error;
      }
    }
    if (state.route.name !== 'room' || state.route.code !== code) return;
    state.room = data.room;
    state.homeRoomCode = data.room.code;
    connectRoomSSE(code);
    renderRoom();
  } catch (error) {
    if (!state.user) return;
    toast(error.message || '无法进入房间', 'error');
    navigate('/lobby', { replace: true });
  }
}

function triggerDealAnimation() {
  state.ui.dealAnimate = true;
  setTimeout(() => {
    state.ui.dealAnimate = false;
    $('.hand-dock')?.classList.remove('deal-animate');
  }, 1100);
}

function applyRoomState(room) {
  if (!room) return;
  const previous = state.room;
  const sameRoom = previous?.code === room.code;
  const previousAction = previous?.gamePublic?.lastAction;
  const nextAction = room.gamePublic?.lastAction;
  const previousRound = previous?.roundNumber;
  const gameStarted =
    room.status === 'playing' &&
    (!sameRoom ||
      previous.status === 'waiting' ||
      previous.status === 'finished' ||
      previousRound !== room.roundNumber);

  state.room = room;
  state.route = { name: 'room', code: room.code };
  state.homeRoomCode = room.code;

  if (!sameRoom) {
    state.ui.selected.clear();
    state.ui.mjSelected = null;
    state.ui.texasRaise = '';
    state.ui.chatDraft = '';
  }
  const handIds = new Set((room.hand || []).map((card) => card.id));
  for (const id of [...state.ui.selected]) {
    if (!handIds.has(id)) state.ui.selected.delete(id);
  }
  if (state.ui.mjSelected && !handIds.has(state.ui.mjSelected)) state.ui.mjSelected = null;

  if (sameRoom && nextAction && previousAction?.at !== nextAction.at) {
    if (
      nextAction.type !== 'start' &&
      (nextAction.seat !== room.you?.seat || nextAction.type === 'pass')
    ) {
      state.ui.selected.clear();
    }
    soundForAction(nextAction);
  }
  if (gameStarted) {
    state.ui.selected.clear();
    state.ui.mjSelected = null;
    state.ui.texasRaise = '';
    triggerDealAnimation();
  }
  if (
    sameRoom &&
    nextAction?.at !== previousAction?.at &&
    (nextAction?.type === 'landlord' || nextAction?.type === 'redeal')
  ) {
    state.ui.selected.clear();
    triggerDealAnimation();
  }
  if (
    sameRoom &&
    previous.status !== 'finished' &&
    room.status === 'finished' &&
    nextAction?.type !== 'win'
  ) {
    if (state.sound) soundForAction({ type: 'win' });
  }
  if (sameRoom && previous.status !== 'finished' && room.status === 'finished') {
    refreshSelfProfile();
  }

  const bidding = isBidding(room);
  const actionSeat = bidding
    ? room.gamePublic?.biddingSeat
    : room.gamePublic?.claim?.currentSeat ?? room.gamePublic?.currentSeat;
  document.title =
    room.status === 'playing' && actionSeat === room.you?.seat
      ? bidding
        ? '轮到你叫地主 · 潇洒纸牌屋'
        : isTexasHoldem(room)
          ? '轮到你下注 · 潇洒纸牌屋'
          : isMahjong(room)
            ? '轮到你摸打 · 潇洒纸牌屋'
            : '轮到你出牌 · 潇洒纸牌屋'
      : `${room.name} · ${roomGameName(room)}`;
  if (state.route.name === 'room') renderRoom();
}

function renderRoom() {
  const room = state.room;
  if (!room) return;
  const previousChat = $('.chat-form input')?.value;
  if (previousChat !== undefined) state.ui.chatDraft = previousChat;
  const chatInputFocused = document.activeElement?.matches?.('.chat-form input');
  const chatLog = $('.chat-log');
  const chatWasAtBottom = chatLog
    ? chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 42
    : true;
  const previousScrollTop = chatLog?.scrollTop || 0;
  const handScroller = $('.hand-scroller');
  const previousHandScroll = handScroller?.scrollLeft || 0;
  const mahjongScroller = $('.mahjong-hand');
  const previousMahjongScroll = mahjongScroller?.scrollLeft || 0;

  const awaiting = room.status === 'playing' || room.status === 'finished';
  app.innerHTML = `<div class="room-page" data-game="${esc(room.gameType)}">
    ${roomHeader(room)}
    <main class="room-main">
      <section class="table-stage">
        <div class="stage-meta">
          <div class="stage-meta-left">
            <span class="pill pill-gold">${esc(roomGameName(room))}</span>
            <h2>${esc(room.name)}</h2>
            ${room.roundNumber > 0 ? `<span class="pill">第 ${room.roundNumber} 局</span>` : ''}
          </div>
          <div class="stage-meta-right">
            <span class="connection-state ${state.sseRoom ? '' : 'offline'}" id="room-connection">
              <span class="led"></span><span>${state.sseRoom ? '实时连接' : '正在重连'}</span>
            </span>
            <button class="btn btn-soft btn-sm" type="button" data-action="copy-invite">${icon('link')} <span class="btn-label">邀请</span></button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="open-rules">${icon('info')} <span class="btn-label">规则</span></button>
          </div>
        </div>
        ${
          room.status === 'waiting'
            ? `${waitingStage(room)}${waitingDock(room)}`
            : isTexasHoldem(room)
              ? `${texasStage(room)}${room.status === 'playing' ? texasHandDock(room) : ''}`
              : isMahjong(room)
                ? `${mahjongStage(room)}${room.status === 'playing' ? mahjongHandDock(room) : ''}`
                : `${playedStage(room)}${room.status === 'playing' ? handDock(room) : ''}`
        }
      </section>
      ${roomSidebar(room)}
    </main>
  </div>`;

  syncSoundButtons();
  if (awaiting) {
    requestAnimationFrame(() => {
      const nextScroller = $('.hand-scroller');
      if (nextScroller) nextScroller.scrollLeft = previousHandScroll;
      const nextMahjong = $('.mahjong-hand');
      if (nextMahjong) nextMahjong.scrollLeft = previousMahjongScroll;
    });
  }
  const nextChat = $('.chat-log');
  if (nextChat) {
    const shouldStick =
      chatWasAtBottom ||
      (state.room?.chat?.length &&
        state.room.chat[state.room.chat.length - 1]?.userId === state.user?.id);
    nextChat.scrollTop = shouldStick ? nextChat.scrollHeight : previousScrollTop;
    if (chatInputFocused) {
      const input = $('.chat-form input');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }
}

function roomHeader(room) {
  return `<header class="room-header">
    <div class="room-header-left">
      <button class="btn btn-ghost btn-icon btn-sm" type="button" data-action="exit-room" aria-label="返回大厅">${icon('arrowLeft')}</button>
      <a class="brand" href="#/lobby" data-action="exit-room">
        <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
        <span class="brand-text"><strong>潇洒纸牌屋</strong><small>XIAOSA CLUB</small></span>
      </a>
      <div class="room-identity">
        <span class="game-tag">${esc(room.game?.englishName || 'BIG TWO')}</span>
        <h1>${esc(room.name)}</h1>
      </div>
    </div>
    <div class="room-header-right">
      <button class="room-code-chip" type="button" data-action="copy-code" title="复制房间码">
        ROOM ${esc(room.code)} ${icon('copy')}
      </button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="toggle-sound" aria-label="${state.sound ? '关闭音效' : '开启音效'}">
        <span data-sound-icon>${icon(state.sound ? 'volume' : 'mute')}</span>
      </button>
      <button class="btn btn-soft btn-sm" type="button" data-action="exit-room">
        ${icon('door')} <span class="btn-label">离开</span>
      </button>
    </div>
  </header>`;
}

function waitingStage(room) {
  const slots = [];
  const gameMin = room.game?.minPlayers || 2;
  const gameMax = room.game?.maxPlayers || room.maxPlayers;
  for (let i = 0; i < room.maxPlayers; i += 1) {
    const player = room.players[i];
    if (player) {
      slots.push(`<div class="waiting-seat ${player.isYou ? 'is-you' : ''}">
        ${player.isHost ? '<span class="host-star">★</span>' : ''}
        <span class="ready-state">${
          player.ready
            ? '<span class="pill pill-green">已准备</span>'
            : '<span class="pill">未准备</span>'
        }</span>
        ${avatarHTML(player, { size: 'avatar' })}
        <h3>${esc(player.displayName)}${player.isYou ? ' · 你' : ''}</h3>
        <p>${player.isBot ? '电脑玩家' : player.managed ? '托管中' : player.isHost ? '房主' : '玩家'}${!player.connected && !player.isBot && !player.managed ? ' · 离线' : ''}</p>
        ${
          room.isHost && !player.isYou && !player.isBot
            ? `<button class="btn btn-ghost btn-sm" type="button" data-action="kick-player" data-player-id="${player.id}">移出</button>`
            : ''
        }
      </div>`);
    } else {
      slots.push(`<div class="waiting-seat is-empty">
        <span class="empty-plus">+</span>
        <h3>空位</h3>
        <p>等紧朋友埋位</p>
        ${room.isHost ? `<button class="btn btn-ghost btn-sm" type="button" data-action="add-bot">加电脑</button>` : ''}
      </div>`);
    }
  }

  return `<div class="waiting-stage fade-in">
    <div class="waiting-head">
      <div class="eyebrow">WAITING ROOM · ${esc(room.game?.englishName || 'TABLE')}</div>
      <h2>${room.players.length >= gameMin && room.players.every((player) => player.ready) ? '人齐，可以开波' : '等紧人齐开台'}</h2>
      <p>${esc(roomGameName(room))} · ${room.players.length}/${gameMax} 人已埋位 · 全部准备后由房主开局</p>
      <div class="waiting-code">
        <strong>${esc(room.code)}</strong>
        <button type="button" data-action="copy-code" aria-label="复制房间码">${icon('copy')}</button>
      </div>
    </div>
    <div class="waiting-seats">${slots.join('')}</div>
    <div class="waiting-controls">
      ${
        room.you.ready
          ? `<button class="ready-toggle is-ready" type="button" data-action="toggle-ready"><span class="check-dot">✓</span> 已准备</button>`
          : `<button class="ready-toggle" type="button" data-action="toggle-ready"><span class="check-dot">✓</span> 准备</button>`
      }
      ${
        room.isHost
          ? `<button class="btn btn-soft" type="button" data-action="add-bots" ${room.players.length >= room.maxPlayers ? 'disabled' : ''}>${icon('bot')} 补满电脑</button>
             <button class="btn btn-soft" type="button" data-action="remove-bot" ${!room.players.some((p) => p.isBot) ? 'disabled' : ''}>${icon('minus')} 移除电脑</button>
             <button class="btn btn-gold" type="button" data-action="start-game" ${room.canStart && room.players.every((p) => p.isBot || p.managed || p.connected) ? '' : 'disabled'}>
               ${icon('play')} 开始牌局
             </button>`
          : `<span class="waiting-hint">等房主开局 · 你可以先聊两句</span>`
      }
    </div>
    ${
      room.isHost && !room.canStart
        ? `<p class="waiting-hint">${room.players.length < gameMin ? `「${esc(roomGameName(room))}」至少需要 ${gameMin} 人才能开局` : !room.players.every((p) => p.ready) ? '等所有玩家准备后即可开局' : '有玩家离线，等待重连或移出'}</p>`
        : ''
    }
  </div>`;
}

function waitingDock(room) {
  return `<div class="hand-dock waiting-dock">
    <p>房间码 <span class="mono gold">${esc(room.code)}</span> · 复制邀请链接叫朋友入座</p>
    <div class="waiting-dock-actions">
      <button class="btn btn-soft btn-sm" type="button" data-action="copy-invite">${icon('link')} 复制邀请链接</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="open-rules">${icon('info')} 查看规则</button>
    </div>
  </div>`;
}

function opponentLayout(room) {
  const n = room.players.length;
  const you = room.you.seat;
  const ordered = room.players
    .filter((player) => player.seat !== you)
    .sort((a, b) => ((a.seat - you + n) % n) - ((b.seat - you + n) % n));
  const positions = n === 2 ? ['top'] : n === 3 ? ['left', 'right'] : ['left', 'top', 'right'];
  return ordered.map((player, index) => ({ player, position: positions[index] || 'top' }));
}

function playedStage(room) {
  const game = room.gamePublic;
  const bidding = isBidding(room);
  const layout = opponentLayout(room);
  const actingSeat = bidding ? game?.biddingSeat : game?.currentSeat;
  const currentPlayer = actingSeat != null ? playerBySeat(room, actingSeat) : null;
  const yourTurn = !bidding && room.status === 'playing' && game?.currentSeat === room.you.seat;
  const yourBid = bidding && game?.biddingSeat === room.you.seat;
  const lastPlay = game?.lastPlay;
  const lastSeatPlayer = lastPlay ? playerBySeat(room, lastPlay.seat) : null;
  const mustLead = !bidding && room.status === 'playing' && !lastPlay;
  const turnLabel =
    room.status === 'finished'
      ? '本局结束'
      : bidding
        ? yourBid
          ? '轮到你叫地主'
          : `${currentPlayer?.displayName || '玩家'} 正在叫地主...`
        : yourTurn
          ? mustLead
            ? isDouDizhu(room)
              ? '你先手 · 请出牌'
              : game?.turnCount === 0 && !isPaoYao(room)
                ? '你先手 · 必须带出方块 3'
                : '轮到你领出 · 你话事'
            : '轮到你出牌'
          : currentPlayer
            ? `${currentPlayer.displayName} 正在思考...`
            : '等待中';

  const emptyText =
    isDouDizhu(room)
      ? mustLead
        ? '地主先出牌'
        : '新的一轮，等待领出'
      : isPaoYao(room)
        ? mustLead
          ? `${currentPlayer?.displayName || '玩家'} 领出`
          : '新的一轮，等待领出'
        : game?.turnCount === 0
          ? '首轮由方块 3 开始'
          : mustLead
            ? '新的一轮，等待领出'
            : '牌桌已清空';

  const bottomBacks = bidding
    ? `<div class="bid-stage">
        <div class="eyebrow">CALL LANDLORD</div>
        <div class="bid-bottom-cards">${'<span class="bottom-back"></span>'.repeat(game?.bottomCount || 3)}</div>
        <p>${game?.highestBid ? `当前最高叫分 <strong>${game.highestBid}</strong> 分` : '尚未有人叫分'}</p>
      </div>`
    : '';

  const dense = (lastPlay?.combo?.cards?.length || 0) > 8;
  const pileChip =
    isPaoYao(room) && !bidding
      ? `<div class="trick-points ${game?.pilePoints ? 'has-points' : ''}">本墩 <strong>${game?.pilePoints || 0}</strong> 分</div>`
      : '';

  return `<div class="felt-table ${isPaoYao(room) ? 'felt-table--pao' : ''}">
    ${layout.map(({ player, position }) => seatHTML(room, player, position)).join('')}
    <div class="table-center">
      ${
        room.status === 'playing'
          ? `<div class="turn-banner ${yourTurn || yourBid ? 'you' : ''}"><span class="pulse"></span>${esc(turnLabel)}</div>`
          : ''
      }
      ${bidding ? bottomBacks : ''}
      ${
        !bidding && lastPlay
          ? `<div class="last-play">
              <div class="last-play-cards ${dense ? 'dense' : ''}">${lastPlay.combo.cards.map((card) => cardHTML(card, { small: true })).join('')}</div>
              <div class="last-play-label"><strong>${esc(lastPlay.combo.name)}</strong> · ${esc(lastSeatPlayer?.displayName || '玩家')} 打出</div>
            </div>`
          : !bidding
            ? `<div class="empty-play">
                <div class="ornament">♠ ♥ ♣ ♦</div>
                <span>${esc(emptyText)}</span>
              </div>`
            : ''
      }
      ${pileChip}
    </div>
    ${room.status === 'finished' && game?.result ? resultLayer(room, game.result) : ''}
  </div>`;
}

function seatHTML(room, player, position) {
  const game = room.gamePublic;
  const bidding = isBidding(room);
  const actingSeat = bidding ? game?.biddingSeat : game?.currentSeat;
  const isTurn = room.status === 'playing' && actingSeat === player.seat;
  const passed = game?.passSeats?.includes(player.seat);
  const count = player.cardCount ?? 0;
  const backCount = Math.min(3, Math.max(0, Math.ceil(count / 5)));
  const teamClass = isPaoYao(room) ? `seat--team-${player.team === 0 ? 'a' : 'b'}` : '';
  const roleClass =
    isDouDizhu(room) && player.role ? `seat--${player.role === '地主' ? 'landlord' : 'farmer'}` : '';
  const roleBadge =
    isDouDizhu(room) && player.role
      ? `<span class="seat-role role-${player.role === '地主' ? 'landlord' : 'farmer'}">${esc(player.role)}</span>`
      : isPaoYao(room)
        ? `<span class="seat-role role-team-${player.team === 0 ? 'a' : 'b'}">${esc(teamLabel(player.team))}</span>`
        : '';
  const bidValue = bidding && Array.isArray(game?.bids) ? game.bids[player.seat] : null;
  const bidLabel =
    bidding && bidValue !== null && bidValue !== undefined
      ? bidValue === 0
        ? '<span class="seat-bid">不叫</span>'
        : `<span class="seat-bid">${bidValue} 分</span>`
      : '';
  const finished = Boolean(player.finished && !bidding);
  return `<div class="seat seat--${position} ${isTurn ? 'is-turn' : ''} ${teamClass} ${roleClass} ${finished ? 'is-finished' : ''} ${player.managed ? 'is-managed' : ''}">
    <div class="seat-card">
      <div class="avatar-ring">${avatarHTML(player, { size: '' })}</div>
      <div class="seat-info">
        <div class="seat-name">${esc(player.displayName)}${player.isHost ? ' <span class="seat-you">房主</span>' : ''} ${player.managed ? '<span class="seat-role role-managed">托管</span>' : ''} ${roleBadge}</div>
        <div class="seat-sub">
          <span>${finished ? '<span class="seat-offline">已出完</span>' : player.isBot ? '电脑' : player.managed ? '电脑托管' : player.connected ? '在线' : '<span class="seat-offline">离线</span>'}</span>
          <span class="seat-count-inline">${count} 张</span>
          ${bidLabel}
          ${player.score ? `<span class="${player.score > 0 ? 'gold' : ''}">${player.score > 0 ? '+' : ''}${player.score}</span>` : ''}
        </div>
      </div>
      <div class="card-stack" title="${count} 张手牌">
        ${Array.from({ length: backCount }, () => '<span class="back-mini"></span>').join('')}
        <span class="card-count">${count}</span>
      </div>
    </div>
    ${passed ? '<span class="seat-pass">不要</span>' : ''}
    ${finished ? '<span class="seat-pass seat-pass--out">出完</span>' : ''}
  </div>`;
}

/* ---------- Texas Hold'em table ---------- */

const TEXAS_PHASES = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  finished: '牌局结束',
};

function texasActionLabel(room, action) {
  if (!action) return '';
  const player = playerBySeat(room, action.seat);
  const who = player?.displayName || '';
  if (action.type === 'fold') return `${who} 弃牌`;
  if (action.type === 'check') return `${who} 过牌`;
  if (action.type === 'call') return `${who} 跟注 ${action.amount ?? ''}`;
  if (action.type === 'raise') return `${who} 加注到 ${action.to ?? ''}`;
  if (action.type === 'street') return `进入${TEXAS_PHASES[action.street] || action.street}`;
  return '';
}

function texasStage(room) {
  const game = room.gamePublic;
  if (!game) return '';
  const layout = opponentLayout(room);
  const lastAction = game.actions?.slice(-1)[0];
  const actionCopy = texasActionLabel(room, lastAction);
  const turnPlayer = game.currentSeat != null ? playerBySeat(room, game.currentSeat) : null;
  const yourTurn = room.status === 'playing' && game.currentSeat === room.you.seat;
  const turnLabel =
    room.status === 'finished'
      ? '本局结束'
      : game.phase === 'showdown'
        ? '摊牌中...'
        : yourTurn
          ? '轮到你行动'
          : turnPlayer
            ? `${turnPlayer.displayName} 正在思考...`
            : '等待发牌';
  return `<div class="felt-table texas-table">
    ${layout.map(({ player, position }) => texasSeatHTML(room, player, position)).join('')}
    <div class="texas-center">
      <div class="texas-turn ${yourTurn ? 'you' : ''}"><span class="pulse"></span>${esc(turnLabel)}</div>
      <div class="texas-pot"><span>POT</span><strong>${game.pot ?? 0}</strong></div>
      <div class="texas-community">
        ${Array.from({ length: 5 }, (_, index) => {
          const card = game.communityCards?.[index];
          return card
            ? cardHTML(card, { small: true })
            : '<span class="community-slot" aria-hidden="true"></span>';
        }).join('')}
      </div>
      <div class="texas-meta">
        <span>${esc(TEXAS_PHASES[game.phase] || game.phase)}</span>
        <span>当前注 ${game.currentBet ?? 0}</span>
        <span>盲注 ${game.smallBlind}/${game.bigBlind}</span>
      </div>
      ${actionCopy ? `<div class="texas-last-action">${esc(actionCopy)}</div>` : ''}
    </div>
    ${room.status === 'finished' && game.result ? resultLayer(room, game.result) : ''}
  </div>`;
}

function texasSeatHTML(room, player, position) {
  const game = room.gamePublic;
  const state = player.publicState || game?.playerStates?.[player.seat] || {};
  const isTurn = room.status === 'playing' && game?.currentSeat === player.seat;
  const folded = Boolean(state.folded);
  const allIn = Boolean(state.allIn);
  const revealed = state.holeCards?.length > 0;
  const cards = revealed
    ? state.holeCards.map((card) => cardHTML(card, { tiny: true })).join('')
    : '<span class="mini-card-back"></span><span class="mini-card-back"></span>';
  return `<div class="seat seat--${position} texas-seat ${isTurn ? 'is-turn' : ''} ${folded ? 'is-folded' : ''} ${player.managed ? 'is-managed' : ''}">
    <div class="seat-card">
      <div class="avatar-ring">${avatarHTML(player, { size: '' })}</div>
      <div class="seat-info">
        <div class="seat-name">${esc(player.displayName)}${player.isHost ? ' <span class="seat-you">房主</span>' : ''} ${player.managed ? '<span class="seat-role role-managed">托管</span>' : ''}</div>
        <div class="seat-sub">
          <span>${esc(state.stack ?? 0)} 筹码</span>
          ${state.bet ? `<span class="texas-bet">下注 ${state.bet}</span>` : ''}
        </div>
      </div>
      ${state.dealer ? '<span class="dealer-button">D</span>' : ''}
      ${state.sb ? '<span class="blind-tag">SB</span>' : state.bb ? '<span class="blind-tag">BB</span>' : ''}
    </div>
    <div class="texas-hole ${folded ? 'is-folded' : ''}">${cards}</div>
    <div class="texas-seat-tags">
      ${folded ? '<span class="seat-pass">弃牌</span>' : ''}
      ${allIn ? '<span class="seat-allin">全下</span>' : ''}
      ${state.handName ? `<span class="texas-hand-name">${esc(state.handName)}</span>` : ''}
    </div>
  </div>`;
}

function texasHandDock(room) {
  const game = room.gamePublic;
  if (!game) return '';
  const actions = game.availableActions;
  const yourTurn = room.status === 'playing' && game.currentSeat === room.you.seat && actions;
  const ps = game.playerStates?.[room.you.seat] || {};
  const hand = room.hand || [];
  const busy = state.ui.actionBusy;
  const inputValue = state.ui.texasRaise || actions?.minRaiseTo || '';
  const statusText =
    room.status !== 'playing'
      ? '本局结束'
      : yourTurn
        ? '轮到你行动'
        : `等待 ${esc(playerBySeat(room, game.currentSeat)?.displayName || '其他玩家')}`;
  let actionHTML = `<div class="texas-wait-note">${statusText}</div>`;
  if (yourTurn) {
    const callLabel = actions.canCheck ? '过牌' : `跟注 ${actions.toCall}`;
    actionHTML = `<div class="texas-actions">
      <button class="btn btn-soft texas-fold" type="button" data-action="texas-action" data-type="fold" ${busy ? 'disabled' : ''}>弃牌</button>
      <button class="btn btn-play" type="button" data-action="texas-action" data-type="${actions.canCheck ? 'check' : 'call'}" ${busy ? 'disabled' : ''}>${callLabel}</button>
      ${
        actions.canRaise
          ? `<div class="texas-raise-box">
              <label>加注到</label>
              <input type="number" inputmode="numeric" data-raise-input min="${actions.minRaiseTo}" max="${actions.maxRaiseTo}" step="10" value="${escapeAttr(inputValue)}" />
              <button class="btn btn-gold" type="button" data-action="texas-raise" ${busy ? 'disabled' : ''}>加注</button>
            </div>
            <div class="texas-quick">
              <button type="button" data-action="texas-raise-quick" data-mode="half" ${busy ? 'disabled' : ''}>½ 池</button>
              <button type="button" data-action="texas-raise-quick" data-mode="pot" ${busy ? 'disabled' : ''}>池底</button>
              <button type="button" data-action="texas-raise-quick" data-mode="allin" ${busy ? 'disabled' : ''}>全下 ${actions.maxRaiseTo}</button>
            </div>`
          : ''
      }
    </div>`;
  }
  return `<div class="hand-dock texas-hand-dock ${state.ui.dealAnimate ? 'deal-animate' : ''}">
    <div class="hand-head">
      <div class="hand-player">
        ${avatarHTML(room.you, { size: '' })}
        <div class="hand-player-info">
          <strong>${esc(room.you.displayName)} <span class="pill pill-gold" style="min-height:18px;padding:0 6px;font-size:8px">你</span>${ps.dealer ? ' <span class="seat-you">庄家</span>' : ps.sb ? ' <span class="seat-you">小盲</span>' : ps.bb ? ' <span class="seat-you">大盲</span>' : ''}</strong>
          <span>筹码 ${ps.stack ?? 0} · 本轮下注 ${ps.bet ?? 0} · ${statusText}</span>
        </div>
      </div>
      <div class="hand-tools">
        <span class="muted">${esc(TEXAS_PHASES[game.phase] || game.phase)}</span>
        <span class="gold">底池 ${game.pot ?? 0}</span>
      </div>
    </div>
    <div class="texas-hand-area">
      <div class="texas-hole-large">${hand.map((card) => cardHTML(card, { small: false })).join('')}</div>
      ${actionHTML}
    </div>
  </div>`;
}

/* ---------- Guangdong Mahjong table ---------- */

function mahjongTileHTML(tile, { small = false, tiny = false, selected = false, last = false, clickable = false, back = false } = {}) {
  const classes = [
    'mj-tile',
    small ? 'mj-tile--small' : '',
    tiny ? 'mj-tile--tiny' : '',
    selected ? 'is-selected' : '',
    last ? 'is-last' : '',
    back ? 'mj-back' : '',
    tile?.honor ? 'mj-honor' : '',
    tile?.suit ? `mj-suit-${tile.suit}` : '',
    tile?.red ? 'mj-red' : '',
    tile?.color === 'green' ? 'mj-green' : '',
    tile?.color === 'blue' ? 'mj-blue' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (back) return `<span class="${classes}" aria-hidden="true"></span>`;
  const content = tile?.short || tile?.label || '';
  if (clickable) {
    return `<button class="${classes}" type="button" data-action="mahjong-tile" data-tile-id="${escapeAttr(tile.id)}" aria-pressed="${selected}" title="${escapeAttr(tile.label || '')}">${esc(content)}</button>`;
  }
  return `<span class="${classes}" title="${escapeAttr(tile?.label || '')}">${esc(content)}</span>`;
}

function mahjongMeldHTML(meld, { tiny = false } = {}) {
  return `<span class="mj-meld">${(meld.tiles || []).map((tile) => mahjongTileHTML(tile, { tiny })).join('')}</span>`;
}

function mahjongStage(room) {
  const game = room.gamePublic;
  if (!game) return '';
  const layout = opponentLayout(room);
  const turnPlayer = game.currentSeat != null ? playerBySeat(room, game.currentSeat) : null;
  const claimPlayer = game.claim?.currentSeat != null ? playerBySeat(room, game.claim.currentSeat) : null;
  const yourTurn = room.status === 'playing' && game.phase === 'discard' && game.currentSeat === room.you.seat;
  const yourClaim = room.status === 'playing' && game.phase === 'claiming' && game.claim?.currentSeat === room.you.seat;
  const turnLabel =
    room.status === 'finished'
      ? '本局结束'
      : game.phase === 'claiming'
        ? yourClaim
          ? '轮到你鸣牌'
          : `${claimPlayer?.displayName || '玩家'} 正在考虑鸣牌...`
        : yourTurn
          ? '轮到你出牌'
          : turnPlayer
            ? `${turnPlayer.displayName} 正在思考...`
            : '等待下一位';
  const lastDiscard = game.lastDiscard;
  return `<div class="felt-table mahjong-table">
    ${layout.map(({ player, position }) => mahjongSeatHTML(room, player, position)).join('')}
    <div class="mahjong-center">
      <div class="mahjong-topline">
        <div class="mahjong-wall"><span>余牌</span><strong>${game.wallCount ?? 0}</strong></div>
        <div class="mahjong-turn ${yourTurn || yourClaim ? 'you' : ''}"><span class="pulse"></span>${esc(turnLabel)}</div>
        <div class="mahjong-round">${esc(game.dealerWind || '东')}风局</div>
      </div>
      <div class="mahjong-rivers">
        ${[0, 1, 2, 3]
          .map((seat) => {
            const player = playerBySeat(room, seat);
            const river = game.discards?.[seat] || [];
            const isLastSeat = lastDiscard?.seat === seat;
            return `<div class="mahjong-river ${seat === room.you.seat ? 'is-you' : ''}">
              <div class="mahjong-river-head"><span>${esc(player?.displayName || '')}</span><em>${esc(game.playerStates?.[seat]?.wind || '')}</em></div>
              <div class="mahjong-river-tiles">
                ${
                  river.length
                    ? river
                        .map((tile) => mahjongTileHTML(tile, { tiny: true, last: isLastSeat && tile.id === lastDiscard?.tile?.id }))
                        .join('')
                    : '<span class="mahjong-empty">—</span>'
                }
              </div>
            </div>`;
          })
          .join('')}
      </div>
      ${lastDiscard ? `<div class="mahjong-last"><span>最近打出</span>${mahjongTileHTML(lastDiscard.tile, { small: true, last: true })}<em>${esc(playerBySeat(room, lastDiscard.seat)?.displayName || '')}</em></div>` : ''}
    </div>
    ${room.status === 'finished' && game.result ? resultLayer(room, game.result) : ''}
  </div>`;
}

function mahjongSeatHTML(room, player, position) {
  const game = room.gamePublic;
  const ps = player.publicState || game?.playerStates?.[player.seat] || {};
  const isTurn = room.status === 'playing' && (ps.isTurn || ps.isClaiming);
  return `<div class="seat seat--${position} mahjong-seat ${isTurn ? 'is-turn' : ''} ${player.managed ? 'is-managed' : ''}">
    <div class="seat-card">
      <div class="avatar-ring">${avatarHTML(player, { size: '' })}</div>
      <div class="seat-info">
        <div class="seat-name">${esc(player.displayName)} ${ps.dealer ? '<span class="seat-you">庄</span>' : ''} <span class="mj-wind">${esc(ps.wind || '')}</span> ${player.managed ? '<span class="seat-role role-managed">托管</span>' : ''}</div>
        <div class="seat-sub">
          <span>${ps.handCount ?? 0} 张</span>
          <span>${(ps.melds || []).length} 副</span>
        </div>
      </div>
      ${isTurn ? '<span class="mahjong-thinking">…</span>' : ''}
    </div>
    <div class="mahjong-seat-melds">
      ${(ps.melds || []).map((meld) => mahjongMeldHTML(meld, { tiny: true })).join('')}
    </div>
  </div>`;
}

function mahjongHandDock(room) {
  const game = room.gamePublic;
  if (!game) return '';
  const hand = [...(room.hand || [])].sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
  const handIds = new Set(hand.map((tile) => tile.id));
  if (state.ui.mjSelected && !handIds.has(state.ui.mjSelected)) state.ui.mjSelected = null;
  const selected = state.ui.mjSelected;
  const isDiscardTurn = room.status === 'playing' && game.phase === 'discard' && game.currentSeat === room.you.seat;
  const isClaimTurn = room.status === 'playing' && game.phase === 'claiming' && game.claim?.currentSeat === room.you.seat;
  const options = isClaimTurn ? game.claim?.options : null;
  const yourState = game.playerStates?.[room.you.seat] || {};
  const busy = state.ui.actionBusy;
  const statusText = isClaimTurn
    ? '轮到你决定吃碰杠胡'
    : isDiscardTurn
      ? '轮到你出牌'
      : game.phase === 'claiming'
        ? `等待 ${esc(playerBySeat(room, game.claim?.currentSeat)?.displayName || '其他玩家')} 鸣牌`
        : `等待 ${esc(playerBySeat(room, game.currentSeat)?.displayName || '其他玩家')} 摸打`;
  let actionHTML = `<div class="mahjong-wait-note">${statusText}</div>`;
  if (isClaimTurn && options) {
    actionHTML = `<div class="mahjong-claim">
      <span class="mahjong-claim-tile">${mahjongTileHTML(game.claim.tile, { small: true, last: true })}</span>
      <div class="mahjong-claim-actions">
        ${options.hu ? `<button class="btn btn-gold" type="button" data-action="mahjong-claim" data-type="hu" ${busy ? 'disabled' : ''}>胡</button>` : ''}
        ${options.gang ? `<button class="btn btn-soft" type="button" data-action="mahjong-claim" data-type="gang" ${busy ? 'disabled' : ''}>杠</button>` : ''}
        ${options.peng ? `<button class="btn btn-soft" type="button" data-action="mahjong-claim" data-type="peng" ${busy ? 'disabled' : ''}>碰</button>` : ''}
        ${options.chi ? `<button class="btn btn-soft" type="button" data-action="mahjong-claim" data-type="chi" ${busy ? 'disabled' : ''}>吃</button>` : ''}
        <button class="btn btn-ghost" type="button" data-action="mahjong-claim" data-type="pass" ${busy ? 'disabled' : ''}>过</button>
      </div>
    </div>`;
  } else if (isDiscardTurn) {
    actionHTML = `<div class="mahjong-discard-actions">
      <button class="btn btn-play" type="button" data-action="mahjong-discard" ${!selected || busy ? 'disabled' : ''}>${icon('play')} 打出</button>
      ${game.canWin ? `<button class="btn btn-gold" type="button" data-action="mahjong-claim" data-type="hu" ${busy ? 'disabled' : ''}>自摸胡</button>` : ''}
    </div>`;
  }
  return `<div class="hand-dock mahjong-hand-dock ${state.ui.dealAnimate ? 'deal-animate' : ''}">
    <div class="hand-head">
      <div class="hand-player">
        ${avatarHTML(room.you, { size: '' })}
        <div class="hand-player-info">
          <strong>${esc(room.you.displayName)} <span class="pill pill-gold" style="min-height:18px;padding:0 6px;font-size:8px">你 · ${esc(yourState.wind || '')}家</span></strong>
          <span>${statusText}</span>
        </div>
      </div>
      <div class="hand-tools">
        <span class="muted">余牌 ${game.wallCount ?? 0}</span>
        <span class="muted">${hand.length} 张</span>
        ${hand.length > 12 ? '<span class="hand-swipe-hint">左右滑动</span>' : ''}
      </div>
    </div>
    ${(yourState.melds || []).length ? `<div class="mahjong-my-melds">${yourState.melds.map((meld) => mahjongMeldHTML(meld, { tiny: true })).join('')}</div>` : ''}
    <div class="mahjong-hand-area">
      <div class="mahjong-hand">
        ${hand.map((tile) => mahjongTileHTML(tile, { clickable: isDiscardTurn, selected: selected === tile.id, last: game.lastDraw?.id === tile.id })).join('')}
      </div>
      ${actionHTML}
    </div>
  </div>`;
}

function handDock(room) {
  const game = room.gamePublic;
  const bidding = isBidding(room);
  const yourBidTurn = bidding && game?.biddingSeat === room.you.seat;
  const yourTurn = !bidding && game?.currentSeat === room.you.seat;
  const mustLead = !game?.lastPlay;
  const hand = sortHandClient(room.hand || []);
  const selectedCount = state.ui.selected.size;
  const busy = state.ui.actionBusy;
  const disablePlay = bidding || !yourTurn || selectedCount === 0 || busy;
  const disablePass = bidding || !yourTurn || mustLead || busy;
  const disableHint = bidding || !yourTurn || busy;
  const waitingName = esc(playerBySeat(room, game?.biddingSeat)?.displayName || '其他玩家');
  const statusText = bidding
    ? yourBidTurn
      ? game?.bids?.some((value) => value !== null)
        ? '轮到你叫分'
        : '由你先叫地主'
      : `等待 ${waitingName} 叫地主`
    : yourTurn
      ? mustLead
        ? '你先手领出'
        : '轮到你出牌'
      : `等待 ${esc(playerBySeat(room, game?.currentSeat)?.displayName || '其他玩家')}`;

  const biddingRail = `<div class="action-rail bidding-rail">
    ${
      yourBidTurn
        ? `<div class="selected-count">最高 <strong>${game?.highestBid || 0}</strong> 分</div>
           <div class="bid-actions">
             <button class="btn btn-soft" type="button" data-action="bid" data-value="0">不叫</button>
             <button class="btn btn-soft" type="button" data-action="bid" data-value="1" ${(game?.highestBid || 0) >= 1 ? 'disabled' : ''}>1 分</button>
             <button class="btn btn-soft" type="button" data-action="bid" data-value="2" ${(game?.highestBid || 0) >= 2 ? 'disabled' : ''}>2 分</button>
             <button class="btn btn-play" type="button" data-action="bid" data-value="3" ${(game?.highestBid || 0) >= 3 ? 'disabled' : ''}>3 分</button>
           </div>`
        : `<div class="bid-wait">等紧其他玩家叫地主...</div>`
    }
  </div>`;

  const playRail = `<div class="action-rail">
    <div class="selected-count">已选 <strong>${selectedCount}</strong> 张</div>
    <button class="btn btn-play" type="button" data-action="play-cards" ${disablePlay ? 'disabled' : ''}>${icon('play')} 出牌</button>
    <div class="action-row">
      <button class="btn btn-soft" type="button" data-action="pass" ${disablePass ? 'disabled' : ''}>不要</button>
      <button class="btn btn-soft" type="button" data-action="hint" ${disableHint ? 'disabled' : ''}>${icon('bulb')} 提示</button>
    </div>
  </div>`;

  return `<div class="hand-dock ${state.ui.dealAnimate ? 'deal-animate' : ''}">
    <div class="hand-head">
      <div class="hand-player">
        ${avatarHTML(room.you, { size: '' })}
        <div class="hand-player-info">
          <strong>${esc(room.you.displayName)} <span class="pill pill-gold" style="min-height:18px;padding:0 6px;font-size:8px">你</span></strong>
          <span>${esc(statusText)}</span>
        </div>
      </div>
      <div class="hand-tools">
        <span class="muted hand-max">${hand.length} 张手牌</span>
        ${hand.length > 18 ? '<span class="hand-swipe-hint">左右滑动</span>' : ''}
        <button class="tool-btn" type="button" data-action="sort-hand" title="切换排序">${icon('sort')} <span>${state.ui.handSort === 'desc' ? '由大到小' : '由小到大'}</span></button>
      </div>
    </div>
    <div class="hand-area">
      <div class="hand-scroller">
        ${
          hand.length
            ? `<div class="hand-cards" style="--count:${Math.max(2, hand.length)}">${hand
                .map((card, index) =>
                  cardHTML(card, {
                    clickable: !bidding,
                    selected: state.ui.selected.has(card.id),
                    index,
                  }),
                )
                .join('')}</div>`
            : `<div class="hand-empty">${isPaoYao(room) ? '你已出完手牌，等队友接风' : '你已出完手牌'}</div>`
        }
      </div>
      ${bidding ? biddingRail : playRail}
    </div>
  </div>`;
}

function roomSidebar(room) {
  return `<aside class="room-sidebar">
    <section class="side-panel">
      <div class="side-panel-head">
        <h3>${icon('users')} 牌桌成员</h3>
        <span class="count">${room.players.length}/${room.maxPlayers}</span>
      </div>
      <div class="side-meta">
        <div><span>游戏</span><strong>${esc(roomGameName(room))}</strong></div>
        <div><span>房间码</span><strong>${esc(room.code)}</strong></div>
      </div>
      <div class="players-list">
        ${room.players
          .map((player) => {
            const roleTag =
              isDouDizhu(room) && player.role
                ? `<span class="mini-role role-${player.role === '地主' ? 'landlord' : 'farmer'}">${esc(player.role)}</span>`
                : isPaoYao(room)
                  ? `<span class="mini-role role-team-${player.team === 0 ? 'a' : 'b'}">${esc(teamLabel(player.team))}</span>`
                  : isMahjong(room)
                    ? `<span class="mini-role role-wind">${esc(player.publicState?.wind || '')}</span>`
                    : isTexasHoldem(room) && player.publicState?.folded
                      ? '<span class="mini-role role-fold">弃牌</span>'
                      : isTexasHoldem(room) && player.publicState?.allIn
                        ? '<span class="mini-role role-allin">全下</span>'
                        : '';
            const number = Number(player.score ?? 0);
            const playerMeta =
              room.status === 'waiting'
                ? ''
                : isTexasHoldem(room)
                  ? ` · ${player.publicState?.stack ?? 0} 筹码`
                  : isMahjong(room)
                    ? ` · ${player.publicState?.wind || ''}家 · ${player.publicState?.handCount ?? player.cardCount} 张`
                    : ` · ${player.finished ? '已出完' : `${player.cardCount} 张`}`;
            return `<div class="player-row">
              ${avatarHTML(player, { size: 'avatar-sm' })}
              <div class="player-row-info">
                <strong>${esc(player.displayName)} ${player.isHost ? '<span class="host-crown" title="房主">★</span>' : ''} ${player.isYou ? '<span class="gold" style="font-size:8px">你</span>' : ''} ${player.managed ? '<span class="mini-role role-managed">托管</span>' : ''} ${roleTag}</strong>
                <p>${player.isBot ? '电脑玩家' : player.managed ? '电脑托管' : player.connected ? '在线' : '离线'}${playerMeta}</p>
              </div>
              <div class="player-row-side">
                ${
                  room.status === 'waiting'
                    ? `${player.ready ? '<span class="player-ready">已准备</span>' : '<span class="player-waiting">未准备</span>'}${
                        number
                          ? `<span class="player-score ${number < 0 ? 'negative' : ''}">${number > 0 ? '+' : ''}${number}</span>`
                          : ''
                      }`
                    : `<span class="player-score ${number < 0 ? 'negative' : ''}">${number > 0 ? '+' : ''}${number}</span>`
                }
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </section>

    ${room.status !== 'waiting' ? gameDataPanel(room) : ''}
    ${room.status === 'waiting' ? gameSwitchPanel(room) : ''}

    <section class="side-panel chat-panel">
      <div class="side-panel-head">
        <h3>${icon('chat')} 牌桌倾偈</h3>
        <span class="count">${room.chat?.length || 0}</span>
      </div>
      <div class="chat-log">
        ${
          room.chat?.length
            ? room.chat
                .map((message) => {
                  if (message.system) {
                    return `<div class="chat-msg system"><span class="chat-text">${esc(message.text)}</span></div>`;
                  }
                  const mine = message.userId === state.user?.id;
                  return `<div class="chat-msg ${mine ? 'is-you' : ''}">
                    <span class="chat-author">${esc(message.name || '玩家')}</span>
                    <span class="chat-text">${esc(message.text)}</span>
                  </div>`;
                })
                .join('')
            : '<div class="chat-msg system"><span class="chat-text">牌桌已开，打个招呼吧</span></div>'
        }
      </div>
      <form class="chat-form" data-form="chat">
        <input name="message" maxlength="160" placeholder="讲两句..." autocomplete="off" aria-label="聊天消息" value="${escapeAttr(state.ui.chatDraft)}" />
        <button type="submit" aria-label="发送">${icon('send')}</button>
      </form>
    </section>
  </aside>`;
}

function gameDataPanel(room) {
  const game = room.gamePublic;
  if (!game) return '';
  if (isDouDizhu(room)) {
    const landlord = room.players.find((player) => player.role === '地主');
    const bottomCards = game.bottomCards?.filter((card) => !card.hidden) || [];
    return `<section class="side-panel game-data-panel">
      <div class="side-panel-head">
        <h3>${icon('crown')} 地主信息</h3>
        <span class="pill ${landlord ? 'pill-gold' : ''}">${landlord ? '已定地主' : '叫地主中'}</span>
      </div>
      <div class="game-data-body">
        <div class="data-line"><span>地主</span><strong>${landlord ? esc(landlord.displayName) : '待定'}</strong></div>
        <div class="data-line"><span>结算倍数</span><strong>${landlord ? `${game.stake || 1} 倍${game.bombCount ? ` · ${game.bombCount} 炸` : ''}` : '待定'}</strong></div>
        <div class="data-line"><span>底牌</span><div class="bottom-cards">${
          bottomCards.length
            ? bottomCards.map((card) => cardHTML(card, { tiny: true })).join('')
            : '<span class="muted">待揭晓</span>'
        }</div></div>
        ${
          isBidding(room)
            ? `<div class="bid-list">${room.players
                .map((player) => {
                  const bid = game.bids?.[player.seat];
                  return `<span class="bid-chip">${esc(player.displayName)}：${bid === null || bid === undefined ? '—' : bid === 0 ? '不叫' : `${bid} 分`}</span>`;
                })
                .join('')}</div>`
            : `<p class="data-note">每打出一枚炸弹或王炸，结算倍数翻倍。</p>`
        }
      </div>
    </section>`;
  }
  if (isPaoYao(room)) {
    const teamA = game.teamScores?.[0] || 0;
    const teamB = game.teamScores?.[1] || 0;
    const myTeam = room.you.seat % 2;
    return `<section class="side-panel game-data-panel">
      <div class="side-panel-head">
        <h3>${icon('trophy')} 阵营比分</h3>
        <span class="pill ${myTeam === 0 ? 'pill-gold' : ''}">你属${esc(teamLabel(myTeam))}</span>
      </div>
      <div class="game-data-body">
        <div class="team-score-row team-a ${myTeam === 0 ? 'is-mine' : ''}">
          <div class="team-score-head"><span>红队</span><strong>${teamA}<small>/ 140</small></strong></div>
          <div class="team-progress"><i style="width:${Math.min(100, (teamA / 140) * 100)}%"></i></div>
        </div>
        <div class="team-score-row team-b ${myTeam === 1 ? 'is-mine' : ''}">
          <div class="team-score-head"><span>蓝队</span><strong>${teamB}<small>/ 140</small></strong></div>
          <div class="team-progress"><i style="width:${Math.min(100, (teamB / 140) * 100)}%"></i></div>
        </div>
        <div class="data-line" style="margin-top:12px"><span>本墩待收</span><strong class="gold">${game.pilePoints || 0} 分</strong></div>
        <div class="data-line"><span>首出 / 扛旗</span><strong>${game.firstOutSeat != null ? `${esc(playerBySeat(room, game.firstOutSeat)?.displayName || '')}（${esc(teamLabel(game.firstOutSeat % 2))}）` : '未产生'}</strong></div>
        <p class="data-note">${game.finishedSeats?.length ? `${game.finishedSeats.length} 位玩家已出完 · ` : ''}140 分、扛旗 90 分或双飞获胜。</p>
      </div>
    </section>`;
  }
  if (isTexasHoldem(room)) {
    const ps = game.playerStates?.[room.you.seat] || {};
    const dealer = playerBySeat(room, game.dealerSeat);
    const recent = (game.actions || []).slice(-5).reverse();
    return `<section class="side-panel game-data-panel">
      <div class="side-panel-head">
        <h3>${icon('trophy')} 牌局信息</h3>
        <span class="pill pill-gold">${esc(TEXAS_PHASES[game.phase] || game.phase)}</span>
      </div>
      <div class="game-data-body">
        <div class="data-line"><span>底池</span><strong class="gold">${game.pot ?? 0}</strong></div>
        <div class="data-line"><span>当前注</span><strong>${game.currentBet ?? 0}</strong></div>
        <div class="data-line"><span>庄家</span><strong>${esc(dealer?.displayName || '—')}</strong></div>
        <div class="data-line"><span>你的筹码</span><strong>${ps.stack ?? 0}</strong></div>
        <div class="data-line"><span>盲注</span><strong>${game.smallBlind}/${game.bigBlind}</strong></div>
        ${
          recent.length
            ? `<div class="texas-history">${recent
                .map((action) => `<div>${esc(texasActionLabel(room, action))}</div>`)
                .join('')}</div>`
            : ''
        }
        <p class="data-note">单局结算 · 每 10 筹码折算 1 个房间积分。</p>
      </div>
    </section>`;
  }
  if (isMahjong(room)) {
    const ps = game.playerStates?.[room.you.seat] || {};
    const dealer = playerBySeat(room, game.dealerSeat);
    return `<section class="side-panel game-data-panel">
      <div class="side-panel-head">
        <h3>${icon('trophy')} 牌局信息</h3>
        <span class="pill pill-gold">${esc(game.status === 'finished' ? '已结束' : game.phase === 'claiming' ? '鸣牌中' : '进行中')}</span>
      </div>
      <div class="game-data-body">
        <div class="data-line"><span>余牌</span><strong class="gold">${game.wallCount ?? 0}</strong></div>
        <div class="data-line"><span>庄家</span><strong>${esc(dealer?.displayName || '—')}（东）</strong></div>
        <div class="data-line"><span>你的风位</span><strong>${esc(ps.wind || '—')}家</strong></div>
        <div class="data-line"><span>你的副露</span><strong>${(ps.melds || []).length} 副</strong></div>
        <div class="data-line"><span>最近打出</span><strong>${game.lastDiscard ? `${esc(playerBySeat(room, game.lastDiscard.seat)?.displayName || '')} · ${esc(game.lastDiscard.tile?.short || '')}` : '—'}</strong></div>
        <p class="data-note">胡牌 +3 分，其余三家各 -1 分；牌墙摸完流局。</p>
      </div>
    </section>`;
  }
  return '';
}

function gameSwitchPanel(room) {
  const games = state.games.length ? state.games : defaultGames();
  return `<section class="side-panel game-switch-panel">
    <h3>切换游戏</h3>
    <p>${room.isHost ? '房主可在开局前更换玩法，人数上限会自动适配' : '等房主选择下一款玩法'}</p>
    <div class="game-options">
      ${games
        .map((game) => {
          const tooMany = room.players.length > game.maxPlayers;
          const disabled = !room.isHost || !game.enabled || room.gameType === game.id || tooMany;
          const stateText = !game.enabled
            ? '待上线'
            : room.gameType === game.id
              ? '当前'
              : tooMany
                ? '人数不符'
                : gamePlayerRange(game);
          return `<button class="game-option ${room.gameType === game.id ? 'is-active' : ''}" type="button"
            data-action="switch-game" data-game="${esc(game.id)}"
            ${disabled ? 'disabled' : ''} title="${tooMany ? '当前人数超过该玩法上限' : ''}">
            <span class="game-option-icon">${gameGlyph(game.id)}</span>
            <span class="game-option-info"><strong>${esc(game.name)}</strong><span>${esc(game.tagline)}</span></span>
            <span class="game-state ${game.enabled ? '' : 'soon'}">${stateText}</span>
          </button>`;
        })
        .join('')}
    </div>
  </section>`;
}

function resultLayer(room, result) {
  const winnerSeats = result.winnerSeats?.length
    ? result.winnerSeats
    : [result.winnerSeat].filter((seat) => Number.isInteger(seat));
  const youWon = winnerSeats.includes(room.you.seat);
  const winnerNames = winnerSeats
    .map((seat) => playerBySeat(room, seat)?.displayName)
    .filter(Boolean)
    .join('、');
  const headline = result.headline || '本局结束';
  let title;
  if (!winnerSeats.length) {
    title = `<strong>${esc(headline)}</strong>`;
  } else if (youWon) {
    title = isPaoYao(room)
      ? `你所在的<strong>${esc(teamLabel(room.you.seat % 2))}</strong>赢咗`
      : '你赢咗啦，<strong>好牌</strong>';
  } else if (result.winnerTeam !== undefined && result.winnerTeam !== null) {
    title = `<strong>${esc(headline)}</strong>`;
  } else if (isDouDizhu(room)) {
    title = `<strong>${esc(headline)}</strong>`;
  } else {
    title = `<strong>${esc(winnerNames || headline)}</strong> 赢咗`;
  }
  const subtitle = [winnerNames, result.detail].filter(Boolean).join(' · ');
  return `<div class="result-layer">
    <div class="confetti">${Array.from({ length: 24 }, (_, i) => {
      const colors = ['#f0d49a', '#d7675d', '#8fce9f', '#f7f1e3', '#c9a15c'];
      return `<i style="left:${(i * 17 + 5) % 100}%;background:${colors[i % colors.length]};animation-delay:${(i % 8) * 0.22}s;animation-duration:${3.2 + (i % 5) * 0.35}s"></i>`;
    }).join('')}</div>
    <div class="result-card">
      <div class="result-trophy">♛</div>
      <div class="eyebrow">ROUND ${room.roundNumber} · ${esc(roomGameName(room))} RESULT</div>
      <h2>${title}</h2>
      <p class="result-sub">${esc(subtitle || '本局结算如下')}</p>
      ${
        result.showdown && result.showdownPlayers?.length
          ? `<div class="showdown-reveal">
              <div class="showdown-board">
                <span class="showdown-label">公共牌</span>
                <div class="showdown-cards">${(result.communityCards || [])
                  .map((card) => cardHTML(card, { tiny: true }))
                  .join('')}</div>
              </div>
              <div class="showdown-list">
                ${result.showdownPlayers
                  .map((entry) => {
                    const player = playerBySeat(room, entry.seat);
                    return `<div class="showdown-player">
                      <strong>${esc(player?.displayName || `座位 ${entry.seat + 1}`)}</strong>
                      <div class="showdown-cards">${entry.holeCards
                        .map((card) => cardHTML(card, { tiny: true }))
                        .join('')}</div>
                      <span class="showdown-hand">${esc(entry.handName || '—')}</span>
                      <div class="showdown-best"><span>最佳5张</span>${(entry.bestFive || [])
                        .map((card) => cardHTML(card, { tiny: true }))
                        .join('')}</div>
                    </div>`;
                  })
                  .join('')}
              </div>
            </div>`
          : ''
      }
      <div class="result-list">
        ${result.entries
          .map(
            (entry) => `<div class="result-row ${entry.won ? 'is-winner' : ''}">
              <span class="result-place">${entry.place}</span>
              <div class="result-name">
                <strong>${esc(entry.playerName || '玩家')}${entry.seat === room.you.seat ? ' · 你' : ''}${entry.role ? ` <span class="result-role">${esc(entry.role)}</span>` : ''}</strong>
                <span>${
                  entry.net !== undefined
                    ? `${entry.label || `${entry.net} 筹码`} · ${entry.handName || (entry.folded ? '已弃牌' : '收池')}`
                    : `剩 ${entry.cardsLeft} 张 · 本局 ${entry.points > 0 ? '+' : ''}${entry.points}`
                }</span>
              </div>
              <span class="result-points ${entry.points >= 0 ? 'plus' : 'minus'}">${entry.points > 0 ? '+' : ''}${entry.points}</span>
              <span class="result-total">累计 ${entry.totalScore > 0 ? '+' : ''}${entry.totalScore}</span>
            </div>`,
          )
          .join('')}
      </div>
      <div class="result-actions">
        ${
          room.isHost
            ? `<button class="btn btn-gold" type="button" data-action="restart-game">${icon('refresh')} 再来一局</button>`
            : `<div class="result-note">等房主开下一局，或者返回大厅</div>`
        }
        <button class="btn btn-soft" type="button" data-action="exit-room">返回大厅</button>
      </div>
    </div>
  </div>`;
}

function updateSelectionUI() {
  const room = state.room;
  if (!room || room.status !== 'playing') return;
  const yourTurn = room.gamePublic?.currentSeat === room.you?.seat && !isBidding(room);
  const mustLead = !room.gamePublic?.lastPlay;
  $$('.hand-cards .playing-card').forEach((element) => {
    const selected = state.ui.selected.has(element.dataset.cardId);
    element.classList.toggle('selected', selected);
    element.classList.toggle('hand-card', selected);
    element.setAttribute('aria-pressed', String(selected));
  });
  const count = $('.selected-count strong');
  if (count) count.textContent = String(state.ui.selected.size);
  const playButton = $('[data-action="play-cards"]');
  if (playButton) playButton.disabled = !yourTurn || state.ui.selected.size === 0 || state.ui.actionBusy;
  const passButton = $('[data-action="pass"]');
  if (passButton) passButton.disabled = !yourTurn || mustLead || state.ui.actionBusy;
  const hintButton = $('[data-action="hint"]');
  if (hintButton) hintButton.disabled = !yourTurn || state.ui.actionBusy;
}

async function performRoomAction(path, options = {}, successMessage = '') {
  if (state.ui.actionBusy) return null;
  state.ui.actionBusy = true;
  try {
    const data = await api(path, options);
    state.ui.actionBusy = false;
    if (data?.room) {
      applyRoomState(data.room);
    }
    if (successMessage) toast(successMessage, 'success', 1900);
    return data;
  } catch (error) {
    state.ui.actionBusy = false;
    toast(error.message || '操作失败', 'error');
    soundClick('error');
    return null;
  }
}

async function playSelected() {
  const room = state.room;
  if (!room || room.status !== 'playing' || isBidding(room)) return;
  if (!state.ui.selected.size) {
    toast('请先选择要出的牌', 'error');
    return;
  }
  const ids = [...state.ui.selected];
  const data = await performRoomAction(
    `/api/rooms/${room.code}/play`,
    { method: 'POST', body: { cardIds: ids } },
  );
  if (data) state.ui.selected.clear();
}

async function passTurn() {
  const room = state.room;
  if (!room || isBidding(room)) return;
  await performRoomAction(`/api/rooms/${room.code}/pass`, { method: 'POST' });
}

async function placeBid(value) {
  const room = state.room;
  if (!room || !isBidding(room)) return;
  await performRoomAction(`/api/rooms/${room.code}/bid`, {
    method: 'POST',
    body: { value: Number(value) },
  });
}

async function gameAction(type, payload = {}) {
  const room = state.room;
  if (!room || room.status !== 'playing') return null;
  const data = await performRoomAction(`/api/rooms/${room.code}/action`, {
    method: 'POST',
    body: { type, payload },
  });
  if (data) {
    state.ui.selected.clear();
    state.ui.mjSelected = null;
    state.ui.texasRaise = '';
  }
  return data;
}

async function texasAction(type) {
  await gameAction(type);
}

function clampRaise(amount) {
  const actions = state.room?.gamePublic?.availableActions;
  if (!actions) return 0;
  return Math.max(actions.minRaiseTo, Math.min(actions.maxRaiseTo, Math.round(Number(amount) || 0)));
}

async function texasRaiseWithAmount(amount) {
  const value = clampRaise(amount);
  if (!value) return;
  await gameAction('raise', { amount: value });
}

async function texasRaiseFromInput() {
  const input = $('[data-raise-input]');
  await texasRaiseWithAmount(input?.value ?? state.ui.texasRaise);
}

async function texasRaiseQuick(mode) {
  const game = state.room?.gamePublic;
  const actions = game?.availableActions;
  if (!actions) return;
  const pot = game.pot || 0;
  let amount = actions.minRaiseTo;
  if (mode === 'half') amount = game.currentBet + Math.round(pot * 0.5);
  else if (mode === 'pot') amount = game.currentBet + pot;
  else if (mode === 'allin') amount = actions.maxRaiseTo;
  await texasRaiseWithAmount(amount);
}

async function mahjongSelectTile(tileId) {
  const game = state.room?.gamePublic;
  if (!game || game.phase !== 'discard' || game.currentSeat !== state.room.you.seat) return;
  state.ui.mjSelected = state.ui.mjSelected === tileId ? null : tileId;
  renderRoom();
}

async function mahjongDiscard() {
  if (!state.ui.mjSelected) {
    toast('请先选择要打出的牌', 'error');
    return;
  }
  await gameAction('discard', { tileId: state.ui.mjSelected });
}

async function mahjongClaim(type) {
  await gameAction(type);
}

async function showHint() {
  const room = state.room;
  if (!room || room.status !== 'playing' || isBidding(room)) return;
  try {
    const data = await api(`/api/rooms/${room.code}/hint`, { method: 'POST' });
    if (!data.cardIds || !data.cardIds.length) {
      toast(room.gamePublic?.lastPlay ? '手上没有大过这手牌的牌，考虑不要' : '没有可出的牌', 'info');
      return;
    }
    state.ui.selected = new Set(data.cardIds);
    updateSelectionUI();
    requestAnimationFrame(() => {
      $('.hand-cards .selected')?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    });
    soundClick('select');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function restartGame() {
  const room = state.room;
  if (!room) return;
  await performRoomAction(`/api/rooms/${room.code}/restart`, { method: 'POST' });
}

async function toggleReady() {
  const room = state.room;
  if (!room) return;
  await performRoomAction(`/api/rooms/${room.code}/ready`, {
    method: 'POST',
    body: { ready: !room.you.ready },
  });
}

async function startGame() {
  const room = state.room;
  if (!room) return;
  await performRoomAction(`/api/rooms/${room.code}/start`, { method: 'POST' });
}

async function addBots() {
  const room = state.room;
  if (!room) return;
  const count = room.maxPlayers - room.players.length;
  if (count <= 0) return;
  await performRoomAction(`/api/rooms/${room.code}/bots`, {
    method: 'POST',
    body: { count },
  });
}

async function removeBot() {
  const room = state.room;
  if (!room) return;
  await performRoomAction(`/api/rooms/${room.code}/bots`, { method: 'DELETE' });
}

async function switchGame(gameType) {
  const room = state.room;
  if (!room?.['isHost']) return;
  await performRoomAction(`/api/rooms/${room.code}/game`, {
    method: 'POST',
    body: { gameType },
  });
}

async function kickPlayer(userId) {
  const room = state.room;
  if (!room) return;
  confirmDialog({
    title: '移出玩家',
    message: '确定将该玩家移出房间？对方会回到游戏大厅。',
    confirmText: '移出',
    danger: true,
    onConfirm: async () => {
      await performRoomAction(`/api/rooms/${room.code}/players/${userId}`, { method: 'DELETE' });
    },
  });
}

async function sendChat(form) {
  const room = state.room;
  if (!room) return;
  const input = form.elements.message;
  const text = input.value.trim();
  if (!text) return;
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    const data = await api(`/api/rooms/${room.code}/chat`, {
      method: 'POST',
      body: { text },
    });
    state.ui.chatDraft = '';
    input.value = '';
    chatAutoScroll = true;
    if (data.room) applyRoomState(data.room);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    input.focus();
  }
}

async function exitRoom() {
  const room = state.room;
  const performExit = async () => {
    try {
      if (room) await api(`/api/rooms/${room.code}/leave`, { method: 'POST' });
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    closeRoomSSE();
    state.room = null;
    state.homeRoomCode = null;
    state.ui.selected.clear();
    state.ui.mjSelected = null;
    state.ui.texasRaise = '';
    state.ui.chatDraft = '';
    navigate('/lobby');
  };

  if (room?.status === 'playing') {
    confirmDialog({
      title: '离开牌桌',
      message:
        '离开后你的座位会由电脑托管，其他玩家可以继续牌局；你可以随时回到这个房间接管。若你是房主，房主会自动转给下一位在线玩家。确定离开？',
      confirmText: '离开并托管',
      onConfirm: performExit,
    });
    return;
  }
  await performExit();
}

async function copyText(text, successMessage = '已复制') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(successMessage, 'success', 1800);
  } catch {
    toast('复制失败，请手动选择复制', 'error');
  }
}

function copyRoomCode() {
  if (!state.room) return;
  copyText(state.room.code, '房间码已复制');
}

function copyInvite() {
  if (!state.room) return;
  const link = `${location.origin}/#/room/${state.room.code}`;
  copyText(link, '邀请链接已复制，发给朋友即可埋位');
}

/* ---------- admin ---------- */

function renderAdminDenied() {
  document.title = '需要管理员权限 · 潇洒纸牌屋';
  app.innerHTML = `<div class="admin-surface">
    <div class="admin-denied">
      <div class="brand" style="margin-bottom:22px">
        <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
        <span class="brand-text"><strong style="color:var(--ink)">潇洒纸牌屋</strong><small>ADMIN CONSOLE</small></span>
      </div>
      <div class="eyebrow" style="justify-content:center;color:var(--gold-deep)">ACCESS RESTRICTED</div>
      <h2>这里需要管理员权限</h2>
      <p>当前账号「${esc(state.user?.displayName || '')}」是玩家账号，无法进入管理后台。</p>
      <div class="hero-actions" style="justify-content:center">
        <a class="btn btn-gold" href="#/login/admin">${icon('shield')} 用管理员账号登录</a>
        <a class="btn btn-soft" href="#/lobby">${icon('arrowLeft')} 返回游戏大厅</a>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="logout">退出当前账号</button>
    </div>
  </div>`;
}

function adminTabMeta(tab) {
  return {
    overview: {
      kicker: 'ADMIN CONSOLE · OVERVIEW',
      title: '纸牌屋总览',
      subtitle: '实时掌握成员、牌桌与对局记录',
    },
    users: {
      kicker: 'ADMIN CONSOLE · MEMBERS',
      title: '用户管理',
      subtitle: '创建会员账号、调整权限与账号状态',
    },
    rooms: {
      kicker: 'ADMIN CONSOLE · TABLES',
      title: '牌桌监控',
      subtitle: '查看当前开放与进行中的牌桌',
    },
  }[tab] || {};
}

function renderAdminShell() {
  if (!state.user || state.user.role !== 'admin') return;
  if (state.route.name !== 'admin') return;
  const meta = adminTabMeta(state.adminTab);
  document.title = `${meta.title} · 潇洒纸牌屋管理后台`;
  const tabs = [
    { id: 'overview', label: '总览', icon: 'chart' },
    { id: 'users', label: '用户管理', icon: 'users' },
    { id: 'rooms', label: '牌桌监控', icon: 'table' },
  ];
  app.innerHTML = `<div class="admin-surface">
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <a class="brand" href="#/admin">
          <span class="brand-mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
          <span class="brand-text"><strong>潇洒纸牌屋</strong><small>ADMIN CONSOLE</small></span>
        </a>
        <nav class="admin-nav" aria-label="后台导航">
          <div class="admin-nav-label">会员管理</div>
          ${tabs
            .map(
              (tab) => `<button type="button" class="${state.adminTab === tab.id ? 'active' : ''}" data-action="admin-tab" data-tab="${tab.id}">
                ${icon(tab.icon)} ${tab.label}
              </button>`,
            )
            .join('')}
          <div class="admin-nav-label">快捷入口</div>
          <a href="#/lobby">${icon('play')} 游戏大厅</a>
          <a href="#/" target="_self">${icon('door')} 纸牌屋首页</a>
        </nav>
        <div class="admin-sidebar-footer">
          <div class="admin-user">
            ${avatarHTML(state.user, { size: 'avatar-sm' })}
            <div class="admin-user-info">
              <strong>${esc(state.user.displayName)}</strong>
              <span>@${esc(state.user.username)} · 管理员</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-action="logout">${icon('logout')} 退出登录</button>
        </div>
      </aside>

      <main class="admin-main">
        <header class="admin-topbar">
          <div>
            <div class="eyebrow">${meta.kicker}</div>
            <h1>${meta.title}</h1>
            <p>${meta.subtitle}</p>
          </div>
          <div class="admin-topbar-actions">
            <button class="btn btn-soft btn-sm" type="button" data-action="admin-refresh">${icon('refresh')} 刷新数据</button>
            <a class="btn btn-soft btn-sm" href="#/lobby">${icon('play')} 前往游戏大厅</a>
            <button class="btn btn-soft btn-sm" type="button" data-action="logout" aria-label="退出登录">${icon('logout')} 退出</button>
          </div>
        </header>
        <div id="admin-content">${state.adminLoading ? '<div class="admin-loading"><span class="spinner"></span>正在载入纸牌屋数据...</div>' : adminContentHTML()}</div>
      </main>
    </div>
  </div>`;
  bindAdminSearch();
}

function adminContentHTML() {
  if (!state.adminOverview && state.adminTab === 'overview') {
    return '<div class="admin-loading"><span class="spinner"></span>正在载入纸牌屋数据...</div>';
  }
  if (state.adminTab === 'users') return adminUsersHTML();
  if (state.adminTab === 'rooms') return adminRoomsHTML();
  return adminOverviewHTML();
}

function adminOverviewHTML() {
  const data = state.adminOverview;
  if (!data) return '';
  const stats = data.stats || {};
  return `<div class="admin-stats">
    <div class="stat-card">
      <div class="stat-label">${icon('users')} 注册用户</div>
      <div class="stat-value">${stats.users ?? 0}</div>
      <div class="stat-foot">${stats.active ?? 0} 个启用 · ${stats.admins ?? 0} 位管理员</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${icon('wifi')} 在线玩家</div>
      <div class="stat-value">${stats.online ?? 0}</div>
      <div class="stat-foot">当前连接游戏端的会员</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${icon('table')} 进行中牌桌</div>
      <div class="stat-value">${stats.playingRooms ?? 0}</div>
      <div class="stat-foot">${stats.waitingRooms ?? 0} 间房等待玩家入座</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${icon('trophy')} 累计对局</div>
      <div class="stat-value">${stats.games ?? 0}</div>
      <div class="stat-foot">今日新增 ${stats.gamesToday ?? 0} 局</div>
    </div>
  </div>

  <div class="admin-grid">
    <section class="admin-panel">
      <div class="admin-panel-head">
        <div><h2>最近对局</h2><p>按结束时间倒序，保留最近完成记录</p></div>
        <span class="count-badge">${(data.recentMatches || []).length}</span>
      </div>
      ${
        data.recentMatches?.length
          ? `<div class="recent-list">${data.recentMatches
              .map(
                (match) => `<div class="recent-row">
                  <span class="recent-icon">♠</span>
                  <div class="recent-info">
                    <strong>${esc(match.roomName)}</strong>
                    <span>${esc(match.winnerName || '—')} 获胜 · ${match.playerCount} 人 · ${esc(match.roomCode)}</span>
                  </div>
                  <span class="recent-time">${timeAgo(match.createdAt)}</span>
                </div>`,
              )
              .join('')}</div>`
          : '<div class="admin-empty">还没有完成的对局。开一张牌桌，等第一局战绩。</div>'
      }
    </section>

    <section class="admin-panel">
      <div class="admin-panel-head">
        <div><h2>线上牌桌</h2><p>实时房间状态</p></div>
        <span class="count-badge">${(data.rooms || []).length}</span>
      </div>
      ${
        data.rooms?.length
          ? `${data.rooms
              .slice(0, 6)
              .map(
                (room) => `<div class="live-room">
                  <span class="live-room-code">${esc(room.code)}</span>
                  <div class="live-room-info">
                    <strong>${esc(room.name)}</strong>
                    <span>${esc(room.gameName)} · ${room.playerCount}/${room.maxPlayers} 人 · ${statusLabel(room.status)}</span>
                  </div>
                  <span class="pill ${room.status === 'playing' ? 'pill-red' : 'pill-green'}">${statusLabel(room.status)}</span>
                </div>`,
              )
              .join('')}`
          : '<div class="admin-empty">目前没有开放中的牌桌。</div>'
      }
    </section>
  </div>`;
}

function adminUsersHTML() {
  return `<section class="admin-panel">
    <div class="admin-toolbar">
      <form class="search-box" data-form="admin-search">
        ${icon('search')}
        <input type="search" name="search" placeholder="搜索昵称或账号..." value="${escapeAttr(state.adminSearch)}" data-admin-search autocomplete="off" />
      </form>
      <div class="admin-toolbar-actions">
        <span class="pill">共 <strong id="admin-user-count">${state.adminUsers.length}</strong> 位</span>
        <button class="btn btn-gold btn-sm" type="button" data-action="admin-add-user">${icon('userPlus')} 创建用户</button>
      </div>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>用户</th><th>角色</th><th>状态</th><th>对局 / 胜率</th><th>最近登录</th><th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody id="admin-user-rows">${adminUserRowsHTML()}</tbody>
      </table>
    </div>
  </section>`;
}

function adminUserRowsHTML() {
  if (!state.adminUsers.length) {
    return `<tr><td colspan="6"><div class="admin-empty">${state.adminSearch ? '找不到匹配的用户' : '还没有用户，先创建第一位会员'}</div></td></tr>`;
  }
  return state.adminUsers
    .map((user) => {
      const self = user.id === state.user?.id;
      return `<tr>
        <td>
          <div class="table-user">
            ${avatarHTML(user, { size: 'avatar-sm' })}
            <div><strong>${esc(user.displayName)}${self ? ' · 你' : ''}</strong><span>@${esc(user.username)}</span></div>
          </div>
        </td>
        <td><span class="pill ${user.role === 'admin' ? 'pill-gold' : ''}">${user.role === 'admin' ? '管理员' : '玩家'}</span></td>
        <td>
          <span class="status-pill ${user.status === 'disabled' ? 'offline' : ''}">
            <span class="led" style="background:${user.status === 'disabled' ? 'rgba(16,33,27,.25)' : user.online ? '#4d9c68' : 'rgba(16,33,27,.2)'}"></span>
            ${user.status === 'disabled' ? '已停用' : user.online ? '在线' : '启用'}
          </span>
        </td>
        <td>${user.gamesPlayed} 局 <span class="muted" style="color:rgba(16,33,27,.32)">/ ${user.winRate}%</span></td>
        <td>${user.lastLoginAt ? timeAgo(user.lastLoginAt) : '<span class="muted" style="color:rgba(16,33,27,.3)">从未登录</span>'}</td>
        <td>
          <div class="table-actions">
            <button class="icon-btn" type="button" data-action="admin-edit-user" data-user-id="${user.id}" title="编辑">${icon('edit')}</button>
            <button class="icon-btn" type="button" data-action="admin-toggle-user" data-user-id="${user.id}" title="${user.status === 'active' ? '停用账号' : '启用账号'}" ${self ? 'disabled' : ''}>${icon(user.status === 'active' ? 'power' : 'check')}</button>
            <button class="icon-btn" type="button" data-action="admin-delete-user" data-user-id="${user.id}" title="删除用户" ${self ? 'disabled' : ''}>${icon('trash')}</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

function adminRoomsHTML() {
  const rooms = state.adminOverview?.rooms || [];
  return `<section class="admin-panel" style="padding-bottom:16px">
    <div class="admin-panel-head">
      <div><h2>牌桌监控</h2><p>只读视图 · 不作为管理员直接干预牌局</p></div>
      <span class="count-badge">${rooms.length}</span>
    </div>
    <div style="padding:16px">
      ${
        rooms.length
          ? `<div class="admin-rooms-grid">${rooms
              .map(
                (room) => `<article class="live-room-card">
                  <div class="live-room-card-head">
                    <div style="min-width:0">
                      <h3>${esc(room.name)}</h3>
                      <div class="room-meta-line">
                        <span>${esc(room.gameName)}</span><span>房间 ${esc(room.code)}</span><span>第 ${room.roundNumber || 0} 局</span>
                      </div>
                    </div>
                    <span class="pill ${room.status === 'playing' ? 'pill-red' : 'pill-green'}">${statusLabel(room.status)}</span>
                  </div>
                  <div class="room-players">
                    ${room.players
                      .map(
                        (player) => `<span title="${esc(player.name)}">${avatarHTML({ displayName: player.name, isBot: player.isBot }, { size: 'avatar-sm' })}</span>`,
                      )
                      .join('')}
                    <span>${room.playerCount}/${room.maxPlayers} 人 · 房主 ${esc(room.hostName)}</span>
                  </div>
                </article>`,
              )
              .join('')}</div>`
          : '<div class="admin-empty">目前没有开放中的牌桌。</div>'
      }
    </div>
  </section>`;
}

async function loadAdminData({ quiet = false } = {}) {
  if (!state.user || state.user.role !== 'admin') return;
  if (!quiet) {
    state.adminLoading = true;
    if (state.route.name === 'admin') renderAdminShell();
  }
  try {
    const [overview, users] = await Promise.all([
      api('/api/admin/overview'),
      api(`/api/admin/users?search=${encodeURIComponent(state.adminSearch)}`),
    ]);
    state.adminOverview = overview;
    state.adminUsers = users.users || [];
    state.adminLoaded = true;
  } catch (error) {
    toast(error.message || '载入后台数据失败', 'error');
  } finally {
    state.adminLoading = false;
    if (state.route.name === 'admin') renderAdminShell();
  }
}

async function loadAdminUsers() {
  try {
    const data = await api(`/api/admin/users?search=${encodeURIComponent(state.adminSearch)}`);
    state.adminUsers = data.users || [];
    const rows = $('#admin-user-rows');
    if (rows) rows.innerHTML = adminUserRowsHTML();
    const count = $('#admin-user-count');
    if (count) count.textContent = String(state.adminUsers.length);
  } catch (error) {
    toast(error.message || '搜索失败', 'error');
  }
}

function bindAdminSearch() {
  const input = $('[data-admin-search]');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  let timer = null;
  input.addEventListener('input', () => {
    state.adminSearch = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(loadAdminUsers, 320);
  });
}

function startAdminTimer() {
  stopAdminTimer();
  adminTimer = setInterval(async () => {
    if (
      state.route.name !== 'admin' ||
      state.adminTab !== 'overview' ||
      state.ui.modalOpen ||
      document.hidden ||
      !state.user
    ) {
      return;
    }
    try {
      const overview = await api('/api/admin/overview');
      state.adminOverview = overview;
      if (state.route.name === 'admin' && state.adminTab === 'overview' && !state.ui.modalOpen) {
        renderAdminShell();
      }
    } catch {
      // Silent background refresh.
    }
  }, 20_000);
}

function openAdminCreateUserModal() {
  openModal({
    title: '创建用户',
    subtitle: '为玩家开通一个纸牌屋账号，或创建另一位管理员',
    light: true,
    body: `<form data-form="admin-create-user" novalidate>
      <div class="field-row">
        <div class="field">
          <label for="new-username">登录账号</label>
          <input id="new-username" name="username" maxlength="24" placeholder="例如：ming" autocomplete="off" autofocus />
          <span class="field-hint">2–24 位字母、数字、下划线或短横线</span>
        </div>
        <div class="field">
          <label for="new-display">昵称</label>
          <input id="new-display" name="displayName" maxlength="24" placeholder="例如：阿明" autocomplete="off" />
        </div>
      </div>
      <div class="field-row" style="margin-top:16px">
        <div class="field">
          <label for="new-password">初始密码</label>
          <input id="new-password" name="password" type="text" maxlength="72" placeholder="至少 6 位" autocomplete="off" />
        </div>
        <div class="field">
          <label for="new-role">角色</label>
          <select id="new-role" name="role">
            <option value="player">玩家</option>
            <option value="admin">管理员</option>
          </select>
        </div>
      </div>
      <div class="modal-error" hidden></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-modal-close>取消</button>
        <button class="btn btn-gold" type="submit">${icon('userPlus')} 创建用户</button>
      </div>
    </form>`,
  });
}

function openAdminEditUserModal(userId) {
  const user = state.adminUsers.find((item) => item.id === Number(userId));
  if (!user) {
    toast('找不到该用户，请刷新列表', 'error');
    return;
  }
  const self = user.id === state.user?.id;
  openModal({
    title: '编辑用户',
    subtitle: `@${user.username} · 创建于 ${formatDate(user.createdAt, false)}`,
    light: true,
    body: `<form data-form="admin-edit-user" data-user-id="${user.id}" novalidate>
      <div class="field">
        <label for="edit-display">昵称</label>
        <input id="edit-display" name="displayName" maxlength="24" value="${escapeAttr(user.displayName)}" autofocus />
      </div>
      <div class="field-row" style="margin-top:16px">
        <div class="field">
          <label for="edit-role">角色</label>
          <select id="edit-role" name="role" ${self ? 'disabled' : ''}>
            <option value="player" ${user.role === 'player' ? 'selected' : ''}>玩家</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option>
          </select>
        </div>
        <div class="field">
          <label for="edit-status">账号状态</label>
          <select id="edit-status" name="status" ${self ? 'disabled' : ''}>
            <option value="active" ${user.status === 'active' ? 'selected' : ''}>启用</option>
            <option value="disabled" ${user.status === 'disabled' ? 'selected' : ''}>停用</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:16px">
        <label for="edit-password">重设密码 <span style="opacity:.5;font-weight:400">（留空则不修改）</span></label>
        <input id="edit-password" name="password" type="text" maxlength="72" placeholder="至少 6 位，留空保留原密码" autocomplete="off" />
      </div>
      ${self ? '<span class="field-hint" style="margin-top:8px;display:block">不能停用自己或移除自己的管理员权限。修改密码后需要重新登录。</span>' : ''}
      <div class="modal-error" hidden></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-modal-close>取消</button>
        <button class="btn btn-gold" type="submit">保存修改</button>
      </div>
    </form>`,
  });
}

async function handleAdminCreateUser(form) {
  const button = $('button[type="submit"]', form);
  const errorBox = $('.modal-error', form);
  if (errorBox) errorBox.hidden = true;
  setButtonBusy(button, true, '创建中');
  try {
    const data = await api('/api/admin/users', {
      method: 'POST',
      body: {
        username: form.elements.username.value.trim(),
        displayName: form.elements.displayName.value.trim(),
        password: form.elements.password.value,
        role: form.elements.role.value,
      },
    });
    closeModal();
    toast(`用户「${data.user.displayName}」已创建`, 'success');
    await loadAdminData({ quiet: true });
  } catch (error) {
    setButtonBusy(button, false);
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    } else {
      toast(error.message, 'error');
    }
  }
}

async function handleAdminEditUser(form) {
  const button = $('button[type="submit"]', form);
  const errorBox = $('.modal-error', form);
  if (errorBox) errorBox.hidden = true;
  const userId = Number(form.dataset.userId);
  const body = {
    displayName: form.elements.displayName.value.trim(),
  };
  if (!form.elements.role.disabled) body.role = form.elements.role.value;
  if (!form.elements.status.disabled) body.status = form.elements.status.value;
  if (form.elements.password.value) body.password = form.elements.password.value;
  setButtonBusy(button, true, '保存中');
  try {
    const data = await api(`/api/admin/users/${userId}`, { method: 'PATCH', body });
    if (userId === state.user?.id) state.user = data.user;
    closeModal();
    toast(`「${data.user.displayName}」资料已更新`, 'success');
    await loadAdminData({ quiet: true });
  } catch (error) {
    setButtonBusy(button, false);
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    } else {
      toast(error.message, 'error');
    }
  }
}

function toggleAdminUser(userId) {
  const user = state.adminUsers.find((item) => item.id === Number(userId));
  if (!user) return;
  const disabling = user.status === 'active';
  confirmDialog({
    title: disabling ? '停用账号' : '启用账号',
    message: disabling
      ? `确定停用「${user.displayName}」？对方会被强制退出登录，无法再进入游戏。`
      : `确定启用「${user.displayName}」？对方将可以重新登录。`,
    confirmText: disabling ? '停用' : '启用',
    danger: disabling,
    light: true,
    onConfirm: async () => {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { status: disabling ? 'disabled' : 'active' },
      });
      toast(disabling ? '账号已停用' : '账号已启用', 'success');
      await loadAdminData({ quiet: true });
    },
  });
}

function deleteAdminUser(userId) {
  const user = state.adminUsers.find((item) => item.id === Number(userId));
  if (!user) return;
  confirmDialog({
    title: '删除用户',
    message: `确定永久删除「${user.displayName}」(@${user.username})？此操作无法撤销，历史战绩仍会保留在牌局记录中。`,
    confirmText: '永久删除',
    danger: true,
    light: true,
    onConfirm: async () => {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      toast('用户已删除', 'success');
      await loadAdminData({ quiet: true });
    },
  });
}

/* ---------- actions ---------- */

async function logout() {
  const token = state.token;
  try {
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      });
    }
  } catch {
    // Clearing the local session is the important part.
  }
  clearSession();
  state.pendingRoute = null;
  toast('已退出登录', 'info', 1800);
  navigate('/');
}

async function openRules() {
  if (state.room?.rules) {
    rulesModal(state.room.rules, state.route.name === 'admin', roomGameName(state.room));
    return;
  }
  if (!state.games.length) {
    try {
      const data = await api('/api/games');
      state.games = data.games || [];
    } catch {
      // Fall through to the built-in Big Two rules.
    }
  }
  const games = (state.games || []).filter((game) => game.rules);
  if (games.length) {
    openModal({
      title: '纸牌屋玩法规则',
      subtitle: '五款纸牌游戏 · 潇洒纸牌屋现行桌规',
      wide: true,
      light: state.route.name === 'admin',
      body: `<div class="rules-hub">${games
        .map(
          (game) => `<section class="rules-game">
            <div class="rules-game-head">
              <span class="rules-game-icon">${gameGlyph(game.id)}</span>
              <div><h4>${esc(game.name)}</h4><p>${esc(game.tagline)}</p></div>
            </div>
            ${game.rules.sections
              .map(
                (section) => `<div class="rule-block">
                  <h4>${esc(section.title)}</h4><p>${esc(section.body)}</p>
                </div>`,
              )
              .join('')}
          </section>`,
        )
        .join('')}</div>
      <div class="modal-actions"><button class="btn btn-gold" type="button" data-modal-close>明白了</button></div>`,
    });
    return;
  }
  rulesModal(RULES_FALLBACK, state.route.name === 'admin', '锄大地');
}

async function refreshLobby() {
  if (state.ui.actionBusy) return;
  state.ui.actionBusy = true;
  try {
    const data = await api('/api/rooms');
    state.rooms = data.rooms || [];
    state.games = data.games || state.games;
    state.roomsLoaded = true;
    updateLobbyRoomList();
    const count = $('#open-room-count');
    if (count) count.textContent = String(state.rooms.filter((room) => room.status === 'waiting').length);
    toast('牌桌列表已更新', 'success', 1500);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.ui.actionBusy = false;
  }
}

function handleGlobalClick(event) {
  const closeButton = event.target.closest('[data-modal-close]');
  if (closeButton) {
    closeModal();
    return;
  }
  if (event.target.matches?.('[data-modal-backdrop]')) {
    closeModal();
    return;
  }

  const cardButton = event.target.closest('.hand-cards [data-card-id]');
  if (cardButton) {
    if (state.room?.status !== 'playing' || isBidding(state.room)) return;
    const id = cardButton.dataset.cardId;
    if (state.ui.selected.has(id)) state.ui.selected.delete(id);
    else state.ui.selected.add(id);
    const selected = state.ui.selected.has(id);
    cardButton.classList.toggle('selected', selected);
    cardButton.classList.toggle('hand-card', selected);
    cardButton.setAttribute('aria-pressed', String(selected));
    updateSelectionUI();
    if (selected && window.innerWidth <= 700) {
      cardButton.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    soundClick('select');
    return;
  }

  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  if (!action || action === 'noop') return;
  if (trigger.tagName === 'A') event.preventDefault();

  switch (action) {
    case 'open-rules':
      openRules();
      break;
    case 'toggle-sound':
      toggleSound();
      break;
    case 'logout':
      logout();
      break;
    case 'create-room':
      openCreateRoomModal();
      break;
    case 'refresh-lobby':
      refreshLobby();
      break;
    case 'join-room':
      joinRoomByCode(trigger.dataset.code);
      break;
    case 'exit-room':
      exitRoom();
      break;
    case 'toggle-ready':
      toggleReady();
      break;
    case 'add-bot':
    case 'add-bots':
      addBots();
      break;
    case 'remove-bot':
      removeBot();
      break;
    case 'start-game':
      startGame();
      break;
    case 'restart-game':
      restartGame();
      break;
    case 'switch-game':
      switchGame(trigger.dataset.game);
      break;
    case 'kick-player':
      kickPlayer(Number(trigger.dataset.playerId));
      break;
    case 'play-cards':
      playSelected();
      break;
    case 'pass':
      passTurn();
      break;
    case 'hint':
      showHint();
      break;
    case 'bid':
      placeBid(trigger.dataset.value);
      break;
    case 'texas-action':
      texasAction(trigger.dataset.type);
      break;
    case 'texas-raise':
      texasRaiseFromInput();
      break;
    case 'texas-raise-quick':
      texasRaiseQuick(trigger.dataset.mode);
      break;
    case 'mahjong-tile':
      mahjongSelectTile(trigger.dataset.tileId);
      break;
    case 'mahjong-discard':
      mahjongDiscard();
      break;
    case 'mahjong-claim':
      mahjongClaim(trigger.dataset.type);
      break;
    case 'sort-hand':
      state.ui.handSort = state.ui.handSort === 'desc' ? 'asc' : 'desc';
      renderRoom();
      break;
    case 'copy-code':
      copyRoomCode();
      break;
    case 'copy-invite':
      copyInvite();
      break;
    case 'toggle-password': {
      const wrapper = trigger.closest('.input-wrap');
      const input = wrapper?.querySelector('input');
      if (input) {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        trigger.innerHTML = icon(show ? 'eyeOff' : 'eye');
        trigger.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      }
      break;
    }
    case 'admin-tab':
      state.adminTab = trigger.dataset.tab || 'overview';
      renderAdminShell();
      if (state.adminTab === 'users') loadAdminUsers();
      break;
    case 'admin-refresh':
      loadAdminData();
      break;
    case 'admin-add-user':
      openAdminCreateUserModal();
      break;
    case 'admin-edit-user':
      openAdminEditUserModal(Number(trigger.dataset.userId));
      break;
    case 'admin-toggle-user':
      toggleAdminUser(Number(trigger.dataset.userId));
      break;
    case 'admin-delete-user':
      deleteAdminUser(Number(trigger.dataset.userId));
      break;
    default:
      break;
  }
}

function handleGlobalSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'login') {
    handleLoginSubmit(form);
  } else if (kind === 'create-room') {
    handleCreateRoom(form);
  } else if (kind === 'quick-join') {
    joinRoomByCode(form.elements.code.value);
  } else if (kind === 'chat') {
    sendChat(form);
  } else if (kind === 'admin-search') {
    state.adminSearch = form.elements.search.value.trim();
    loadAdminUsers();
  } else if (kind === 'admin-create-user') {
    handleAdminCreateUser(form);
  } else if (kind === 'admin-edit-user') {
    handleAdminEditUser(form);
  }
}

function handleGlobalInput(event) {
  const chatInput = event.target.closest('.chat-form input[name="message"]');
  if (chatInput) {
    state.ui.chatDraft = chatInput.value;
    return;
  }
  if (event.target.matches?.('[data-raise-input]')) {
    state.ui.texasRaise = event.target.value;
  }
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && state.ui.modalOpen) {
    closeModal();
    return;
  }
}

/* ---------- boot ---------- */

async function restoreSession() {
  if (!state.token) return;
  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) throw new Error('invalid session');
    const data = await response.json();
    if (!data.ok || !data.user) throw new Error('invalid session');
    state.user = data.user;
    state.homeRoomCode = data.roomCode || null;
  } catch {
    state.token = '';
    state.user = null;
    state.homeRoomCode = null;
    localStorage.removeItem('xiaosa_token');
  }
}

function normalizeEntryPath() {
  if (location.pathname === '/admin' && !location.hash) {
    history.replaceState(null, '', `${location.pathname}#/admin`);
  } else if (location.pathname === '/game' && !location.hash) {
    history.replaceState(null, '', `${location.pathname}#/lobby`);
  }
}

async function boot() {
  normalizeEntryPath();
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('submit', handleGlobalSubmit);
  document.addEventListener('input', handleGlobalInput);
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('beforeunload', () => {
    lobbyES?.close();
    roomES?.close();
  });
  modalRoot.addEventListener('click', (event) => {
    if (event.target.matches('[data-modal-backdrop]')) closeModal();
  });
  await restoreSession();
  state.booted = true;
  await handleRoute();
}

boot();

/* __APP_END__ */


