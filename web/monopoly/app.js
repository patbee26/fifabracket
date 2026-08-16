// Emerald City — screen flow, controls and the bridge between the engine and
// the network. Two modes share one code path:
//
//   local  — the engine runs right here (pass & play, or against the CPU)
//   online — the Netlify function is authoritative and we poll it
//
// Either way we end up with a game state, diff its event log against what we
// have already animated, and play the difference.

import { BOARD, GROUPS, GROUP_SPACES, TOKENS, JAIL_FINE } from './board.js';
import {
  createGame, applyAction, legalActions, current, player, holdings,
  buildBlocker, netWorth, ownsGroup,
} from './engine.js';
import { advanceCpus, pendingActor } from './ai.js';
import { api, RoomPoller, saveSession, loadSession, clearSession } from './net.js';
import * as ui from './ui.js';
import { sfx, unlock, setEnabled, isEnabled } from './sound.js';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

// --- session ---------------------------------------------------------------

const app = {
  mode: null,        // 'local' | 'online'
  state: null,       // engine state
  room: null,        // online room record
  session: null,     // { code, playerId, secret }
  renderedSeq: 0,
  syncing: false,
  queued: null,
  poller: null,
  myToken: TOKENS[0].id,
  promptKey: null,   // which prompt is on screen, so we don't rebuild it
};

/** In a shared-screen game the "viewer" is whoever the engine is waiting on. */
function viewerId() {
  if (!app.state) return null;
  if (app.mode === 'online') return app.session?.playerId ?? null;
  return pendingActor(app.state);
}

// --- boot ------------------------------------------------------------------

function initTheme() {
  const saved = localStorage.getItem('emeraldcity.theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('emeraldcity.theme', next);
  $('themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#0d1512' : '#0f3d2e');
}

function initSound() {
  const on = localStorage.getItem('emeraldcity.sound') !== 'off';
  setEnabled(on);
  $('soundBtn').textContent = on ? '🔊' : '🔇';
}

function toggleSound() {
  const on = !isEnabled();
  setEnabled(on);
  localStorage.setItem('emeraldcity.sound', on ? 'on' : 'off');
  $('soundBtn').textContent = on ? '🔊' : '🔇';
  if (on) sfx.click();
}

function showView(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === id);
}

