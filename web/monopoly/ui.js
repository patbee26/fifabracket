// Rendering and animation. Everything here is cosmetic — the engine owns the
// truth, and every animation ends by re-rendering authoritative state.

import { BOARD, GROUPS, GROUP_SPACES, TOKENS, JAIL_FINE } from './board.js';
import { rentFor, ownsGroup, holdings } from './engine.js';
import { sfx } from './sound.js';

const $ = (id) => document.getElementById(id);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const money = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const tokenOf = (id) => TOKENS.find((t) => t.id === id) || TOKENS[0];

// The Space Needle silhouette, matching the header logo. Same shapes, but
// drawn in currentColor so it works as an icon at any size.
const NEEDLE = [
  'M29.6 2h4.8v19h-4.8z',
  'M9 23Q32 13 55 23 45 31 32 31 19 31 9 23Z',
  'M27.6 31h8.8l1.1 15H26.5z',
  'M26.3 46h4.4q-1.7 8.5-7.6 15.5h-6.3q6.9-7.3 9.5-15.5z',
  'M37.7 46h-4.4q1.7 8.5 7.6 15.5h6.3q-6.9-7.3-9.5-15.5z',
  'M29.6 46h4.8v15.5h-4.8z',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function needleGlyph() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'needle-glyph');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of NEEDLE) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Put a token's glyph into an element — an emoji, or a drawn icon. */
export function setToken(el, tokenId) {
  const t = tokenOf(tokenId);
  el.textContent = '';
  if (t.icon === 'needle') el.appendChild(needleGlyph());
  else el.textContent = t.emoji;
  el.setAttribute('title', t.label);
}

// Distinct outline colour per seat, so tokens stay tellable apart.
const SEAT_COLORS = ['#e8493f', '#2f7fe0', '#39a85c', '#e0a11c', '#9b59b6', '#e3733c', '#17a9a0', '#7d5fff'];
const seatColor = (idx) => SEAT_COLORS[idx % SEAT_COLORS.length];

let speed = 1; // scales every animation delay

export function setSpeed(multiplier) { speed = multiplier; }
const wait = (ms) => sleep(Math.max(0, ms * speed));

// --- board construction ---------------------------------------------------

/** Grid cell for a space index. GO sits bottom-right, play runs clockwise. */
function gridPos(i) {
  if (i === 0) return { col: 11, row: 11 };
  if (i < 10) return { col: 11 - i, row: 11 };
  if (i === 10) return { col: 1, row: 11 };
  if (i < 20) return { col: 1, row: 11 - (i - 10) };
  if (i === 20) return { col: 1, row: 1 };
  if (i < 30) return { col: 1 + (i - 20), row: 1 };
  if (i === 30) return { col: 11, row: 1 };
  return { col: 11, row: 1 + (i - 30) };
}

const CORNER_GLYPH = { 0: '➡️', 10: '🚗', 20: '🌳', 30: '🚧' };
const TYPE_GLYPH = { rail: '🚈', utility: '💡', chance: '🌧️', chest: '📋', tax: '🧾' };
const SPACE_GLYPH = { 5: '⛴️', 15: '🚈', 25: '🚂', 35: '🚝', 12: '💡', 28: '🚰' };

export function buildBoard() {
  const board = $('board');
  for (const sp of BOARD) {
    const { col, row } = gridPos(sp.i);
    const el = document.createElement('div');
    el.className = 'space';
    el.dataset.i = String(sp.i);
    el.style.gridColumn = String(col);
    el.style.gridRow = String(row);

    const corner = [0, 10, 20, 30].includes(sp.i);
    if (corner) el.classList.add('corner');
    else if (col === 1) el.classList.add('side-left');
    else if (col === 11) el.classList.add('side-right');
    else if (row === 1) el.classList.add('side-top');

    const strip = document.createElement('div');
    strip.className = 'strip';
    if (sp.type === 'prop') strip.style.background = GROUPS[sp.group].color;
    el.appendChild(strip);

    const body = document.createElement('div');
    body.className = 'body';

    const glyph = CORNER_GLYPH[sp.i] || SPACE_GLYPH[sp.i] || TYPE_GLYPH[sp.type];
    if (glyph) {
      const g = document.createElement('div');
      g.className = 'glyph';
      g.textContent = glyph;
      body.appendChild(g);
    }

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = sp.name;
    body.appendChild(nm);

    if (sp.price) {
      const pr = document.createElement('div');
      pr.className = 'pr';
      pr.textContent = money(sp.price);
      body.appendChild(pr);
    } else if (sp.type === 'tax') {
      const pr = document.createElement('div');
      pr.className = 'pr';
      pr.textContent = money(sp.amount);
      body.appendChild(pr);
    }

    el.appendChild(body);

    const builds = document.createElement('div');
    builds.className = 'builds';
    el.appendChild(builds);

    board.appendChild(el);
  }
}

