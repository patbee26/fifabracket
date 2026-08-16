// Room orchestration for the multiplayer game.
//
// Deliberately free of any Netlify import: everything here takes a `store`
// object with the three methods we need, so the whole surface can be tested
// against an in-memory fake. `netlify/functions/game.mjs` supplies the real
// Blobs-backed store.
//
// A store implements:
//   get(key)                -> { data, etag } | null
//   set(key, value, opts)   -> true when written, false when the precondition failed
//   opts is { onlyIfMatch } for updates or { onlyIfNew } for creates.

import { createGame, applyAction } from '../../web/monopoly/engine.js';
import { advanceCpus } from '../../web/monopoly/ai.js';
import { TOKENS } from '../../web/monopoly/board.js';

export const MAX_SEATS = 8;
export const MIN_SEATS = 2;
const WRITE_RETRIES = 4;

// No I, O, 0 or 1 — they get misread over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const CPU_NAMES = ['Rainier', 'Cascade', 'Puget', 'Elliott', 'Alki', 'Denny', 'Yesler'];

export function newCode(random = Math.random) {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

function newSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The room as clients may see it — never another player's secret. */
export function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    settings: room.settings,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name, token: s.token, isCPU: s.isCPU })),
    game: room.game,
    updatedAt: room.updatedAt,
  };
}

const ok = (body) => ({ status: 200, body });
const err = (message, status = 400) => ({ status, body: { error: message } });

/**
 * Read → mutate → write, retrying when another request wrote first.
 * `mutate` returns `{error, status}` to abort, `{noWrite:true}` to skip the
 * write, or anything else to commit.
 */
async function withRoom(store, code, mutate) {
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt++) {
    const found = await store.get(code);
    if (!found) return { error: 'That room code does not exist.', status: 404 };

    const room = found.data;
    const outcome = mutate(room) || {};
    if (outcome.error) return outcome;

    if (outcome.noWrite) return { ...outcome, room };

    room.updatedAt = Date.now();
    if (await store.set(code, room, { onlyIfMatch: found.etag })) return { ...outcome, room };
  }
  return { error: 'The room is busy — try again.', status: 409 };
}

/** Let every CPU that owes a decision take it. */
export const advanceCPUs = (game, cap = 400) => advanceCpus(game, applyAction, cap);

function seatFor(room, playerId, secret) {
  const seat = room.seats.find((s) => s.id === playerId);
  if (!seat || seat.isCPU || !seat.secret) return null;
  return seat.secret === secret ? seat : null;
}

function freeToken(room, wanted) {
  const taken = new Set(room.seats.map((s) => s.token));
  if (wanted && !taken.has(wanted)) return wanted;
  return TOKENS.find((t) => !taken.has(t.id))?.id ?? null;
}

const cleanName = (raw, fallback) => String(raw ?? '').trim().slice(0, 16) || fallback;
const normCode = (raw) => String(raw ?? '').toUpperCase().trim();

function normalizeSettings(raw = {}) {
  const cash = Number(raw.startCash);
  return {
    startCash: [500, 1000, 1500, 2000, 2500].includes(cash) ? cash : 1500,
    auctions: raw.auctions !== false,
    freeParkingPot: !!raw.freeParkingPot,
  };
}

// --- operations ----------------------------------------------------------

async function opCreate(store, body, random = Math.random) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode(random);
    if (await store.get(code)) continue; // collision — pick another

    const hostId = 'p1';
    const secret = newSecret();
    const room = {
      code,
      hostId,
      started: false,
      settings: normalizeSettings(body.settings),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      seats: [{ id: hostId, name: cleanName(body.name, 'Host'), token: body.token || TOKENS[0].id, isCPU: false, secret }],
      game: null,
      nextSeat: 2,
    };
    if (await store.set(code, room, { onlyIfNew: true })) {
      return ok({ code, playerId: hostId, secret, room: publicRoom(room) });
    }
  }
  return err('Could not create a room. Try again.', 503);
}

async function opJoin(store, body) {
  const code = normCode(body.code);
  if (!code) return err('Enter a room code.');

  const res = await withRoom(store, code, (room) => {
    if (room.started) return { error: 'That game has already started.', status: 409 };
    if (room.seats.length >= MAX_SEATS) return { error: 'That room is full.', status: 409 };
    if (room.seats.some((s) => !s.isCPU && s.name.toLowerCase() === cleanName(body.name, '').toLowerCase() && body.name)) {
      return { error: 'Someone is already using that name.', status: 409 };
    }
    const token = freeToken(room, body.token);
    if (!token) return { error: 'No tokens left.', status: 409 };

    const seat = {
      id: `p${room.nextSeat++}`,
      name: cleanName(body.name, `Player ${room.seats.length + 1}`),
      token,
      isCPU: false,
      secret: newSecret(),
    };
    room.seats.push(seat);
    return { playerId: seat.id, secret: seat.secret };
  });

  if (res.error) return err(res.error, res.status);
  return ok({ code, playerId: res.playerId, secret: res.secret, room: publicRoom(res.room) });
}