function buildTokenPicker() {
  const grid = $('tokenGrid');
  grid.textContent = '';
  for (const t of TOKENS) {
    const b = document.createElement('button');
    b.className = 'token-pick';
    b.type = 'button';
    b.textContent = t.emoji;
    b.title = t.label;
    b.setAttribute('aria-pressed', String(t.id === app.myToken));
    b.addEventListener('click', () => {
      app.myToken = t.id;
      sfx.click();
      for (const other of grid.children) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    grid.appendChild(b);
  }
}

const myName = () => ($('nameInput').value.trim() || 'Player');

// --- starting games --------------------------------------------------------

function houseRules() {
  return {
    auctions: $('ruleAuction').checked,
    freeParkingPot: $('rulePot').checked,
    startCash: Number($('ruleCash').value) || 1500,
  };
}

async function hostOnline() {
  try {
    const res = await api.create(myName(), app.myToken, houseRules());
    app.mode = 'online';
    app.session = { code: res.code, playerId: res.playerId, secret: res.secret };
    saveSession(app.session);
    app.room = res.room;
    enterLobby();
  } catch (err) {
    ui.toast(err.message);
  }
}

async function joinOnline() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { ui.toast('Room codes are four characters.'); return; }
  try {
    const res = await api.join(code, myName(), app.myToken);
    app.mode = 'online';
    app.session = { code: res.code, playerId: res.playerId, secret: res.secret };
    saveSession(app.session);
    app.room = res.room;
    enterLobby();
  } catch (err) {
    ui.toast(err.message);
  }
}

/** Pass & play and solo-vs-CPU both run entirely in this tab. */
function startLocal({ humans, cpus }) {
  const rules = houseRules();
  const players = [];
  for (let i = 0; i < humans; i++) {
    players.push({
      id: `p${i + 1}`,
      name: i === 0 ? myName() : `Player ${i + 1}`,
      token: i === 0 ? app.myToken : TOKENS.find((t) => !players.some((q) => q.token === t.id) && t.id !== app.myToken).id,
      isCPU: false,
    });
  }
  const cpuNames = ['Rainier', 'Cascade', 'Puget', 'Elliott', 'Alki', 'Denny', 'Yesler'];
  for (let i = 0; i < cpus; i++) {
    const token = TOKENS.find((t) => !players.some((q) => q.token === t.id));
    players.push({ id: `p${players.length + 1}`, name: `${cpuNames[i % cpuNames.length]} (CPU)`, token: token.id, isCPU: true });
  }

  app.mode = 'local';
  app.session = null;
  app.room = null;
  app.state = createGame({ players, settings: rules, seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 });
  app.renderedSeq = 0;
  $('roomCode').hidden = true;
  showView('viewGame');
  advanceCpus(app.state, applyAction);
  sync(app.state);
}

// --- lobby -----------------------------------------------------------------

function enterLobby() {
  showView('viewLobby');
  $('roomCode').hidden = false;
  $('roomCode').textContent = app.session.code;
  renderLobby();

  app.poller?.stop();
  app.poller = new RoomPoller(app.session.code, async (room) => {
    app.room = room;
    if (room.started && room.game) {
      showView('viewGame');
      await sync(room.game);
    } else {
      renderLobby();
    }
  }, (err, failures) => {
    if (failures === 3) ui.toast(err.message);
  });
  app.poller.start();
}

function renderLobby() {
  const room = app.room;
  if (!room) return;
  const isHost = room.hostId === app.session.playerId;

  const list = $('seatList');
  list.textContent = '';
  for (const seat of room.seats) {
    const row = document.createElement('div');
    row.className = 'seat';

    const emoji = document.createElement('div');
    emoji.className = 'emoji';
    emoji.textContent = ui.tokenOf(seat.token).emoji;

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = seat.name + (seat.id === app.session.playerId ? ' (you)' : '');

    row.append(emoji, who);

    if (seat.id === room.hostId) {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = 'host';
      row.appendChild(tag);
    } else if (seat.isCPU) {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = 'cpu';
      row.appendChild(tag);
    }

    if (isHost && seat.id !== room.hostId) {
      const kick = document.createElement('button');
      kick.className = 'small ghost';
      kick.textContent = 'Remove';
      kick.addEventListener('click', async () => {
        try {
          const res = await api.removeSeat(app.session, seat.id);
          app.room = res.room;
          renderLobby();
        } catch (err) { ui.toast(err.message); }
      });
      row.appendChild(kick);
    }
    list.appendChild(row);
  }

  $('hostControls').style.display = isHost ? '' : 'none';
  $('startBtn').disabled = !isHost || room.seats.length < 2;
  for (const el of [$('ruleAuction'), $('rulePot'), $('ruleCash')]) el.disabled = !isHost;
  $('waitHint').textContent = isHost
    ? (room.seats.length < 2 ? 'Waiting for at least one more player…' : '')
    : 'Waiting for the host to start.';
  $('lobbyHint').textContent = `Share code ${app.session.code} — up to 8 players.`;
}

// --- the sync loop ---------------------------------------------------------

/**
 * Adopt a new game state, animating whatever happened since we last drew.
 * Overlapping calls are collapsed: the newest state wins.
 */
async function sync(next) {
  if (app.syncing) { app.queued = next; return; }
  app.syncing = true;

  try {
    let state = next;
    do {
      const events = state.log.filter((e) => e.seq > app.renderedSeq);
      const fresh = !app.state || app.state.players.length !== state.players.length;
      app.state = state;

      ui.ensureTokens(state);
      if (fresh) {
        ui.placeTokens(state);
        ui.renderBoard(state);
      }
      ui.renderPlayers(state, viewerId(), inspectPlayer);

      // A long backlog (we were away, or just joined) is caught up silently.
      if (events.length > 26) {
        app.renderedSeq = state.seq;
      } else {
        await ui.playEvents(state, events, { onRender: () => ui.renderBoard(state) });
        app.renderedSeq = state.seq;
      }

      fullRender();
      state = app.queued;
      app.queued = null;
    } while (state);
  } finally {
    app.syncing = false;
  }

  maybePrompt();
}

function fullRender() {
  const state = app.state;
  if (!state) return;
  ui.renderBoard(state);
  ui.placeTokens(state);
  ui.renderDice(state);
  ui.renderPlayers(state, viewerId(), inspectPlayer);
  ui.renderLog(state);
  renderTurnBanner();
  renderActions();
}

function renderTurnBanner() {
  const state = app.state;
  const banner = $('turnBanner');
  if (state.phase === 'gameover') {
    const w = player(state, state.winner);
    banner.textContent = w ? `${w.name} wins!` : 'Game over';
    banner.classList.remove('you');
    return;
  }
  const actor = pendingActor(state);
  const p = actor ? player(state, actor) : null;
  const mine = app.mode === 'local' ? !p?.isCPU : actor === app.session?.playerId;
  banner.textContent = !p ? '…'
    : mine && app.mode === 'online' ? 'Your turn'
    : `${p.name}${p.isCPU ? ' is thinking…' : "'s turn"}`;
  banner.classList.toggle('you', !!mine);
}

// --- acting ----------------------------------------------------------------

async function submit(action) {
  const me = viewerId();
  if (!me) return;

  if (app.mode === 'local') {
    const res = applyAction(app.state, me, action);
    if (!res.ok) { sfx.error(); ui.toast(res.error); return; }
    advanceCpus(app.state, applyAction);
    await sync(app.state);
    return;
  }

  try {
    const res = await api.action(app.session, action);
    app.room = res.room;
    if (res.rejected) { sfx.error(); ui.toast(res.rejected); }
    if (res.room.game) await sync(res.room.game);
    app.poller?.poke();
  } catch (err) {
    sfx.error();
    ui.toast(err.message);
  }
}

// --- action bar ------------------------------------------------------------

function renderActions() {
  const state = app.state;
  const bar = $('actions');
  bar.textContent = '';
  if (!state) return;

  if (state.phase === 'gameover') {
    addButton(bar, 'Play again', () => location.reload(), { wide: true });
    return;
  }

  const me = viewerId();
  const actor = pendingActor(state);
  const isMe = me && actor === me;
  const p = me ? player(state, me) : null;

  const legal = me ? legalActions(state, me) : [];

  if (!isMe || !p) {
    const waiting = actor ? player(state, actor) : null;
    const note = document.createElement('div');
    note.className = 'hint';
    note.style.margin = '0 0 8px';
    note.style.flexBasis = '100%';
    note.textContent = waiting ? `Waiting for ${waiting.name}…` : 'Waiting…';
    bar.appendChild(note);
    // Trades are legal off-turn, so keep that door open while we wait.
    if (legal.includes('proposeTrade')) {
      addButton(bar, 'Propose a trade', () => openTradeBuilder(), { ghost: true, wide: true });
    }
    return;
  }

  if (legal.includes('roll')) {
    addButton(bar, p.inJail ? 'Roll for doubles' : '🎲 Roll', () => submit({ type: 'roll' }), { wide: true });
  }
  if (legal.includes('payJail')) {
    addButton(bar, `Pay ${money(JAIL_FINE)}`, () => submit({ type: 'payJail' }), { ghost: true });
  }
  if (legal.includes('useJailCard')) {
    addButton(bar, 'Use card', () => submit({ type: 'useJailCard' }), { ghost: true });
  }
  if (legal.includes('endTurn')) {
    addButton(bar, state.canRollAgain ? '🎲 Roll again' : 'End turn', () => submit({ type: 'endTurn' }),
      { wide: !legal.includes('roll') });
  }
  if (legal.includes('buildHouse') || legal.includes('mortgage')) {
    addButton(bar, 'Manage', () => openManage(), { ghost: true });
  }
  if (legal.includes('proposeTrade') && state.players.filter((q) => !q.bankrupt).length > 1) {
    addButton(bar, 'Trade', () => openTradeBuilder(), { ghost: true });
  }
  if (legal.includes('concede')) {
    addButton(bar, 'Declare bankruptcy', () => confirmConcede(), { danger: true, wide: true });
  }
}

function addButton(bar, label, onClick, { ghost, danger, wide, small, disabled } = {}) {
  const b = document.createElement('button');
  b.textContent = label;
  if (ghost) b.classList.add('ghost');
  if (danger) b.classList.add('danger');
  if (wide) b.classList.add('wide');
  if (small) b.classList.add('small');
  b.disabled = !!disabled;
  b.addEventListener('click', () => { sfx.click(); onClick(); });
  bar.appendChild(b);
  return b;
}

// --- prompts ---------------------------------------------------------------

/** Open whatever modal the current phase demands — once per situation. */
function maybePrompt() {
  const state = app.state;
  if (!state) return;
  const me = viewerId();
  const actor = pendingActor(state);

  const key = `${state.phase}:${state.seq}:${actor}:${state.trade ? 'trade' : ''}`;
  if (state.phase === 'gameover') {
    if (app.promptKey !== 'over') { app.promptKey = 'over'; showGameOver(); }
    return;
  }

  if (!me || actor !== me) {
    if (ui.modalIsOpen() && app.promptKey && app.promptKey !== 'manage' && app.promptKey !== 'trade') {
      ui.closeModal();
      app.promptKey = null;
    }
    return;
  }

  if (state.trade && state.trade.to === me) {
    if (app.promptKey !== `trade:${state.seq}`) { app.promptKey = `trade:${state.seq}`; showTradeOffer(); }
    return;
  }
  if (state.phase === 'buy') {
    if (app.promptKey !== key) { app.promptKey = key; showBuyPrompt(); }
    return;
  }
  if (state.phase === 'auction') {
    app.promptKey = key;
    showAuction();
    return;
  }
  if (state.phase === 'debt') {
    if (app.promptKey !== `debt:${state.debt.amount}`) { app.promptKey = `debt:${state.debt.amount}`; showDebt(); }
    return;
  }

  if (ui.modalIsOpen() && app.promptKey && !['manage', 'trade', 'inspect'].includes(app.promptKey)) {
    ui.closeModal();
  }
  app.promptKey = null;
}

function showBuyPrompt() {
  const state = app.state;
  const i = state.pendingBuy;
  const sp = BOARD[i];
  const me = viewerId();
  const cash = player(state, me).cash;

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = `Buy ${sp.name}?`;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = `${money(sp.price)} — you have ${money(cash)}.`;
    modal.append(h, sub, ui.deedCard(state, i));

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    const declineLabel = state.settings.auctions ? 'Send to auction' : 'Pass';
    addButton(acts, declineLabel, () => { ui.closeModal(); submit({ type: 'decline' }); }, { ghost: true });
    addButton(acts, `Buy for ${money(sp.price)}`, () => { ui.closeModal(); submit({ type: 'buy' }); },
      { disabled: cash < sp.price });
    modal.appendChild(acts);

    if (cash < sp.price) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Not enough cash. Mortgage something first, or let it go.';
      modal.appendChild(hint);
    }
  });
}

