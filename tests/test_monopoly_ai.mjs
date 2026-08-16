// CPU opponent tests:  node tests/test_monopoly_ai.mjs
//
// The important property is that five bots can play a whole game to a winner
// without stalling, going negative, or corrupting the bank's supply.

import { createGame, applyAction, current, player, holdings, netWorth } from '../web/monopoly/engine.js';
import { cpuAction, runCpuTurn, spaceValue } from '../web/monopoly/ai.js';
import { GROUP_SPACES, TOTAL_HOUSES, TOTAL_HOTELS, BOARD } from '../web/monopoly/board.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, w = '') { if (a !== b) throw new Error(`${w} expected ${b}, got ${a}`); }
function ok(c, w = 'assertion failed') { if (!c) throw new Error(w); }

const bots = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Bot ${i + 1}`, token: `t${i}`, isCPU: true,
}));

// --- valuation -----------------------------------------------------------

check('a deed that completes a set is valued above list price', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  const grp = GROUP_SPACES.duwamish;
  const plain = spaceValue(g, grp[0], 'p0');
  g.deeds[grp[1]].owner = 'p0';
  const completing = spaceValue(g, grp[0], 'p0');
  ok(completing > plain, `${completing} should exceed ${plain}`);
});

check('a contested group is valued below list price', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  const grp = GROUP_SPACES.hills;
  const plain = spaceValue(g, grp[0], 'p0');
  g.deeds[grp[1]].owner = 'p1';
  ok(spaceValue(g, grp[0], 'p0') < plain, 'should discount a contested group');
});

// --- individual decisions ------------------------------------------------

check('a bot buys a deed that completes a monopoly', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  const grp = GROUP_SPACES.canal;
  g.deeds[grp[0]].owner = 'p0';
  g.deeds[grp[1]].owner = 'p0';
  g.phase = 'buy';
  g.pendingBuy = grp[2];
  eq(cpuAction(g, 'p0').type, 'buy');
});

check('a broke bot declines rather than proposing an illegal buy', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  player(g, 'p0').cash = 10;
  g.phase = 'buy';
  g.pendingBuy = 39;
  eq(cpuAction(g, 'p0').type, 'decline');
});

check('a bot in debt liquidates before conceding', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  g.deeds[39].owner = 'p0';
  player(g, 'p0').cash = 0;
  g.phase = 'debt';
  g.debt = { debtor: 'p0', creditor: 'p1', amount: 100, reason: 'test' };
  const a = cpuAction(g, 'p0');
  eq(a.type, 'mortgage', 'should mortgage first');
});

check('a bot concedes only when it truly cannot pay', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  player(g, 'p0').cash = 0;
  g.phase = 'debt';
  g.debt = { debtor: 'p0', creditor: 'p1', amount: 100, reason: 'test' };
  eq(cpuAction(g, 'p0').type, 'concede');
});

check('a bot never bids above its own valuation', () => {
  const g = createGame({ players: bots(3), seed: 5 });
  g.phase = 'buy';
  g.pendingBuy = 39;
  applyAction(g, 'p0', { type: 'decline' });
  let guard = 0;
  while (g.phase === 'auction' && guard++ < 50) {
    const bidder = g.auction.order[g.auction.turnIdx];
    const a = cpuAction(g, bidder);
    if (a.type === 'bid') ok(a.amount <= spaceValue(g, 39, bidder), 'bid above valuation');
    applyAction(g, bidder, a);
  }
  ok(guard < 50, 'auction should terminate');
});

check('a bot refuses a trade that hands a rival a monopoly', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  const grp = GROUP_SPACES.hills;
  g.deeds[grp[0]].owner = 'p1';
  g.deeds[grp[1]].owner = 'p1';
  g.deeds[grp[2]].owner = 'p0';   // p0 holds the piece that completes p1's set
  g.trade = {
    from: 'p1', to: 'p0',
    give: { cash: BOARD[grp[2]].price, spaces: [], jailCards: 0 },
    get: { cash: 0, spaces: [grp[2]], jailCards: 0 },
  };
  eq(cpuAction(g, 'p0').accept, false, 'should refuse list price for a set-completing deed');
});

check('a bot accepts a clearly generous trade', () => {
  const g = createGame({ players: bots(2), seed: 5 });
  g.deeds[12].owner = 'p0';       // a lone utility, low value to us
  g.trade = {
    from: 'p1', to: 'p0',
    give: { cash: 600, spaces: [], jailCards: 0 },
    get: { cash: 0, spaces: [12], jailCards: 0 },
  };
  eq(cpuAction(g, 'p0').accept, true);
});

// --- full games ----------------------------------------------------------

check('five bots play complete games to a single winner', () => {
  let finished = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const g = createGame({ players: bots(5), seed });
    let turns = 0;

    while (g.phase !== 'gameover' && turns < 3000) {
      turns++;
      let actor;
      if (g.phase === 'auction') actor = g.auction.order[g.auction.turnIdx];
      else if (g.phase === 'debt') actor = g.debt.debtor;
      else if (g.trade) actor = g.trade.to;
      else actor = current(g).id;

      const before = g.seq;
      runCpuTurn(g, actor, applyAction);

      if (g.seq === before) throw new Error(`stalled in phase ${g.phase} (seed ${seed})`);

      for (const p of g.players) {
        if (p.cash < 0) throw new Error(`negative cash for ${p.id} (seed ${seed})`);
      }
      if (g.houses < 0 || g.houses > TOTAL_HOUSES) throw new Error(`bad house supply ${g.houses} (seed ${seed})`);
      if (g.hotels < 0 || g.hotels > TOTAL_HOTELS) throw new Error(`bad hotel supply ${g.hotels} (seed ${seed})`);
    }

    if (g.phase === 'gameover') {
      finished++;
      ok(g.winner !== null, `seed ${seed} ended with no winner`);
      eq(g.players.filter((p) => !p.bankrupt).length, 1, `seed ${seed} survivors`);
    }
  }
  ok(finished >= 20, `only ${finished}/25 games reached a winner`);
});

check('bots actually develop property rather than just hoarding cash', () => {
  const g = createGame({ players: bots(4), seed: 11 });
  let turns = 0;
  let built = false;
  while (g.phase !== 'gameover' && turns < 1200 && !built) {
    turns++;
    let actor;
    if (g.phase === 'auction') actor = g.auction.order[g.auction.turnIdx];
    else if (g.phase === 'debt') actor = g.debt.debtor;
    else if (g.trade) actor = g.trade.to;
    else actor = current(g).id;
    runCpuTurn(g, actor, applyAction);
    built = g.deeds.some((d) => d && d.houses > 0);
  }
  ok(built, 'no bot ever built a house');
});

check('a bot game is reproducible from its seed', () => {
  const run = () => {
    const g = createGame({ players: bots(3), seed: 777 });
    let turns = 0;
    while (g.phase !== 'gameover' && turns < 400) {
      turns++;
      let actor;
      if (g.phase === 'auction') actor = g.auction.order[g.auction.turnIdx];
      else if (g.phase === 'debt') actor = g.debt.debtor;
      else if (g.trade) actor = g.trade.to;
      else actor = current(g).id;
      runCpuTurn(g, actor, applyAction);
    }
    return g.players.map((p) => `${p.id}:${p.cash}:${p.pos}:${holdings(g, p.id).length}`).join('|');
  };
  eq(run(), run(), 'two runs of the same seed');
});

console.log(`\nmonopoly ai: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
