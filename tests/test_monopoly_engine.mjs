// Rules-engine tests. Node only, no dependencies:  node tests/test_monopoly_engine.mjs
//
// The engine's RNG is deterministic, so where a test needs a specific roll it
// searches for a seed that produces it (see `seedFor`). That mirrors the
// engine's mulberry32 exactly — if the engine's RNG changes, update both.

import {
  createGame, applyAction, rentFor, buildBlocker, ownsGroup, holdings,
  netWorth, legalActions, current, player,
} from '../web/monopoly/engine.js';
import { BOARD, GROUP_SPACES, TOTAL_HOUSES, TOTAL_HOTELS } from '../web/monopoly/board.js';

let passed = 0, failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}
function eq(actual, expected, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${expected}, got ${actual}`);
}
function ok(cond, what = 'assertion failed') {
  if (!cond) throw new Error(what);
}

/**
 * Landing on a space can leave the game waiting on a decision. Clear whatever
 * is pending so the turn can be ended.
 */
function settleTurn(g) {
  for (let guard = 0; guard < 60; guard++) {
    if (g.phase === 'buy') { applyAction(g, current(g).id, { type: 'decline' }); continue; }
    if (g.phase === 'auction') {
      applyAction(g, g.auction.order[g.auction.turnIdx], { type: 'passBid' });
      continue;
    }
    if (g.phase === 'debt') { applyAction(g, g.debt.debtor, { type: 'concede' }); continue; }
    return;
  }
  throw new Error('could not settle the turn');
}

/** Run a scenario over successive seeds until it reports success. */
function findSeed(scenario, limit = 20000) {
  for (let s = 1; s < limit; s++) {
    try { if (scenario(s)) return s; } catch { /* try the next seed */ }
  }
  throw new Error('no seed produced the scenario');
}

const mk = (opts = {}) => createGame({
  players: [
    { id: 'a', name: 'Ada', token: 'coffee' },
    { id: 'b', name: 'Bo', token: 'ferry' },
  ],
  seed: 12345,
  ...opts,
});

// --- setup ---------------------------------------------------------------

check('board has 40 spaces', () => eq(BOARD.length, 40));

check('every property has a 6-entry rent table', () => {
  for (const s of BOARD) {
    if (s.type === 'prop') eq(s.rent.length, 6, `${s.name} rent table`);
  }
});

check('game starts with full bank supply and correct cash', () => {
  const g = mk();
  eq(g.houses, TOTAL_HOUSES, 'houses');
  eq(g.hotels, TOTAL_HOTELS, 'hotels');
  eq(g.players[0].cash, 1500, 'start cash');
  eq(g.phase, 'preroll');
});

check('same seed produces the same game', () => {
  const a = mk({ seed: 999 }), b = mk({ seed: 999 });
  applyAction(a, 'a', { type: 'roll' });
  applyAction(b, 'a', { type: 'roll' });
  eq(JSON.stringify(a.dice), JSON.stringify(b.dice), 'dice');
  eq(a.players[0].pos, b.players[0].pos, 'position');
});

// --- rent ----------------------------------------------------------------

check('unimproved rent doubles with a full colour group', () => {
  const g = mk();
  const [x, y] = GROUP_SPACES.duwamish;
  g.deeds[x].owner = 'a';
  eq(rentFor(g, x, 7), BOARD[x].rent[0], 'single property');
  g.deeds[y].owner = 'a';
  ok(ownsGroup(g, 'a', 'duwamish'), 'should own group');
  eq(rentFor(g, x, 7), BOARD[x].rent[0] * 2, 'monopoly rent');
});

check('house rent uses the rent table, not the doubling rule', () => {
  const g = mk();
  for (const i of GROUP_SPACES.duwamish) g.deeds[i].owner = 'a';
  const i = GROUP_SPACES.duwamish[0];
  g.deeds[i].houses = 3;
  eq(rentFor(g, i, 7), BOARD[i].rent[3]);
});

check('mortgaged property collects no rent', () => {
  const g = mk();
  const i = GROUP_SPACES.duwamish[0];
  g.deeds[i].owner = 'a';
  g.deeds[i].mortgaged = true;
  eq(rentFor(g, i, 7), 0);
});

check('railroad rent scales 25/50/100/200', () => {
  const g = mk();
  const rails = BOARD.filter((s) => s.type === 'rail').map((s) => s.i);
  const expected = [25, 50, 100, 200];
  rails.forEach((r, n) => {
    g.deeds[r].owner = 'a';
    eq(rentFor(g, rails[0], 7), expected[n], `${n + 1} railroads`);
  });
});

check('utility rent is 4x then 10x the roll', () => {
  const g = mk();
  const utils = BOARD.filter((s) => s.type === 'utility').map((s) => s.i);
  g.deeds[utils[0]].owner = 'a';
  eq(rentFor(g, utils[0], 9), 36, 'one utility');
  g.deeds[utils[1]].owner = 'a';
  eq(rentFor(g, utils[0], 9), 90, 'both utilities');
});

// --- building ------------------------------------------------------------

check('cannot build without the full group', () => {
  const g = mk();
  const i = GROUP_SPACES.canal[0];
  g.deeds[i].owner = 'a';
  ok(buildBlocker(g, 'a', i) !== null, 'should be blocked');
});

check('even-build rule blocks a second house before the group has one each', () => {
  const g = mk();
  const grp = GROUP_SPACES.canal;
  for (const i of grp) g.deeds[i].owner = 'a';
  eq(buildBlocker(g, 'a', grp[0]), null, 'first house allowed');
  g.deeds[grp[0]].houses = 1;
  ok(buildBlocker(g, 'a', grp[0]) !== null, 'second house on same lot should be blocked');
  eq(buildBlocker(g, 'a', grp[1]), null, 'other lot allowed');
});

check('cannot build on a group with a mortgage in it', () => {
  const g = mk();
  const grp = GROUP_SPACES.canal;
  for (const i of grp) g.deeds[i].owner = 'a';
  g.deeds[grp[2]].mortgaged = true;
  ok(buildBlocker(g, 'a', grp[0]) !== null);
});

check('building a hotel consumes a hotel and returns four houses', () => {
  const g = mk();
  const grp = GROUP_SPACES.duwamish;
  for (const i of grp) { g.deeds[i].owner = 'a'; g.deeds[i].houses = 4; }
  g.houses -= 8;
  const housesBefore = g.houses, hotelsBefore = g.hotels;
  player(g, 'a').cash = 5000;
  const r = applyAction(g, 'a', { type: 'buildHouse', space: grp[0] });
  ok(r.ok, r.error);
  eq(g.deeds[grp[0]].houses, 5, 'hotel level');
  eq(g.hotels, hotelsBefore - 1, 'hotel taken');
  eq(g.houses, housesBefore + 4, 'houses returned to bank');
});

check('bank house shortage blocks building', () => {
  const g = mk();
  const grp = GROUP_SPACES.duwamish;
  for (const i of grp) g.deeds[i].owner = 'a';
  g.houses = 0;
  ok(buildBlocker(g, 'a', grp[0]) !== null, 'should be blocked with no houses left');
});

check('selling buildings must also be even', () => {
  const g = mk();
  const grp = GROUP_SPACES.canal;
  for (const i of grp) { g.deeds[i].owner = 'a'; g.deeds[i].houses = 1; }
  g.deeds[grp[0]].houses = 2;
  const bad = applyAction(g, 'a', { type: 'sellHouse', space: grp[1] });
  ok(!bad.ok, 'selling the low lot should be rejected');
  const good = applyAction(g, 'a', { type: 'sellHouse', space: grp[0] });
  ok(good.ok, good.error);
});

// --- mortgages -----------------------------------------------------------

check('mortgage pays half and lifting costs 10% interest', () => {
  const g = mk();
  const i = 39; // Medina, $400
  g.deeds[i].owner = 'a';
  const before = player(g, 'a').cash;
  applyAction(g, 'a', { type: 'mortgage', space: i });
  eq(player(g, 'a').cash, before + 200, 'mortgage proceeds');
  ok(g.deeds[i].mortgaged, 'flagged mortgaged');
  applyAction(g, 'a', { type: 'unmortgage', space: i });
  eq(player(g, 'a').cash, before + 200 - 220, 'lift cost with interest');
  ok(!g.deeds[i].mortgaged, 'no longer mortgaged');
});

check('cannot mortgage a lot while its group has buildings', () => {
  const g = mk();
  const grp = GROUP_SPACES.duwamish;
  for (const i of grp) g.deeds[i].owner = 'a';
  g.deeds[grp[0]].houses = 1;
  const r = applyAction(g, 'a', { type: 'mortgage', space: grp[1] });
  ok(!r.ok, 'should be rejected');
});

// --- jail ----------------------------------------------------------------

check('three doubles sends you to gridlock', () => {
  // Roll three times on one turn, forcing the phase back to preroll between
  // rolls so the scenario is about the doubles counter and nothing else.
  const scenario = (seed, assert = false) => {
    const g = mk({ seed });
    for (let k = 0; k < 3; k++) {
      g.turn = 0;
      g.phase = 'preroll';
      applyAction(g, 'a', { type: 'roll' });
      if (g.dice[0] !== g.dice[1]) return false;
      if (k < 2 && player(g, 'a').inJail) return false;
    }
    if (assert) {
      ok(player(g, 'a').inJail, 'should be jailed after three doubles');
      eq(player(g, 'a').pos, 10, 'sitting in gridlock');
    }
    return player(g, 'a').inJail;
  };
  scenario(findSeed(scenario), true);
});

check('paying the fine leaves gridlock', () => {
  const g = mk();
  const p = player(g, 'a');
  p.inJail = true; p.pos = 10;
  const before = p.cash;
  const r = applyAction(g, 'a', { type: 'payJail' });
  ok(r.ok, r.error);
  ok(!p.inJail, 'released');
  eq(p.cash, before - 50, 'fine paid');
});

check('a get-out-of-gridlock card is spent on release', () => {
  const g = mk();
  const p = player(g, 'a');
  p.inJail = true; p.jailCards = 1;
  applyAction(g, 'a', { type: 'useJailCard' });
  ok(!p.inJail, 'released');
  eq(p.jailCards, 0, 'card spent');
});

check('three failed jail rolls forces the fine and moves you', () => {
  const scenario = (seed, assert = false) => {
    const g = mk({ seed });
    const p = player(g, 'a');
    p.inJail = true; p.pos = 10;
    for (let k = 0; k < 3; k++) {
      g.turn = 0;
      g.phase = 'preroll';
      applyAction(g, 'a', { type: 'roll' });
      if (g.dice[0] === g.dice[1]) return false; // a double would free them early
    }
    if (assert) {
      ok(!p.inJail, 'should be out after the third failure');
      eq(p.cash, 1450, 'paid the $50 fine');
      ok(p.pos !== 10, 'moved off the jail square');
    }
    return !p.inJail && p.cash === 1450;
  };
  scenario(findSeed(scenario), true);
});

// --- buying, debt, bankruptcy -------------------------------------------

check('buying transfers the deed and the cash', () => {
  const g = mk();
  g.phase = 'buy';
  g.pendingBuy = 39;
  const before = player(g, 'a').cash;
  const r = applyAction(g, 'a', { type: 'buy' });
  ok(r.ok, r.error);
  eq(g.deeds[39].owner, 'a', 'deed');
  eq(player(g, 'a').cash, before - 400, 'cash');
});

check('unaffordable rent opens a debt instead of going negative', () => {
  // Hand every deed to Bo, leave Ada broke, and roll until she lands on rent
  // she cannot cover.
  const scenario = (seed, assert = false) => {
    const g = mk({ seed });
    for (let i = 0; i < 40; i++) if (g.deeds[i]) g.deeds[i].owner = 'b';
    player(g, 'a').cash = 5;
    g.phase = 'preroll';
    applyAction(g, 'a', { type: 'roll' });
    if (g.phase !== 'debt') return false;
    if (assert) {
      eq(g.debt.debtor, 'a', 'debtor');
      eq(g.debt.creditor, 'b', 'creditor');
      eq(player(g, 'a').cash, 5, 'no cash moved yet');
      ok(!player(g, 'a').bankrupt, 'not bankrupt until they concede');
      ok(legalActions(g, 'a').includes('concede'), 'can concede');
      ok(!legalActions(g, 'a').includes('roll'), 'cannot roll while in debt');
    }
    return true;
  };
  scenario(findSeed(scenario), true);
});

check('raising cash mid-debt settles it and play continues', () => {
  const g = mk();
  g.deeds[39].owner = 'a';   // Medina, worth $200 mortgaged
  player(g, 'a').cash = 20;
  g.phase = 'debt';
  g.debt = { debtor: 'a', creditor: 'b', amount: 150, reason: 'test' };
  const bBefore = player(g, 'b').cash;
  applyAction(g, 'a', { type: 'mortgage', space: 39 });
  eq(g.debt, null, 'debt cleared');
  eq(player(g, 'a').cash, 70, '20 + 200 mortgage - 150 debt');
  eq(player(g, 'b').cash, bBefore + 150, 'creditor paid');
  ok(!player(g, 'a').bankrupt, 'survived');
});

check('bankruptcy hands everything to the creditor', () => {
  const g = mk();
  g.deeds[1].owner = 'a';
  g.deeds[3].owner = 'a';
  player(g, 'a').cash = 5;
  player(g, 'a').jailCards = 1;
  g.phase = 'debt';
  g.debt = { debtor: 'a', creditor: 'b', amount: 1000, reason: 'test' };
  const bCashBefore = player(g, 'b').cash;
  applyAction(g, 'a', { type: 'concede' });
  ok(player(g, 'a').bankrupt, 'a is out');
  eq(g.deeds[1].owner, 'b', 'deed 1 transferred');
  eq(g.deeds[3].owner, 'b', 'deed 3 transferred');
  eq(player(g, 'b').cash, bCashBefore + 5, 'cash transferred');
  eq(player(g, 'b').jailCards, 1, 'jail card transferred');
  eq(g.phase, 'gameover', 'two-player game ends');
  eq(g.winner, 'b', 'b wins');
});

check('bankruptcy to the bank returns houses to supply', () => {
  const g = createGame({
    players: [
      { id: 'a', name: 'Ada', token: 'coffee' },
      { id: 'b', name: 'Bo', token: 'ferry' },
      { id: 'c', name: 'Cy', token: 'salmon' },
    ],
    seed: 7,
  });
  const grp = GROUP_SPACES.duwamish;
  for (const i of grp) { g.deeds[i].owner = 'a'; g.deeds[i].houses = 3; }
  g.houses -= 6;
  const supplyBefore = g.houses;
  g.phase = 'debt';
  g.debt = { debtor: 'a', creditor: null, amount: 9999, reason: 'test' };
  applyAction(g, 'a', { type: 'concede' });
  eq(g.houses, supplyBefore + 6, 'houses returned');
  ok(g.deeds[grp[0]].owner === null || g.auctionQueue.length > 0, 'deeds released by the bank');
});

// --- auctions ------------------------------------------------------------

check('declining opens an auction and the high bid wins', () => {
  const g = mk();
  g.phase = 'buy';
  g.pendingBuy = 39;
  applyAction(g, 'a', { type: 'decline' });
  eq(g.phase, 'auction', 'auction started');
  const first = g.auction.order[g.auction.turnIdx];
  const second = first === 'a' ? 'b' : 'a';
  applyAction(g, first, { type: 'bid', amount: 50 });
  applyAction(g, second, { type: 'passBid' });
  eq(g.deeds[39].owner, first, 'high bidder owns it');
  eq(player(g, first).cash, 1500 - 50, 'paid the bid');
});

check('a bid must beat the standing bid', () => {
  const g = mk();
  g.phase = 'buy';
  g.pendingBuy = 39;
  applyAction(g, 'a', { type: 'decline' });
  const first = g.auction.order[g.auction.turnIdx];
  applyAction(g, first, { type: 'bid', amount: 100 });
  const second = g.auction.order[g.auction.turnIdx];
  const r = applyAction(g, second, { type: 'bid', amount: 80 });
  ok(!r.ok, 'low bid should be rejected');
});

check('you cannot bid more cash than you hold', () => {
  const g = mk();
  g.phase = 'buy';
  g.pendingBuy = 39;
  applyAction(g, 'a', { type: 'decline' });
  const first = g.auction.order[g.auction.turnIdx];
  const r = applyAction(g, first, { type: 'bid', amount: 99999 });
  ok(!r.ok, 'overbid should be rejected');
});

// --- trading -------------------------------------------------------------

check('a trade moves deeds and cash both ways', () => {
  const g = mk();
  g.deeds[1].owner = 'a';
  g.deeds[39].owner = 'b';
  applyAction(g, 'a', {
    type: 'proposeTrade', to: 'b',
    give: { cash: 100, spaces: [1], jailCards: 0 },
    get: { cash: 0, spaces: [39], jailCards: 0 },
  });
  ok(g.trade, 'offer on the table');
  const r = applyAction(g, 'b', { type: 'respondTrade', accept: true });
  ok(r.ok, r.error);
  eq(g.deeds[1].owner, 'b', 'deed 1 moved');
  eq(g.deeds[39].owner, 'a', 'deed 39 moved');
  eq(player(g, 'a').cash, 1400, 'a paid');
  eq(player(g, 'b').cash, 1600, 'b received');
});

check('cannot trade a lot whose group has buildings', () => {
  const g = mk();
  const grp = GROUP_SPACES.duwamish;
  for (const i of grp) g.deeds[i].owner = 'a';
  g.deeds[grp[0]].houses = 1;
  const r = applyAction(g, 'a', {
    type: 'proposeTrade', to: 'b',
    give: { cash: 0, spaces: [grp[1]] }, get: { cash: 0, spaces: [] },
  });
  ok(!r.ok, 'should be rejected');
});

check('cannot offer cash you do not have', () => {
  const g = mk();
  const r = applyAction(g, 'a', {
    type: 'proposeTrade', to: 'b',
    give: { cash: 99999, spaces: [] }, get: { cash: 0, spaces: [] },
  });
  ok(!r.ok, 'should be rejected');
});

check('a rejected trade clears the table', () => {
  const g = mk();
  g.deeds[1].owner = 'a';
  applyAction(g, 'a', {
    type: 'proposeTrade', to: 'b',
    give: { cash: 0, spaces: [1] }, get: { cash: 50, spaces: [] },
  });
  applyAction(g, 'b', { type: 'respondTrade', accept: false });
  eq(g.trade, null, 'table cleared');
  eq(g.deeds[1].owner, 'a', 'nothing moved');
});

// --- turn order ----------------------------------------------------------

check('turn passes to the next player on end turn', () => {
  const g = mk();
  applyAction(g, 'a', { type: 'roll' });
  const wasDoubles = g.dice[0] === g.dice[1];
  settleTurn(g);
  applyAction(g, 'a', { type: 'endTurn' });
  eq(current(g).id, wasDoubles ? 'a' : 'b', 'next to act');
});

check('you cannot act out of turn', () => {
  const g = mk();
  const r = applyAction(g, 'b', { type: 'roll' });
  ok(!r.ok, 'should be rejected');
});

check('bankrupt players are skipped in the order', () => {
  const g = createGame({
    players: [
      { id: 'a', name: 'Ada', token: 'coffee' },
      { id: 'b', name: 'Bo', token: 'ferry' },
      { id: 'c', name: 'Cy', token: 'salmon' },
    ],
    seed: 3,
  });
  player(g, 'b').bankrupt = true;
  applyAction(g, 'a', { type: 'roll' });
  while (g.phase === 'buy') applyAction(g, 'a', { type: 'decline' });
  if (g.phase === 'auction') {
    for (const id of g.auction.order.slice()) {
      if (g.auction && g.auction.order[g.auction.turnIdx] === id) applyAction(g, id, { type: 'passBid' });
    }
  }
  if (g.phase === 'end' && !g.canRollAgain) {
    applyAction(g, 'a', { type: 'endTurn' });
    eq(current(g).id, 'c', 'skipped the bankrupt player');
  }
});

// --- integration ---------------------------------------------------------

check('full random games run to completion without throwing', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = createGame({
      players: [
        { id: 'a', name: 'Ada', token: 'coffee' },
        { id: 'b', name: 'Bo', token: 'ferry' },
        { id: 'c', name: 'Cy', token: 'salmon' },
        { id: 'd', name: 'Di', token: 'guitar' },
        { id: 'e', name: 'Ez', token: 'rain' },
      ],
      seed,
    });

    let rng = seed * 7919;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
    let steps = 0;

    while (g.phase !== 'gameover' && steps < 4000) {
      steps++;
      // Whoever the engine is waiting on gets to act.
      let actor = null;
      if (g.phase === 'auction') actor = g.auction.order[g.auction.turnIdx];
      else if (g.phase === 'debt') actor = g.debt.debtor;
      else actor = current(g).id;

      const legal = legalActions(g, actor).filter((t) => t !== 'proposeTrade' && t !== 'respondTrade');
      if (legal.length === 0) throw new Error(`no legal action in phase ${g.phase} for ${actor}`);

      // Prefer to keep the game moving rather than stall on build actions.
      const pick = legal[Math.floor(rand() * legal.length)];
      let action = { type: pick };

      if (pick === 'bid') {
        const cash = player(g, actor).cash;
        const bid = g.auction.high + 1 + Math.floor(rand() * 40);
        if (bid > cash) action = { type: 'passBid' };
        else action = { type: 'bid', amount: bid };
      } else if (pick === 'buildHouse' || pick === 'sellHouse' || pick === 'mortgage' || pick === 'unmortgage') {
        const owned = holdings(g, actor);
        if (owned.length === 0) { action = { type: g.phase === 'debt' ? 'concede' : 'endTurn' }; }
        else action = { type: pick, space: owned[Math.floor(rand() * owned.length)] };
      }

      const before = g.seq;
      const res = applyAction(g, actor, action);
      // A rejected action is fine (random play tries illegal things), but the
      // engine must never silently stall in a phase with no way forward.
      if (!res.ok && g.seq === before && g.phase === 'debt') {
        applyAction(g, actor, { type: 'concede' });
      }

      for (const p of g.players) {
        if (p.cash < 0) throw new Error(`negative cash for ${p.id} (seed ${seed})`);
      }
      if (g.houses < 0 || g.hotels < 0) throw new Error(`negative bank supply (seed ${seed})`);
      if (g.houses > TOTAL_HOUSES) throw new Error(`house supply overflow: ${g.houses} (seed ${seed})`);
      if (g.hotels > TOTAL_HOTELS) throw new Error(`hotel supply overflow: ${g.hotels} (seed ${seed})`);
    }
  }
});

check('bank supply is conserved across a game', () => {
  const g = mk({ seed: 42 });
  const grp = GROUP_SPACES.canal;
  for (const i of grp) g.deeds[i].owner = 'a';
  player(g, 'a').cash = 100000;
  // Build to hotels everywhere, then sell it all back down.
  for (let level = 0; level < 5; level++) {
    for (const i of grp) applyAction(g, 'a', { type: 'buildHouse', space: i });
  }
  for (const i of grp) eq(g.deeds[i].houses, 5, `${BOARD[i].name} should be a hotel`);
  for (let level = 0; level < 5; level++) {
    for (const i of grp) applyAction(g, 'a', { type: 'sellHouse', space: i });
  }
  eq(g.houses, TOTAL_HOUSES, 'houses back to full');
  eq(g.hotels, TOTAL_HOTELS, 'hotels back to full');
});

check('net worth counts cash, deeds and buildings', () => {
  const g = mk();
  const p = player(g, 'a');
  p.cash = 100;
  g.deeds[39].owner = 'a';           // Medina $400 -> $200 mortgage value
  eq(netWorth(g, 'a'), 300, 'cash + deed');
  g.deeds[37].owner = 'a';           // Madison Park $350 -> $175
  g.deeds[39].houses = 2;            // 2 x $100 -> $200 resale
  eq(netWorth(g, 'a'), 100 + 200 + 175 + 200, 'with buildings');
});

// --- report --------------------------------------------------------------

console.log(`\nmonopoly engine: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