function showAuction() {
  const state = app.state;
  const a = state.auction;
  const me = viewerId();
  const p = player(state, me);
  const sp = BOARD[a.space];

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = `Auction: ${sp.name}`;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'Highest bid takes it. Pass and you are out of this auction.';
    modal.append(h, sub);

    const disp = document.createElement('div');
    disp.className = 'bid-display';
    const amt = document.createElement('div');
    amt.className = 'amt';
    amt.textContent = a.high > 0 ? money(a.high) : 'No bids';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = a.highBidder
      ? `${player(state, a.highBidder).name} is leading · you have ${money(p.cash)}`
      : `You have ${money(p.cash)}`;
    disp.append(amt, who);
    modal.append(disp, ui.deedCard(state, a.space));

    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(a.high + 1);
    input.max = String(p.cash);
    input.value = String(Math.min(p.cash, Math.max(a.high + 10, Math.round(sp.price * 0.5))));
    input.style.marginTop = '14px';
    modal.appendChild(input);

    const quick = document.createElement('div');
    quick.className = 'quickbids';
    for (const step of [10, 50, 100]) {
      addButton(quick, `+${money(step)}`, () => {
        input.value = String(Math.min(p.cash, (Number(input.value) || a.high) + step));
      }, { ghost: true, disabled: a.high + step > p.cash });
    }
    modal.appendChild(quick);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Pass', () => { ui.closeModal(); submit({ type: 'passBid' }); }, { ghost: true });
    addButton(acts, 'Bid', () => {
      const amount = Number(input.value);
      if (!Number.isFinite(amount) || amount <= a.high) { ui.toast('Bid must beat the current bid.'); return; }
      if (amount > p.cash) { ui.toast('You cannot cover that.'); return; }
      ui.closeModal();
      submit({ type: 'bid', amount });
    }, { disabled: a.high + 1 > p.cash });
    modal.appendChild(acts);
  });
}

