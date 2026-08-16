// CPU opponents.
//
// `cpuAction` returns the single next action a bot wants to take, or null when
// it is done thinking. Callers loop until they get null or a turn-ending
// action. Everything here is a deterministic function of game state — no
// randomness — so a replay of the same game plays out identically.

import {
  BOARD, GROUPS, GROUP_SPACES, RAIL_SPACES, UTIL_SPACES, JAIL_FINE,
} from './board.js';
import {
  player, current, holdings, ownsGroup, netWorth, buildBlocker, rentFor, activePlayers,
} from './engine.js';

// Cash a bot likes to keep in hand, so it isn't bankrupted by one bad landing.
function reserve(state, p) {
  const opponents = activePlayers(state).filter((o) => o.id !== p.id);
  // Roughly the worst rent currently on the board that could hit us.
  let worst = 50;
  for (const o of opponents) {
    for (const i of holdings(state, o.id)) {
      const r = rentFor(state, i, 7);
      if (r > worst) worst = r;
    }
  }
  return Math.min(600, Math.round(worst * 1.2));
}

/** What a deed is worth to a particular player, given what they already hold. */
export function spaceValue(state, i, forPlayer) {
  const sp = BOARD[i];
  if (!sp || !sp.price) return 0;
  let v = sp.price;

  if (sp.type === 'prop') {
    const grp = GROUP_SPACES[sp.group];
    const mine = grp.filter((g) => state.deeds[g].owner === forPlayer).length;
    const rivals = grp.filter((g) => {
      const o = state.deeds[g].owner;
      return o !== null && o !== forPlayer;
    }).length;

    if (mine === grp.length - 1) v *= 2.4;      // this deed completes the set
    else if (mine > 0) v *= 1.35;
    if (rivals > 0) v *= mine > 0 ? 0.9 : 0.7;  // a contested group is worth less
    // The oranges and reds get landed on most — just past the jail square.
    if (sp.group === 'canal' || sp.group === 'west') v *= 1.2;
    if (sp.group === 'waterfront') v *= 1.1;
  } else if (sp.type === 'rail') {
    const own = RAIL_SPACES.filter((r) => state.deeds[r].owner === forPlayer).length;
    v *= 1 + own * 0.3;
  } else if (sp.type === 'utility') {
    const own = UTIL_SPACES.filter((r) => state.deeds[r].owner === forPlayer).length;
    v *= own > 0 ? 1.1 : 0.75;
  }
  return Math.round(v);
}

/** Deeds a bot is happiest to mortgage first — least useful ones lead. */
function mortgageOrder(state, p) {
  return holdings(state, p.id)
    .filter((i) => !state.deeds[i].mortgaged && state.deeds[i].houses === 0)
    .sort((a, b) => spaceValue(state, a, p.id) - spaceValue(state, b, p.id));
}

/** Buildings a bot will break up last — highest-value groups protected. */
function sellOrder(state, p) {
  return holdings(state, p.id)
    .filter((i) => state.deeds[i].houses > 0)
    .sort((a, b) => {
      const ga = Math.max(...GROUP_SPACES[BOARD[a].group].map((g) => state.deeds[g].houses));
      const gb = Math.max(...GROUP_SPACES[BOARD[b].group].map((g) => state.deeds[g].houses));
      // Sell from the group with the most buildings first (even-build safe),
      // preferring cheaper groups.
      if (gb !== ga) return gb - ga;
      return BOARD[a].price - BOARD[b].price;
    });
}

function groupsOwned(state, playerId) {
  return Object.keys(GROUPS).filter((g) => ownsGroup(state, playerId, g));
}

// --- the decision --------------------------------------------------------