async function opAddCpu(store, body) {
  const res = await withRoom(store, normCode(body.code), (room) => {
    const me = seatFor(room, body.playerId, body.secret);
    if (!me || me.id !== room.hostId) return { error: 'Only the host can add a bot.', status: 403 };
    if (room.started) return { error: 'The game has already started.', status: 409 };
    if (room.seats.length >= MAX_SEATS) return { error: 'That room is full.', status: 409 };

    const token = freeToken(room, null);
    if (!token) return { error: 'No tokens left.', status: 409 };
    const n = room.seats.filter((s) => s.isCPU).length;
    room.seats.push({
      id: `p${room.nextSeat++}`,
      name: `${CPU_NAMES[n % CPU_NAMES.length]} (CPU)`,
      token,
      isCPU: true,
      secret: null,
    });
    return {};
  });

  if (res.error) return err(res.error, res.status);
  return ok({ room: publicRoom(res.room) });
}

async function opRemoveSeat(store, body) {
  const res = await withRoom(store, normCode(body.code), (room) => {
    const me = seatFor(room, body.playerId, body.secret);
    if (!me) return { error: 'You are not in this game.', status: 403 };
    if (room.started) return { error: 'The game has already started.', status: 409 };

    const target = String(body.seatId ?? '');
    if (target === room.hostId) return { error: 'The host cannot leave.', status: 400 };
    if (me.id !== room.hostId && me.id !== target) {
      return { error: 'Only the host can remove other players.', status: 403 };
    }
    if (!room.seats.some((s) => s.id === target)) return { error: 'No such player.', status: 404 };
    room.seats = room.seats.filter((s) => s.id !== target);
    return {};
  });

  if (res.error) return err(res.error, res.status);
  return ok({ room: publicRoom(res.room) });
}

async function opStart(store, body) {
  const res = await withRoom(store, normCode(body.code), (room) => {
    const me = seatFor(room, body.playerId, body.secret);
    if (!me || me.id !== room.hostId) return { error: 'Only the host can start the game.', status: 403 };
    if (room.started) return { error: 'That game has already started.', status: 409 };
    if (room.seats.length < MIN_SEATS) return { error: 'You need at least two players.', status: 400 };

    room.settings = normalizeSettings({ ...room.settings, ...(body.settings || {}) });
    room.game = createGame({
      players: room.seats.map((s) => ({ id: s.id, name: s.name, token: s.token, isCPU: s.isCPU })),
      settings: room.settings,
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    });
    room.started = true;
    advanceCPUs(room.game);
    return {};
  });

  if (res.error) return err(res.error, res.status);
  return ok({ room: publicRoom(res.room) });
}

async function opAction(store, body) {
  let rejected = null;

  const res = await withRoom(store, normCode(body.code), (room) => {
    rejected = null;
    const seat = seatFor(room, body.playerId, body.secret);
    if (!seat) return { error: 'You are not in this game.', status: 403 };
    if (!room.started || !room.game) return { error: 'The game has not started.', status: 409 };

    const applied = applyAction(room.game, seat.id, body.action || {});
    if (!applied.ok) {
      // Not a transport error — the client tried something illegal and still
      // needs current state back so it can resync.
      rejected = applied.error;
      return { noWrite: true };
    }
    advanceCPUs(room.game);
    return {};
  });

  if (res.error) return err(res.error, res.status);
  return ok({ room: publicRoom(res.room), rejected });
}

async function opState(store, body) {
  const code = normCode(body.code);
  const found = await store.get(code);
  if (!found) return err('That room code does not exist.', 404);

  // If the board is sitting on a CPU decision — a client crashed mid-turn, say
  // — nudge it along rather than leaving everyone staring at a frozen game.
  const room = found.data;
  if (room.started && room.game && room.game.phase !== 'gameover') {
    const before = room.game.seq;
    advanceCPUs(room.game);
    if (room.game.seq !== before) {
      room.updatedAt = Date.now();
      await store.set(code, room, { onlyIfMatch: found.etag });
    }
  }
  return ok({ room: publicRoom(room) });
}

/** Dispatch one request. Returns `{status, body}`. */
export async function handle(store, body) {
  if (!body || typeof body !== 'object') return err('Expected a JSON body.');
  switch (body.op) {
    case 'create':     return opCreate(store, body);
    case 'join':       return opJoin(store, body);
    case 'addCpu':     return opAddCpu(store, body);
    case 'removeSeat': return opRemoveSeat(store, body);
    case 'start':      return opStart(store, body);
    case 'action':     return opAction(store, body);
    case 'state':      return opState(store, body);
    default:           return err(`Unknown op: ${body.op}`);
  }
}