function showDebt() {
  const state = app.state;
  const me = viewerId();
  const p = player(state, me);
  const owed = state.debt.amount;
  const raisable = netWorth(state, me);

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = `You owe ${money(owed)}`;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = raisable >= owed
      ? `You have ${money(p.cash)} in cash. Sell buildings or mortgage deeds to cover the rest.`
      : `Everything you own comes to ${money(raisable)} — that is not enough. You are bankrupt.`;
    modal.append(h, sub);

    if (raisable >= owed) {
      modal.appendChild(manageList(state, me, { compact: true }));
    }

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Declare bankruptcy', () => { ui.closeModal(); submit({ type: 'concede' }); }, { danger: true });
    modal.appendChild(acts);
  });
}

function confirmConcede() {
  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Declare bankruptcy?';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'Everything you own goes to your creditor and you are out of the game.';
    modal.append(h, sub);
    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Keep playing', () => { ui.closeModal(); maybePrompt(); }, { ghost: true });
    addButton(acts, 'Bankrupt', () => { ui.closeModal(); submit({ type: 'concede' }); }, { danger: true });
    modal.appendChild(acts);
  });
}

function showGameOver() {
  const state = app.state;
  const w = player(state, state.winner);
  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = w ? `${w.name} wins Emerald City` : 'Game over';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = w ? `Last one standing with ${money(w.cash)} in the bank.` : '';
    modal.append(h, sub);

    const standings = document.createElement('div');
    standings.className = 'manage-list';
    [...state.players]
      .sort((a, b) => (b.bankrupt === a.bankrupt ? netWorth(state, b.id) - netWorth(state, a.id) : a.bankrupt ? 1 : -1))
      .forEach((p, n) => {
        const row = document.createElement('div');
        row.className = 'manage-row';
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = `${n + 1}. ${ui.tokenOf(p.token).emoji} ${p.name}`;
        const val = document.createElement('div');
        val.textContent = p.bankrupt ? 'bankrupt' : money(netWorth(state, p.id));
        row.append(nm, val);
        standings.appendChild(row);
      });
    modal.appendChild(standings);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Back to the start', () => { clearSession(); location.reload(); }, { wide: true });
    modal.appendChild(acts);
  });
}

