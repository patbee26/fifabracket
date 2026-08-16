// Multiplayer room tests:  node tests/test_monopoly_server.mjs
//
// Runs the real request handler against an in-memory store that mimics Netlify
// Blobs, including conditional writes, so authorization and concurrency are
// exercised without deploying anything.

import { handle, MAX_SEATS } from '../netlify/lib/rooms.mjs';
import { BOARD } from '../web/monopoly/board.js';

let passed = 0, failed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, w = '') { if (a !== b) throw new Error(`${w} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, w = 'assertion failed') { if (!c) throw new Error(w); }

/** In-memory stand-in for Netlify Blobs, etags and all. */
function fakeStore() {
  const data = new Map();
  let counter = 0;
  return {
    _data: data,
    async get(key) {
      const row = data.get(key);
      return row ? { data: structuredClone(row.value), etag: row.etag } : null;
    },
    async set(key, value, opts = {}) {
      const row = data.get(key);
      if (opts.onlyIfNew && row) return false;
      if (opts.onlyIfMatch && (!row || row.etag !== opts.onlyIfMatch)) return false;
      data.set(key, { value: structuredClone(value), etag: `e${++counter}` });
      return true;
    },
  };
}

const call = (store, body) => handle(store, body);

async function makeRoom(store, name = 'Ada') {
  const res = await call(store, { op: 'create', name });
  eq(res.status, 200, 'create status');
  return res.body;
}

// --- lobby ---------------------------------------------------------------

await check('creating a room returns a code and a secret', async () => {
  const store = fakeStore();
  const { code, playerId, secret, room } = await makeRoom(store);
  eq(code.length, 4, 'code length');
  eq(playerId, 'p1');
  ok(secret && secret.length >= 16, 'secret issued');
  eq(room.seats.length, 1, 'one seat');
  eq(room.hostId, 'p1');
});

await check('the public room never leaks secrets', async () => {
  const store = fakeStore();
  const { code } = await makeRoom(store);
  const res = await call(store, { op: 'state', code });
  const serialized = JSON.stringify(res.body);
  ok(!serialized.includes('secret'), 'no secret field in the payload');
  for (const seat of res.body.room.seats) ok(!('secret' in seat), 'seat carries no secret');
});

await check('players join with the code and get distinct tokens', async () => {
  const store = fakeStore();
  const { code } = await makeRoom(store);
  const b = await call(store, { op: 'join', code, name: 'Bo' });
  const c = await call(store, { op: 'join', code, name: 'Cy' });
  eq(b.status, 200, 'b joined');
  eq(c.status, 200, 'c joined');
  const tokens = c.body.room.seats.map((s) => s.token);
  eq(new Set(tokens).size, tokens.length, 'tokens unique');
  eq(c.body.room.seats.length, 3, 'three seats');
});

await check('joining a bad code is a 404', async () => {
  const store = fakeStore();
  const res = await call(store, { op: 'join', code: 'ZZZZ', name: 'Bo' });
  eq(res.status, 404);
});

await check('a room fills up and then refuses joins', async () => {
  const store = fakeStore();
  const { code } = await makeRoom(store);
  for (let i = 1; i < MAX_SEATS; i++) {
    const r = await call(store, { op: 'join', code, name: `P${i}` });
    eq(r.status, 200, `join ${i}`);
  }
  const overflow = await call(store, { op: 'join', code, name: 'Late' });
  eq(overflow.status, 409, 'room full');
});

await check('only the host can add a CPU', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  const guest = (await call(store, { op: 'join', code: host.code, name: 'Bo' })).body;

  const denied = await call(store, { op: 'addCpu', code: host.code, playerId: guest.playerId, secret: guest.secret });
  eq(denied.status, 403, 'guest refused');

  const allowed = await call(store, { op: 'addCpu', code: host.code, playerId: host.playerId, secret: host.secret });
  eq(allowed.status, 200, 'host allowed');
  ok(allowed.body.room.seats.some((s) => s.isCPU), 'a bot joined');
});

await check('a forged secret cannot act as another player', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  const res = await call(store, {
    op: 'addCpu', code: host.code, playerId: host.playerId, secret: 'not-the-secret',
  });
  eq(res.status, 403);
});

await check('the host can remove a player but not themselves', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  const guest = (await call(store, { op: 'join', code: host.code, name: 'Bo' })).body;

  const selfRemove = await call(store, {
    op: 'removeSeat', code: host.code, playerId: host.playerId, secret: host.secret, seatId: host.playerId,
  });
  eq(selfRemove.status, 400, 'host cannot leave');

  const kick = await call(store, {
    op: 'removeSeat', code: host.code, playerId: host.playerId, secret: host.secret, seatId: guest.playerId,
  });
  eq(kick.status, 200, 'guest removed');
  eq(kick.body.room.seats.length, 1, 'back to one seat');
});

// --- starting ------------------------------------------------------------

await check('a game needs two players to start', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  const res = await call(store, { op: 'start', code: host.code, playerId: host.playerId, secret: host.secret });
  eq(res.status, 400);
});

await check('starting deals cash and sets the first turn', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  await call(store, { op: 'join', code: host.code, name: 'Bo' });
  const res = await call(store, {
    op: 'start', code: host.code, playerId: host.playerId, secret: host.secret,
  });
  eq(res.status, 200, res.body.error);
  const g = res.body.room.game;
  ok(g, 'game created');
  eq(g.players.length, 2, 'two players');
  eq(g.players[0].cash, 1500, 'start cash');
  eq(g.phase, 'preroll');
});

await check('house rules survive into the game', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  await call(store, { op: 'join', code: host.code, name: 'Bo' });
  const res = await call(store, {
    op: 'start', code: host.code, playerId: host.playerId, secret: host.secret,
    settings: { startCash: 2500, freeParkingPot: true, auctions: false },
  });
  const g = res.body.room.game;
  eq(g.settings.startCash, 2500, 'cash');
  eq(g.settings.freeParkingPot, true, 'pot rule');
  eq(g.settings.auctions, false, 'auctions off');
  eq(g.players[0].cash, 2500, 'dealt the right cash');
});

await check('nonsense settings fall back to defaults', async () => {
  const store = fakeStore();
  const host = await makeRoom(store);
  await call(store, { op: 'join', code: host.code, name: 'Bo' });
  const res = await call(store, {
    op: 'start', code: host.code, playerId: host.playerId, secret: host.secret,
    settings: { startCash: 999999 },
  });
  eq(res.body.room.game.settings.startCash, 1500, 'clamped to a sane value');
});

// --- playing -------------------------------------------------------------

async function startedGame(store, { humans = 2, cpus = 0 } = {}) {
  const host = await makeRoom(store, 'Ada');
  const players = [host];
  for (let i = 1; i < humans; i++) {
    players.push((await call(store, { op: 'join', code: host.code, name: `P${i}` })).body);
  }
  for (let i = 0; i < cpus; i++) {
    await call(store, { op: 'addCpu', code: host.code, playerId: host.playerId, secret: host.secret });
  }
  await call(store, { op: 'start', code: host.code, playerId: host.playerId, secret: host.secret });
  return { host, players, code: host.code };
}

await check('a player cannot act out of turn', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 2 });
  const [ada, bo] = players;
  const res = await call(store, {
    op: 'action', code, playerId: bo.playerId, secret: bo.secret, action: { type: 'roll' },
  });
  eq(res.status, 200, 'still a 200 — the client needs state back');
  ok(res.body.rejected, 'but the action was rejected');
  eq(res.body.room.game.players[1].pos, 0, 'Bo did not move');
});

await check('an illegal action does not write to the store', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 2 });
  const bo = players[1];
  const before = (await store.get(code)).etag;
  await call(store, { op: 'action', code, playerId: bo.playerId, secret: bo.secret, action: { type: 'roll' } });
  eq((await store.get(code)).etag, before, 'etag unchanged');
});

await check('rolling moves the player and persists', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 2 });
  const ada = players[0];
  const res = await call(store, {
    op: 'action', code, playerId: ada.playerId, secret: ada.secret, action: { type: 'roll' },
  });
  eq(res.status, 200, res.body.error);
  ok(!res.body.rejected, res.body.rejected);
  const g = res.body.room.game;
  ok(g.players[0].pos > 0, 'moved off GO');

  const fetched = await call(store, { op: 'state', code });
  eq(fetched.body.room.game.players[0].pos, g.players[0].pos, 'persisted');
});

await check('an action without the right secret is refused', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 2 });
  const res = await call(store, {
    op: 'action', code, playerId: players[0].playerId, secret: 'wrong', action: { type: 'roll' },
  });
  eq(res.status, 403);
});

await check('CPU seats play themselves after a human acts', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 1, cpus: 2 });
  const ada = players[0];

  // Ada takes her whole turn; the bots should then run without any client help.
  let guard = 0;
  while (guard++ < 30) {
    const state = (await call(store, { op: 'state', code })).body.room.game;
    if (state.phase === 'gameover') break;
    const turnId = state.players[state.turn].id;
    if (turnId !== ada.playerId) throw new Error(`stopped on a CPU turn: ${turnId}`);

    const action = state.phase === 'preroll' ? { type: 'roll' }
      : state.phase === 'buy' ? { type: 'decline' }
      : state.phase === 'auction' ? { type: 'passBid' }
      : state.phase === 'debt' ? { type: 'concede' }
      : { type: 'endTurn' };
    const res = await call(store, { op: 'action', code, playerId: ada.playerId, secret: ada.secret, action });
    if (res.body.rejected && action.type === 'endTurn') break;
    if (guard > 3 && state.round > 2) break;
  }
  ok(guard > 1, 'took at least one turn');
});

await check('the server drives a long CPU-heavy game without stalling', async () => {
  // Game length is genuinely variable (the server seeds each game randomly),
  // so this asserts what the server is responsible for — never stalling,
  // never corrupting state, always leaving a legal actor on the clock. That
  // games terminate at all is covered by the engine and AI suites.
  const store = fakeStore();
  const host = await makeRoom(store, 'Ada');
  for (let i = 0; i < 3; i++) {
    await call(store, { op: 'addCpu', code: host.code, playerId: host.playerId, secret: host.secret });
  }
  await call(store, { op: 'start', code: host.code, playerId: host.playerId, secret: host.secret });

  // The host is the only human, so drive only her turns; bots resolve server-side.
  let guard = 0;
  let stalls = 0;
  let game = (await call(store, { op: 'state', code: host.code })).body.room.game;
  const startRound = game.round;

  while (game.phase !== 'gameover' && guard++ < 500) {
    // Once the only human is out, the bots finish the game between polls: the
    // server advances a bounded number of CPU steps per request, so a plain
    // state read has to keep pushing it forward.
    if (game.players.find((p) => p.id === host.playerId).bankrupt) {
      const before = game.seq;
      game = (await call(store, { op: 'state', code: host.code })).body.room.game;
      ok(game.seq > before || game.phase === 'gameover',
        'a bot-only game stopped advancing on poll');
      continue;
    }

    const actor = game.phase === 'auction' ? game.auction.order[game.auction.turnIdx]
      : game.phase === 'debt' ? game.debt.debtor
      : game.trade ? game.trade.to
      : game.players[game.turn].id;

    // While a human is still in, bots run inside the request, so control must
    // come back to them. If it doesn't, the server wedged on a CPU seat.
    ok(actor === host.playerId, `server stopped on a CPU seat (${actor}) in phase ${game.phase}`);
    ok(!game.players.find((p) => p.id === actor).bankrupt, 'the clock is on a bankrupt player');

    // A bot can offer the human a trade during the bot's own turn, which
    // blocks the game on us — answer that before anything turn-based.
    const cash = game.players.find((p) => p.id === host.playerId).cash;
    const action = game.trade && game.trade.to === host.playerId
        ? { type: 'respondTrade', accept: false }
      : game.phase === 'preroll' ? { type: 'roll' }
      // Buy when we can actually cover it, otherwise let it go to auction.
      : game.phase === 'buy' ? { type: cash >= BOARD[game.pendingBuy].price ? 'buy' : 'decline' }
      : game.phase === 'auction' ? { type: 'passBid' }
      : game.phase === 'debt' ? { type: 'concede' }
      : { type: 'endTurn' };

    const res = await call(store, {
      op: 'action', code: host.code, playerId: host.playerId, secret: host.secret, action,
    });
    const next = res.body.room.game;
    if (next.seq === game.seq) stalls++; else stalls = 0;
    ok(stalls < 3, `the server stopped making progress in phase ${game.phase}`
      + (res.body.rejected ? ` (rejected: ${res.body.rejected})` : ''));

    for (const p of next.players) ok(p.cash >= 0, `${p.id} went negative`);
    ok(next.houses >= 0 && next.houses <= 32, `bad house supply ${next.houses}`);
    ok(next.hotels >= 0 && next.hotels <= 12, `bad hotel supply ${next.hotels}`);

    game = next;
  }

  ok(game.round > startRound + 20, `only advanced ${game.round - startRound} turns`);
  if (game.phase === 'gameover') {
    ok(game.winner, 'a finished game must name a winner');
    eq(game.players.filter((p) => !p.bankrupt).length, 1, 'survivors');
  }
});

// --- concurrency ---------------------------------------------------------

await check('a stale write loses and is retried, not silently dropped', async () => {
  const store = fakeStore();
  const { code, players } = await startedGame(store, { humans: 2 });

  // Simulate another writer landing between our read and our write exactly once.
  const realSet = store.set.bind(store);
  let interfered = false;
  store.set = async (key, value, opts) => {
    if (!interfered && opts?.onlyIfMatch) {
      interfered = true;
      // Someone else bumps the room first, invalidating our etag.
      const row = await store.get(key);
      await realSet(key, row.data, { onlyIfMatch: row.etag });
      return realSet(key, value, opts); // now fails the precondition
    }
    return realSet(key, value, opts);
  };

  const res = await call(store, {
    op: 'action', code, playerId: players[0].playerId, secret: players[0].secret, action: { type: 'roll' },
  });
  eq(res.status, 200, res.body.error);
  ok(interfered, 'the interference actually happened');
  ok(res.body.room.game.players[0].pos > 0, 'the roll still landed after the retry');
});

await check('two rooms do not collide', async () => {
  const store = fakeStore();
  const a = await makeRoom(store, 'Ada');
  const b = await makeRoom(store, 'Bo');
  ok(a.code !== b.code, 'distinct codes');
  await call(store, { op: 'join', code: a.code, name: 'Cy' });
  const bState = await call(store, { op: 'state', code: b.code });
  eq(bState.body.room.seats.length, 1, 'room B untouched');
});

await check('unknown ops are rejected', async () => {
  const store = fakeStore();
  const res = await call(store, { op: 'destroy-everything' });
  eq(res.status, 400);
});

console.log(`\nmonopoly server: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