export function cpuAction(state, playerId) {
  const p = player(state, playerId);
  if (!p || !p.isCPU || p.bankrupt || state.phase === 'gameover') return null;

  // 1. A trade is waiting on us.
  if (state.trade && state.trade.to === playerId) {
    return { type: 'respondTrade', accept: evaluateTrade(state, playerId) };
  }
  // Don't leave our own stale offer sitting there once our turn is over.
  if (state.trade && state.trade.from === playerId && current(state)?.id !== playerId) {
    return { type: 'respondTrade', accept: false };
  }

  // 2. Auctions.
  if (state.phase === 'auction') {
    if (state.auction.order[state.auction.turnIdx] !== playerId) return null;
    const worth = spaceValue(state, state.auction.space, playerId);
    const ceiling = Math.min(p.cash, Math.round(worth * 0.9));
    const next = state.auction.high + Math.max(5, Math.round(worth * 0.05));
    if (next > ceiling) return { type: 'passBid' };
    return { type: 'bid', amount: next };
  }

  // 3. We owe money.
  if (state.phase === 'debt') {
    if (state.debt.debtor !== playerId) return null;
    const need = state.debt.amount - p.cash;
    const canRaise = netWorth(state, playerId) - p.cash;
    if (canRaise < need) return { type: 'concede' };
    const m = mortgageOrder(state, p);
    if (m.length) return { type: 'mortgage', space: m[0] };
    const s = sellOrder(state, p);
    if (s.length) return { type: 'sellHouse', space: s[0] };
    return { type: 'concede' };
  }

  if (current(state)?.id !== playerId) return null;

  // 4. Something is for sale.
  if (state.phase === 'buy') {
    const i = state.pendingBuy;
    const price = BOARD[i].price;
    if (p.cash < price) return { type: 'decline' };
    const worth = spaceValue(state, i, playerId);
    const after = p.cash - price;
    // Always take a deed that completes a set if we can survive the hit.
    const completes = BOARD[i].type === 'prop'
      && GROUP_SPACES[BOARD[i].group].filter((g) => state.deeds[g].owner === playerId).length
         === GROUP_SPACES[BOARD[i].group].length - 1;
    if (completes && after >= 0) return { type: 'buy' };
    if (worth >= price && after >= reserve(state, p)) return { type: 'buy' };
    // Early on, grabbing anything unowned is usually right.
    if (state.round < 12 && after >= reserve(state, p) * 0.6) return { type: 'buy' };
    return { type: 'decline' };
  }

  // 5. Jail.
  if (state.phase === 'preroll' && p.inJail) {
    // Late in the game, sitting in gridlock is safer than walking into rent.
    const dangerous = activePlayers(state).some((o) => o.id !== playerId && groupsOwned(state, o.id).length > 0);
    if (p.jailCards > 0 && !dangerous) return { type: 'useJailCard' };
    if (!dangerous && p.cash > JAIL_FINE + reserve(state, p)) return { type: 'payJail' };
    return { type: 'roll' };
  }

  // 6. Development, then move on.
  if (state.phase === 'preroll' || state.phase === 'end') {
    const build = bestBuild(state, p);
    if (build !== null) return { type: 'buildHouse', space: build };

    const lift = bestUnmortgage(state, p);
    if (lift !== null) return { type: 'unmortgage', space: lift };

    const trade = proposeTrade(state, p);
    if (trade) return trade;

    if (state.phase === 'preroll') return { type: 'roll' };
    return { type: 'endTurn' };
  }

  return null;
}