// --- manage (build / mortgage) --------------------------------------------

function manageList(state, me, { compact = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'manage-list';
  const owned = holdings(state, me);

  if (owned.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'You do not own anything yet.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const i of owned.sort((a, b) => a - b)) {
    const sp = BOARD[i];
    const d = state.deeds[i];
    const row = document.createElement('div');
    row.className = 'manage-row';

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = sp.type === 'prop' ? GROUPS[sp.group].color : 'var(--ink-soft)';

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = sp.name + (d.houses === 5 ? ' · hotel' : d.houses ? ` · ${d.houses}🏠` : '');
    if (d.mortgaged) nm.textContent += ' · mortgaged';

    const buttons = document.createElement('div');
    buttons.className = 'buttons';

    if (!compact && sp.type === 'prop') {
      const blocker = buildBlocker(state, me, i);
      const cost = GROUPS[sp.group].house;
      const btn = addButton(buttons, d.houses === 4 ? `Hotel ${money(cost)}` : `Build ${money(cost)}`,
        () => submit({ type: 'buildHouse', space: i }).then(refreshManage),
        { small: true, disabled: !!blocker });
      if (blocker) btn.title = blocker;
    }

    if (d.houses > 0) {
      addButton(buttons, `Sell ${money(Math.floor(GROUPS[sp.group].house / 2))}`,
        () => submit({ type: 'sellHouse', space: i }).then(refreshManage), { ghost: true, small: true });
    } else if (d.mortgaged) {
      const principal = Math.floor(sp.price / 2);
      const cost = principal + Math.ceil(principal / 10);
      addButton(buttons, `Lift ${money(cost)}`,
        () => submit({ type: 'unmortgage', space: i }).then(refreshManage),
        { ghost: true, small: true, disabled: player(state, me).cash < cost });
    } else {
      addButton(buttons, `Mortgage ${money(Math.floor(sp.price / 2))}`,
        () => submit({ type: 'mortgage', space: i }).then(refreshManage), { ghost: true, small: true });
    }

    row.append(swatch, nm, buttons);
    wrap.appendChild(row);
  }
  return wrap;
}

function refreshManage() {
  if (app.promptKey === 'manage') openManage();
  else if (app.promptKey?.startsWith('debt')) showDebt();
}

function openManage() {
  app.promptKey = 'manage';
  const state = app.state;
  const me = viewerId();
  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Your property';
    const sub = document.createElement('p');
    sub.className = 'sub';
    const sets = Object.keys(GROUPS).filter((g) => ownsGroup(state, me, g));
    sub.textContent = sets.length
      ? `You can build on: ${sets.map((g) => GROUPS[g].name).join(', ')}. Houses go up evenly across a set.`
      : 'Collect every deed in a colour group to start building.';
    modal.append(h, sub, manageList(state, me));

    const bank = document.createElement('p');
    bank.className = 'hint';
    bank.textContent = `Bank supply: ${state.houses} houses, ${state.hotels} hotels.`;
    modal.appendChild(bank);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Done', () => { app.promptKey = null; ui.closeModal(); maybePrompt(); }, { wide: true });
    modal.appendChild(acts);
  });
}