const spaceEl = (i) => document.querySelector(`.space[data-i="${i}"]`);

// --- token positioning ----------------------------------------------------

/** Centre of a space, in pixels relative to the board, nudged for crowding. */
function spot(i, slot, total) {
  const board = $('board');
  const cell = spaceEl(i);
  if (!cell || !board) return { x: 0, y: 0 };
  const b = board.getBoundingClientRect();
  const c = cell.getBoundingClientRect();

  let x = c.left - b.left + c.width / 2;
  let y = c.top - b.top + c.height / 2;

  if (total > 1) {
    // Fan crowded tokens out in a small grid so none is fully hidden.
    const perRow = Math.min(total, 3);
    const col = slot % perRow;
    const row = Math.floor(slot / perRow);
    const stepX = Math.min(c.width / (perRow + 0.4), 15);
    const stepY = Math.min(c.height / 3, 13);
    x += (col - (perRow - 1) / 2) * stepX;
    y += row * stepY - (Math.ceil(total / perRow) - 1) * stepY / 2;
  }
  return { x, y };
}

export function ensureTokens(state) {
  const layer = $('tokenLayer');
  const want = new Set(state.players.map((p) => p.id));
  for (const el of [...layer.children]) {
    if (!want.has(el.dataset.player)) el.remove();
  }
  state.players.forEach((p, idx) => {
    let el = layer.querySelector(`[data-player="${p.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'token';
      el.dataset.player = p.id;
      setToken(el, p.token);
      el.style.setProperty('--tok', seatColor(idx));
      el.title = p.name;
      layer.appendChild(el);
    }
    el.classList.toggle('out', p.bankrupt);
    el.classList.toggle('jailed', p.inJail);
  });
}

export function placeTokens(state) {
  const byspace = new Map();
  for (const p of state.players) {
    if (!byspace.has(p.pos)) byspace.set(p.pos, []);
    byspace.get(p.pos).push(p.id);
  }
  const layer = $('tokenLayer');
  for (const [i, ids] of byspace) {
    ids.forEach((id, slot) => {
      const el = layer.querySelector(`[data-player="${id}"]`);
      if (!el) return;
      const { x, y } = spot(i, slot, ids.length);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }
}

/** Move one token along a path of spaces, hopping space by space. */
async function hopAlong(playerId, path, state) {
  const el = $('tokenLayer').querySelector(`[data-player="${playerId}"]`);
  if (!el) return;
  for (const i of path) {
    const crowd = state.players.filter((p) => p.pos === i && p.id !== playerId).length;
    const { x, y } = spot(i, crowd, crowd + 1);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.add('hopping');
    sfx.hop();
    await wait(150);
    el.classList.remove('hopping');
  }
}

// --- board state ----------------------------------------------------------

export function renderBoard(state) {
  const order = new Map(state.players.map((p, idx) => [p.id, idx]));

  for (const sp of BOARD) {
    const el = spaceEl(sp.i);
    if (!el) continue;
    const d = state.deeds[sp.i];

    el.classList.toggle('owned', !!(d && d.owner));
    el.classList.toggle('mortgaged', !!(d && d.mortgaged));
    if (d && d.owner) el.style.setProperty('--own', seatColor(order.get(d.owner) ?? 0));

    const builds = el.querySelector('.builds');
    const level = d ? d.houses : 0;
    if (builds.dataset.level !== String(level)) {
      builds.dataset.level = String(level);
      builds.textContent = '';
      if (level === 5) {
        const pip = document.createElement('i');
        pip.className = 'pip hotel';
        builds.appendChild(pip);
      } else {
        for (let n = 0; n < level; n++) {
          const pip = document.createElement('i');
          pip.className = 'pip';
          pip.style.animationDelay = `${n * 40}ms`;
          builds.appendChild(pip);
        }
      }
    }
  }
}

export function renderDice(state) {
  const pips = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  [$('die1'), $('die2')].forEach((die, n) => {
    const v = state.dice[n] || 1;
    die.textContent = '';
    for (let cell = 0; cell < 9; cell++) {
      const i = document.createElement('i');
      if (!pips[v].includes(cell)) i.style.visibility = 'hidden';
      die.appendChild(i);
    }
  });
}

export async function rollDiceAnimation() {
  const dice = [$('die1'), $('die2')];
  dice.forEach((d) => d.classList.add('rolling'));
  sfx.dice();
  await wait(620);
  dice.forEach((d) => d.classList.remove('rolling'));
}

export function renderPlayers(state, meId, onPick) {
  const list = $('playerList');
  list.textContent = '';
  state.players.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    if (state.players[state.turn]?.id === p.id && state.phase !== 'gameover') row.classList.add('active');
    if (p.bankrupt) row.classList.add('broke');

    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.setProperty('--tok', seatColor(idx));
    setToken(dot, p.token);

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = p.name + (p.id === meId ? ' (you)' : '');

    const meta = document.createElement('div');
    meta.style.textAlign = 'right';
    const cash = document.createElement('div');
    cash.className = 'cash';
    cash.dataset.player = p.id;
    cash.textContent = p.bankrupt ? 'out' : money(p.cash);
    const mini = document.createElement('div');
    mini.className = 'mini';
    const owned = holdings(state, p.id).length;
    const sets = Object.keys(GROUPS).filter((g) => ownsGroup(state, p.id, g)).length;
    mini.textContent = p.inJail ? 'in gridlock'
      : `${owned} deed${owned === 1 ? '' : 's'}${sets ? ` · ${sets} set${sets === 1 ? '' : 's'}` : ''}`;
    meta.append(cash, mini);

    row.append(dot, nm, meta);
    row.addEventListener('click', () => onPick && onPick(p.id));
    list.appendChild(row);
  });
}

// --- log ------------------------------------------------------------------

const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? 'Someone';

export function describe(state, ev) {
  const who = (id) => `<b>${escapeHtml(nameOf(state, id))}</b>`;
  const sp = (i) => `<b>${escapeHtml(BOARD[i].name)}</b>`;
  switch (ev.type) {
    case 'start':      return 'The game begins.';
    case 'turn':       return `${who(ev.player)} is up.`;
    case 'rollAgain':  return `${who(ev.player)} rolled doubles and goes again.`;
    case 'dice':       return ev.utility ? null : `${who(ev.player)} rolled ${ev.dice[0]} + ${ev.dice[1]} = ${ev.dice[0] + ev.dice[1]}.`;
    case 'passGo':     return `${who(ev.player)} passed GO and collected $200.`;
    case 'land':       return null;
    case 'offer':      return null;
    case 'acquire':    return `${who(ev.player)} ${ev.via === 'auction' ? 'won' : 'bought'} ${sp(ev.space)} for ${money(ev.price)}.`;
    case 'rent':       return `${who(ev.player)} paid ${who(ev.to)} ${money(ev.amount)} for ${sp(ev.space)}.`;
    case 'card':       return `${who(ev.player)} drew: ${escapeHtml(ev.card.text)}`;
    case 'jailed':     return `${who(ev.player)} is stuck in gridlock.`;
    case 'jailOut':    return `${who(ev.player)} is out of gridlock${ev.how === 'fine' || ev.how === 'paid' ? ' after paying the fine' : ev.how === 'card' ? ' using a card' : ' with doubles'}.`;
    case 'jailTimeUp': return null;
    case 'speeding':   return `${who(ev.player)} rolled three doubles — straight to gridlock.`;
    case 'build':      return ev.sold
      ? `${who(ev.player)} sold a building on ${sp(ev.space)}.`
      : `${who(ev.player)} built ${ev.level === 5 ? 'a hotel' : `house ${ev.level}`} on ${sp(ev.space)}.`;
    case 'mortgage':   return `${who(ev.player)} ${ev.on ? 'mortgaged' : 'lifted the mortgage on'} ${sp(ev.space)}.`;
    case 'auctionStart': return `${sp(ev.space)} goes to auction.`;
    case 'auctionBid': return `${who(ev.player)} bids ${money(ev.amount)}.`;
    case 'auctionPass': return `${who(ev.player)} passes.`;
    case 'auctionEnd': return ev.winner ? null : `Nobody bid — ${sp(ev.space)} stays with the bank.`;
    case 'tradeOffer': return `${who(ev.from)} offers ${who(ev.to)} a trade.`;
    case 'tradeResult': return ev.accepted
      ? `${who(ev.from)} and ${who(ev.to)} made a deal.`
      : `The trade between ${who(ev.from)} and ${who(ev.to)} fell through.`;
    case 'debt':       return `${who(ev.player)} owes ${money(ev.amount)} and has to raise it.`;
    case 'bankrupt':   return ev.to
      ? `${who(ev.player)} is bankrupt — everything goes to ${who(ev.to)}.`
      : `${who(ev.player)} is bankrupt. The bank takes everything.`;
    case 'potClaimed': return `${who(ev.player)} scooped ${money(ev.amount)} off Gas Works Park.`;
    case 'gameover':   return `<b>${escapeHtml(nameOf(state, ev.winner))} wins!</b>`;
    case 'cash':       return null;
    default:           return null;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const BIG = new Set(['acquire', 'bankrupt', 'gameover', 'tradeResult', 'auctionEnd', 'speeding']);

export function renderLog(state, upToSeq = Infinity) {
  const box = $('log');
  box.textContent = '';
  const entries = state.log.filter((e) => e.seq <= upToSeq).slice(-60).reverse();
  for (const ev of entries) {
    const text = describe(state, ev);
    if (!text) continue;
    const div = document.createElement('div');
    div.className = 'entry' + (BIG.has(ev.type) ? ' big' : '');
    div.innerHTML = text;
    box.appendChild(div);
  }
}

// --- effects --------------------------------------------------------------

export function floatMoney(playerId, amount) {
  const row = document.querySelector(`.cash[data-player="${playerId}"]`);
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');

  const rect = row.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `floater ${amount >= 0 ? 'up' : 'down'}`;
  el.textContent = `${amount >= 0 ? '+' : '−'}${money(amount)}`;
  el.style.position = 'fixed';
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

export function flashSpace(i) {
  const el = spaceEl(i);
  if (!el) return;
  el.classList.remove('landed');
  void el.offsetWidth;
  el.classList.add('landed');
  setTimeout(() => el.classList.remove('landed'), 800);
}

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function confetti(count = 90) {
  const colors = ['#e8493f', '#2f7fe0', '#39a85c', '#e0a11c', '#9b59b6', '#17a9a0'];
  for (let n = 0; n < count; n++) {
    const bit = document.createElement('div');
    bit.className = 'confetti';
    bit.style.left = `${Math.random() * 100}vw`;
    bit.style.background = colors[n % colors.length];
    bit.style.animationDuration = `${2 + Math.random() * 2.2}s`;
    bit.style.animationDelay = `${Math.random() * 0.7}s`;
    bit.style.opacity = String(0.65 + Math.random() * 0.35);
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 5200);
  }
}

// --- modal ----------------------------------------------------------------

export function openModal(build) {
  const back = $('modalBack');
  const modal = $('modal');
  modal.textContent = '';
  build(modal);
  back.hidden = false;
  return modal;
}

export function closeModal() {
  $('modalBack').hidden = true;
  $('modal').textContent = '';
}

export const modalIsOpen = () => !$('modalBack').hidden;

/** A title-deed card, used by the buy prompt and the property inspector. */
export function deedCard(state, i) {
  const sp = BOARD[i];
  const wrap = document.createElement('div');
  wrap.className = 'deed';

  const strip = document.createElement('div');
  strip.className = 'deed-strip';
  strip.style.background = sp.type === 'prop' ? GROUPS[sp.group].color : 'var(--line)';
  strip.textContent = sp.name;
  wrap.appendChild(strip);

  const body = document.createElement('div');
  body.className = 'deed-body';

  const add = (label, value, cls = '') => {
    const row = document.createElement('div');
    row.className = `deed-row ${cls}`;
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('span'); b.textContent = value;
    row.append(a, b);
    body.appendChild(row);
  };

  if (sp.type === 'prop') {
    add('Rent', money(sp.rent[0]));
    add('With colour set', money(sp.rent[0] * 2));
    for (let h = 1; h <= 4; h++) add(`${h} house${h > 1 ? 's' : ''}`, money(sp.rent[h]));
    add('Hotel', money(sp.rent[5]));
    add('House cost', money(GROUPS[sp.group].house), 'head');
  } else if (sp.type === 'rail') {
    add('1 line', '$25'); add('2 lines', '$50'); add('3 lines', '$100'); add('4 lines', '$200');
  } else if (sp.type === 'utility') {
    add('One utility', '4 × dice'); add('Both utilities', '10 × dice');
  }
  add('Mortgage value', money(Math.floor(sp.price / 2)), 'head');

  if (state) {
    const d = state.deeds[i];
    if (d && d.owner) {
      add('Owner', nameOf(state, d.owner));
      add('Rent right now', money(rentFor(state, i, 7)));
    }
  }

  wrap.appendChild(body);
  return wrap;
}

// --- the event pump -------------------------------------------------------

/**
 * Play new events as animation, then settle on the authoritative state.
 * `meId` is the local player, used to decide whose money floats where.
 */
export async function playEvents(state, events, { onRender } = {}) {
  for (const ev of events) {
    switch (ev.type) {
      case 'dice':
        if (!ev.utility) {
          await rollDiceAnimation();
          state.dice = ev.dice.length === 2 ? ev.dice : state.dice;
          renderDice({ dice: ev.dice.length === 2 ? ev.dice : [ev.dice[0], 0] });
        }
        break;

      case 'move': {
        const dist = ((ev.to - ev.from) % 40 + 40) % 40;
        if (ev.why === 'roll' && dist > 0 && dist <= 12) {
          const path = [];
          for (let n = 1; n <= dist; n++) path.push((ev.from + n) % 40);
          await hopAlong(ev.player, path, state);
        } else {
          const el = $('tokenLayer').querySelector(`[data-player="${ev.player}"]`);
          if (el) {
            const { x, y } = spot(ev.to, 0, 1);
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            sfx.hop();
          }
          await wait(320);
        }
        // Keep our local mirror in step so crowding maths stays right.
        const mover = state.players.find((p) => p.id === ev.player);
        if (mover) mover.pos = ev.to;
        flashSpace(ev.to);
        break;
      }

      case 'passGo':
        sfx.passGo();
        await wait(320);
        break;

      case 'cash':
        floatMoney(ev.player, ev.amount);
        if (ev.amount > 0) sfx.cashUp(); else sfx.cashDown();
        await wait(300);
        break;

      case 'rent':
        sfx.rent();
        await wait(420);
        break;

      case 'card':
        sfx.card();
        await showCard(ev);
        break;

      case 'acquire':
        sfx.buy();
        flashSpace(ev.space);
        if (onRender) onRender();
        await wait(420);
        break;

      case 'build':
        sfx.build();
        if (onRender) onRender();
        await wait(300);
        break;

      case 'mortgage':
        if (onRender) onRender();
        await wait(200);
        break;

      case 'jailed':
      case 'speeding':
        sfx.jail();
        await wait(520);
        break;

      case 'auctionStart':
        sfx.auction();
        await wait(360);
        break;

      case 'auctionEnd':
        sfx.gavel();
        await wait(430);
        break;

      case 'tradeResult':
        if (ev.accepted) { sfx.trade(); await wait(460); }
        break;

      case 'bankrupt':
        sfx.bankrupt();
        await wait(850);
        break;

      case 'gameover':
        sfx.win();
        confetti(140);
        await wait(400);
        break;

      case 'turn':
        sfx.turn();
        // A clear gap between players, so a run of CPU turns reads as
        // separate turns rather than one blur of movement.
        await wait(650);
        break;

      default:
        break;
    }
  }
}

/** Flash a drawn Chance / Community Board card on screen. */
function showCard(ev) {
  return new Promise((resolve) => {
    const back = $('modalBack');
    const wasOpen = !back.hidden;
    if (wasOpen) return resolve(); // don't stomp a prompt already up

    openModal((modal) => {
      const card = document.createElement('div');
      card.className = `gamecard ${ev.kind === 'chest' ? 'chest' : ''}`;
      const kind = document.createElement('div');
      kind.className = 'kind';
      kind.textContent = ev.kind === 'chest' ? 'Community Board' : 'Rainy Day';
      const txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = ev.card.text;
      card.append(kind, txt);
      modal.appendChild(card);
    });

    setTimeout(() => {
      closeModal();
      resolve();
    }, Math.max(900, 2000 * speed));
  });
}

export { money, seatColor, JAIL_FINE, GROUP_SPACES };