function bestBuild(state, p) {
  const spare = p.cash - reserve(state, p);
  if (spare <= 0) return null;
  let best = null, bestScore = -Infinity;

  for (const g of groupsOwned(state, p.id)) {
    for (const i of GROUP_SPACES[g]) {
      if (buildBlocker(state, p.id, i) !== null) continue;
      const cost = GROUPS[g].house;
      if (cost > spare) continue;
      const d = state.deeds[i];
      // Rent jumps hardest going from two houses to three.
      const gain = BOARD[i].rent[d.houses + 1] - BOARD[i].rent[d.houses];
      const score = gain / cost;
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return best;
}

function bestUnmortgage(state, p) {
  const spare = p.cash - reserve(state, p) * 2;
  if (spare <= 0) return null;
  for (const i of holdings(state, p.id)) {
    if (!state.deeds[i].mortgaged) continue;
    const principal = Math.floor(BOARD[i].price / 2);
    const cost = principal + Math.ceil(principal / 10);
    if (cost <= spare) return i;
  }
  return null;
}

// --- trading -------------------------------------------------------------

/** Total value of one side of a trade, from `viewer`'s perspective. */
function sideValue(state, side, viewer) {
  let v = side.cash || 0;
  for (const i of side.spaces || []) v += spaceValue(state, i, viewer);
  v += (side.jailCards || 0) * 50;
  return v;
}

function evaluateTrade(state, playerId) {
  const t = state.trade;
  const p = player(state, playerId);
  // What we receive vs what we give, both priced for us.
  const incoming = sideValue(state, t.give, playerId);
  const outgoing = sideValue(state, t.get, playerId);

  // Never trade away a deed that hands someone else a monopoly, unless the
  // premium is large.
  let enablesRival = false;
  for (const i of t.get.spaces || []) {
    const sp = BOARD[i];
    if (sp.type !== 'prop') continue;
    const grp = GROUP_SPACES[sp.group];
    const theirs = grp.filter((g) => state.deeds[g].owner === t.from).length;
    if (theirs === grp.length - 1) enablesRival = true;
  }

  if (t.get.cash > p.cash) return false;
  const bar = enablesRival ? outgoing * 1.8 : outgoing * 1.05;
  return incoming >= bar;
}

function proposeTrade(state, p) {
  // One proposal per player per turn keeps the table from thrashing.
  if (state.trade) return null;
  if (p.lastProposeRound === state.round) return null;

  for (const g of Object.keys(GROUPS)) {
    const grp = GROUP_SPACES[g];
    const mine = grp.filter((i) => state.deeds[i].owner === p.id);
    if (mine.length !== grp.length - 1) continue;

    const missing = grp.find((i) => state.deeds[i].owner !== p.id);
    const ownerId = state.deeds[missing].owner;
    if (!ownerId) continue;                       // still unowned, just land on it
    if (state.deeds[missing].houses > 0) continue;
    const owner = player(state, ownerId);
    if (!owner || owner.bankrupt) continue;
    // Don't ask for the last piece of someone else's set.
    if (ownsGroup(state, ownerId, g)) continue;

    // Offer a healthy cash premium — bots overpay to complete sets, as they should.
    const price = BOARD[missing].price;
    const offer = Math.round(price * 1.6);
    if (offer > p.cash - reserve(state, p)) continue;

    p.lastProposeRound = state.round;
    return {
      type: 'proposeTrade',
      to: ownerId,
      give: { cash: offer, spaces: [], jailCards: 0 },
      get: { cash: 0, spaces: [missing], jailCards: 0 },
    };
  }
  return null;
}

/**
 * Run a bot's whole turn. Returns the number of actions taken.
 * `apply` is the caller's action applier, so this works client-side (local
 * games) and server-side (online games) unchanged.
 */
export function runCpuTurn(state, playerId, apply, maxSteps = 40) {
  let steps = 0;
  while (steps < maxSteps) {
    const action = cpuAction(state, playerId);
    if (!action) break;
    const res = apply(state, playerId, action);
    steps++;
    if (!res || !res.ok) {
      // A bot asked for something illegal — fall back to the safest way to
      // keep the game moving rather than spinning on a rejected action.
      if (state.phase === 'debt' && state.debt.debtor === playerId) apply(state, playerId, { type: 'concede' });
      else if (state.phase === 'auction') apply(state, playerId, { type: 'passBid' });
      else if (state.phase === 'buy') apply(state, playerId, { type: 'decline' });
      else if (state.phase === 'preroll') apply(state, playerId, { type: 'roll' });
      else if (state.phase === 'end') apply(state, playerId, { type: 'endTurn' });
      else break;
      steps++;
      continue;
    }
    if (action.type === 'endTurn') break;
    // After rolling we keep going: the bot may need to buy, bid, or settle.
    if (current(state)?.id !== playerId && state.phase !== 'auction' && state.phase !== 'debt') break;
  }
  return steps;
}

/** Whoever the engine is currently waiting on, bot or human. */
export function pendingActor(state) {
  if (!state || state.phase === 'gameover') return null;
  if (state.phase === 'auction') return state.auction.order[state.auction.turnIdx];
  if (state.phase === 'debt') return state.debt.debtor;
  if (state.trade && state.trade.to) return state.trade.to;
  return current(state)?.id ?? null;
}

/**
 * Let every CPU that owes a decision take it, stopping as soon as a human is
 * on the clock. Shared by the browser (local games) and the server (online).
 */
export function advanceCpus(state, apply, cap = 400) {
  let steps = 0;
  while (steps < cap && state.phase !== 'gameover') {
    const actor = pendingActor(state);
    const p = actor ? player(state, actor) : null;
    if (!p || !p.isCPU) break;

    const before = state.seq;
    steps += runCpuTurn(state, actor, apply);
    if (state.seq === before) break; // no progress — don't spin
  }
  return steps;
}