// --- trading ---------------------------------------------------------------

function openTradeBuilder() {
  app.promptKey = 'trade';
  const state = app.state;
  const me = viewerId();
  const others = state.players.filter((p) => !p.bankrupt && p.id !== me);
  if (others.length === 0) { ui.toast('Nobody to trade with.'); return; }

  let partner = others[0].id;
  const give = new Set();
  const get = new Set();

  const render = () => ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Propose a trade';
    modal.appendChild(h);

    const pick = document.createElement('select');
    for (const o of others) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      opt.selected = o.id === partner;
      pick.appendChild(opt);
    }
    pick.addEventListener('change', () => {
      partner = pick.value;
      get.clear();
      render();
    });
    modal.appendChild(pick);

    const cols = document.createElement('div');
    cols.className = 'trade-cols';
    cols.style.marginTop = '14px';
    cols.append(
      tradeColumn(state, me, 'You give', give),
      tradeColumn(state, partner, 'You get', get),
    );
    modal.appendChild(cols);

    const cashRow = document.createElement('div');
    cashRow.className = 'trade-cols';
    cashRow.style.marginTop = '12px';
    const giveCash = labelledNumber('Cash you add', 0, player(state, me).cash);
    const getCash = labelledNumber('Cash they add', 0, player(state, partner).cash);
    cashRow.append(giveCash.wrap, getCash.wrap);
    modal.appendChild(cashRow);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Cancel', () => { app.promptKey = null; ui.closeModal(); maybePrompt(); }, { ghost: true });
    addButton(acts, 'Send offer', () => {
      app.promptKey = null;
      ui.closeModal();
      submit({
        type: 'proposeTrade',
        to: partner,
        give: { cash: Number(giveCash.input.value) || 0, spaces: [...give], jailCards: 0 },
        get: { cash: Number(getCash.input.value) || 0, spaces: [...get], jailCards: 0 },
      });
    });
    modal.appendChild(acts);
  });

  render();
}

function labelledNumber(label, value, max) {
  const wrap = document.createElement('div');
  const l = document.createElement('label');
  l.textContent = label;
  l.style.cssText = 'display:block;font-size:.75rem;font-weight:700;color:var(--ink-soft);margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(max);
  input.value = String(value);
  wrap.append(l, input);
  return { wrap, input };
}

