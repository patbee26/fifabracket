// Client for the multiplayer API.
//
// Turn-based play doesn't need sockets: poll while it isn't our turn, back off
// when the tab is hidden, and poll harder right after we act.

const ENDPOINT = '/api/game';

export class NetError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function post(op, payload = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, ...payload }),
    });
  } catch {
    throw new NetError('No connection to the game server.', 0);
  }

  let body = {};
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new NetError(body.error || `Request failed (${res.status}).`, res.status);
  return body;
}

export const api = {
  create: (name, token, settings) => post('create', { name, token, settings }),
  join: (code, name, token) => post('join', { code, name, token }),
  addCpu: (s) => post('addCpu', s),
  removeSeat: (s, seatId) => post('removeSeat', { ...s, seatId }),
  start: (s, settings) => post('start', { ...s, settings }),
  action: (s, action) => post('action', { ...s, action }),
  state: (code) => post('state', { code }),
};

/**
 * Polls a room and calls `onRoom` whenever the server's copy has moved on.
 * Interval adapts: quick while we're waiting on someone else, lazy otherwise.
 */
export class RoomPoller {
  constructor(code, onRoom, onError) {
    this.code = code;
    this.onRoom = onRoom;
    this.onError = onError;
    this.timer = null;
    this.stopped = false;
    this.lastUpdatedAt = 0;
    this.interval = 1500;
    this.failures = 0;
  }

  start() {
    this.stopped = false;
    this.schedule(300);
    // A tab coming back to the foreground should refresh immediately.
    this.visibility = () => { if (!document.hidden) this.poke(); };
    document.addEventListener('visibilitychange', this.visibility);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.visibility) document.removeEventListener('visibilitychange', this.visibility);
  }

  /** Poll right now — call after acting, so the result shows up fast. */
  poke() {
    clearTimeout(this.timer);
    this.schedule(120);
  }

  setInterval(ms) { this.interval = ms; }

  schedule(ms) {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick() {
    if (this.stopped) return;
    if (document.hidden) { this.schedule(5000); return; }

    try {
      const { room } = await api.state(this.code);
      this.failures = 0;
      if (room.updatedAt !== this.lastUpdatedAt) {
        this.lastUpdatedAt = room.updatedAt;
        await this.onRoom(room);
      }
      this.schedule(this.interval);
    } catch (err) {
      this.failures++;
      if (this.onError) this.onError(err, this.failures);
      // Ease off after repeated failures rather than hammering a dead server.
      this.schedule(Math.min(15000, 1200 * Math.pow(2, Math.min(4, this.failures))));
    }
  }
}

// --- local session memory -------------------------------------------------

const KEY = 'emeraldcity.session';

export function saveSession(session) {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