function tradeColumn(state, ownerId, title, selection) {
  const col = document.createElement('div');
  col.className = 'trade-col';
  const h = document.createElement('h4');
  h.textContent = title;
  col.appendChild(h);

  const list = document.createElement('div');
  list.className = 'deed-picks';
  const owned = holdings(state, ownerId);
  if (owned.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.style.margin = '0';
    p.textContent = 'No deeds.';
    list.appendChild(p);
  }
  for (const i of owned) {
    const sp = BOARD[i];
    const hasBuildings = sp.type === 'prop' && GROUP_SPACES[sp.group].some((g) => state.deeds[g].houses > 0);

    const row = document.createElement('label');
    row.className = 'deed-pick' + (selection.has(i) ? ' picked' : '');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selection.has(i);
    box.disabled = hasBuildings;
    box.addEventListener('change', () => {
      if (box.checked) selection.add(i); else selection.delete(i);
      row.classList.toggle('picked', box.checked);
    });

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = sp.type === 'prop' ? GROUPS[sp.group].color : 'var(--ink-soft)';

    const nm = document.createElement('span');
    nm.textContent = sp.name + (hasBuildings ? ' (built up)' : state.deeds[i].mortgaged ? ' (mortgaged)' : '');

    row.append(box, swatch, nm);
    list.appendChild(row);
  }
  col.appendChild(list);
  return col;
}

function showTradeOffer() {
  const state = app.state;
  const t = state.trade;
  const from = player(state, t.from);

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = `${from.name} offers a trade`;
    modal.appendChild(h);

    const cols = document.createElement('div');
    cols.className = 'trade-cols';
    cols.append(
      offerSide('You receive', t.give),
      offerSide('You give up', t.get),
    );
    modal.appendChild(cols);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Decline', () => { ui.closeModal(); submit({ type: 'respondTrade', accept: false }); }, { ghost: true });
    addButton(acts, 'Accept', () => { ui.closeModal(); submit({ type: 'respondTrade', accept: true }); });
    modal.appendChild(acts);
  });

  function offerSide(title, side) {
    const col = document.createElement('div');
    col.className = 'trade-col';
    const h = document.createElement('h4');
    h.textContent = title;
    col.appendChild(h);
    const list = document.createElement('div');
    list.className = 'deed-picks';
    if (side.cash > 0) {
      const row = document.createElement('div');
      row.className = 'deed-pick';
      row.textContent = money(side.cash);
      list.appendChild(row);
    }
    for (const i of side.spaces) {
      const row = document.createElement('div');
      row.className = 'deed-pick';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      const sp = BOARD[i];
      swatch.style.background = sp.type === 'prop' ? GROUPS[sp.group].color : 'var(--ink-soft)';
      const nm = document.createElement('span');
      nm.textContent = sp.name;
      row.append(swatch, nm);
      list.appendChild(row);
    }
    if (!side.cash && side.spaces.length === 0) {
      const row = document.createElement('div');
      row.className = 'hint';
      row.style.margin = '0';
      row.textContent = 'Nothing';
      list.appendChild(row);
    }
    col.appendChild(list);
    return col;
  }
}

// --- inspector -------------------------------------------------------------

function inspectPlayer(playerId) {
  const state = app.state;
  const p = player(state, playerId);
  if (!p) return;
  const prev = app.promptKey;
  app.promptKey = 'inspect';

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = `${ui.tokenOf(p.token).emoji} ${p.name}`;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = p.bankrupt
      ? 'Out of the game.'
      : `${money(p.cash)} in cash · ${money(netWorth(state, playerId))} all in${p.inJail ? ' · in gridlock' : ''}`;
    modal.append(h, sub);

    const list = document.createElement('div');
    list.className = 'manage-list';
    const owned = holdings(state, playerId);
    if (owned.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No property.';
      list.appendChild(empty);
    }
    for (const i of owned) {
      const sp = BOARD[i];
      const d = state.deeds[i];
      const row = document.createElement('div');
      row.className = 'manage-row';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = sp.type === 'prop' ? GROUPS[sp.group].color : 'var(--ink-soft)';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = sp.name + (d.houses === 5 ? ' · hotel' : d.houses ? ` · ${d.houses} houses` : '') + (d.mortgaged ? ' · mortgaged' : '');
      row.append(swatch, nm);
      list.appendChild(row);
    }
    modal.appendChild(list);

    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Close', () => {
      app.promptKey = prev === 'inspect' ? null : prev;
      ui.closeModal();
      maybePrompt();
    }, { wide: true });
    modal.appendChild(acts);
  });
}

// --- wiring ----------------------------------------------------------------

function init() {
  initTheme();
  initSound();
  buildTokenPicker();
  ui.buildBoard();

  const savedName = localStorage.getItem('emeraldcity.name');
  if (savedName) $('nameInput').value = savedName;
  $('nameInput').addEventListener('change', () => localStorage.setItem('emeraldcity.name', myName()));

  $('themeBtn').addEventListener('click', toggleTheme);
  $('soundBtn').addEventListener('click', toggleSound);
  document.addEventListener('pointerdown', unlock, { once: true });

  $('hostBtn').addEventListener('click', () => { sfx.click(); hostOnline(); });
  $('joinBtn').addEventListener('click', () => { sfx.click(); joinOnline(); });
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinOnline(); });
  $('soloBtn').addEventListener('click', () => { sfx.click(); askSoloSize(); });
  $('passBtn').addEventListener('click', () => { sfx.click(); askPassAndPlaySize(); });

  $('addCpuBtn').addEventListener('click', async () => {
    try {
      const res = await api.addCpu(app.session);
      app.room = res.room;
      renderLobby();
    } catch (err) { ui.toast(err.message); }
  });

  $('startBtn').addEventListener('click', async () => {
    try {
      $('startBtn').disabled = true;
      const res = await api.start(app.session, houseRules());
      app.room = res.room;
      showView('viewGame');
      await sync(res.room.game);
    } catch (err) {
      ui.toast(err.message);
      $('startBtn').disabled = false;
    }
  });

  $('leaveLobbyBtn').addEventListener('click', () => {
    app.poller?.stop();
    clearSession();
    location.reload();
  });

  $('roomCode').addEventListener('click', () => {
    if (!app.session) return;
    navigator.clipboard?.writeText(app.session.code).then(
      () => ui.toast('Room code copied.'),
      () => {},
    );
  });

  $('modalBack').addEventListener('click', (e) => {
    // Click-outside closes only the modals that are safe to dismiss.
    if (e.target !== $('modalBack')) return;
    if (['manage', 'trade', 'inspect'].includes(app.promptKey)) {
      app.promptKey = null;
      ui.closeModal();
      maybePrompt();
    }
  });

  window.addEventListener('resize', () => { if (app.state) ui.placeTokens(app.state); });

  // Reconnect to a game this browser was already in.
  const saved = loadSession();
  if (saved?.code) offerReconnect(saved);
}

function askSoloSize() {
  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Play the CPU';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'How many computer opponents?';
    modal.append(h, sub);
    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    for (const n of [1, 2, 3, 4]) {
      addButton(acts, String(n), () => { ui.closeModal(); startLocal({ humans: 1, cpus: n }); }, { ghost: n !== 2 });
    }
    modal.appendChild(acts);
  });
}

function askPassAndPlaySize() {
  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Pass & play';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'Everyone shares this screen. How many players?';
    modal.append(h, sub);
    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    acts.style.flexWrap = 'wrap';
    for (const n of [2, 3, 4, 5, 6]) {
      addButton(acts, String(n), () => { ui.closeModal(); startLocal({ humans: n, cpus: 0 }); }, { ghost: n !== 5 });
    }
    modal.appendChild(acts);
  });
}

async function offerReconnect(saved) {
  let room;
  try {
    ({ room } = await api.state(saved.code));
  } catch {
    clearSession();
    return;
  }
  if (!room || !room.seats.some((s) => s.id === saved.playerId)) { clearSession(); return; }

  ui.openModal((modal) => {
    const h = document.createElement('h2');
    h.textContent = 'Rejoin your game?';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = `You were in room ${saved.code} with ${room.seats.length} player${room.seats.length === 1 ? '' : 's'}.`;
    modal.append(h, sub);
    const acts = document.createElement('div');
    acts.className = 'modal-actions';
    addButton(acts, 'Start fresh', () => { clearSession(); ui.closeModal(); }, { ghost: true });
    addButton(acts, 'Rejoin', async () => {
      ui.closeModal();
      app.mode = 'online';
      app.session = saved;
      app.room = room;
      if (room.started && room.game) {
        $('roomCode').hidden = false;
        $('roomCode').textContent = saved.code;
        showView('viewGame');
        app.poller?.stop();
        app.poller = new RoomPoller(saved.code, async (r) => {
          app.room = r;
          if (r.game) await sync(r.game);
        }, () => {});
        app.poller.start();
        await sync(room.game);
      } else {
        enterLobby();
      }
    });
    modal.appendChild(acts);
  });
}

document.addEventListener('DOMContentLoaded', init);
