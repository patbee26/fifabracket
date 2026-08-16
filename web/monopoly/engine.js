// Rules engine. Pure, deterministic, and shared byte-for-byte between the
// browser and the Netlify function so the server can validate every action the
// client thinks it is taking.
//
// The engine mutates state in place and appends to `state.log`. Callers that
// need rollback (the server, on a rejected action) clone first.

import {
  BOARD, GROUPS, GROUP_SPACES, RAIL_SPACES, UTIL_SPACES, RAIL_RENT, UTIL_MULTIPLIER,
  CHANCE, CHEST, GO_SALARY, JAIL_INDEX, JAIL_FINE, MORTGAGE_INTEREST,
  TOTAL_HOUSES, TOTAL_HOTELS, space,
} from './board.js';

// --- deterministic RNG -----------------------------------------------------

function nextRandom(state) {
  // mulberry32 — small, fast, and reproducible from an integer seed.
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const rollDie = (state) => 1 + Math.floor(nextRandom(state) * 6);

function shuffle(state, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

const MAX_LOG = 250;

function emit(state, type, data = {}) {
  state.seq += 1;
  state.log.push({ seq: state.seq, type, ...data });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

export const player = (state, id) => state.players.find((p) => p.id === id) || null;
export const current = (state) => state.players[state.turn] || null;
export const deed = (state, i) => state.deeds[i];

export const activePlayers = (state) => state.players.filter((p) => !p.bankrupt);

/** Space indices owned by a player. */
export function holdings(state, playerId) {
  const out = [];
  for (let i = 0; i < 40; i++) {
    if (state.deeds[i] && state.deeds[i].owner === playerId) out.push(i);
  }
  return out;
}

/** True when the player owns every space in that colour group. */
export function ownsGroup(state, playerId, group) {
  return GROUP_SPACES[group].every((i) => state.deeds[i].owner === playerId);
}

/** Total sell-back value: cash + mortgageable deeds + house resale. */
export function netWorth(state, playerId) {
  const p = player(state, playerId);
  if (!p) return 0;
  let total = p.cash;
  for (const i of holdings(state, playerId)) {
    const sp = BOARD[i];
    const d = state.deeds[i];
    if (!d.mortgaged) total += Math.floor(sp.price / 2);
    if (d.houses > 0) total += d.houses * Math.floor(GROUPS[sp.group].house / 2);
  }
  return total;
}

/** Cash a player could raise right now without trading. */
export function liquidity(state, playerId) {
  return netWorth(state, playerId);
}

// --- rent ------------------------------------------------------------------

export function rentFor(state, spaceIndex, diceTotal) {
  const sp = BOARD[spaceIndex];
  const d = state.deeds[spaceIndex];
  if (!d || d.owner === null || d.mortgaged) return 0;

  if (sp.type === 'prop') {
    if (d.houses > 0) return sp.rent[d.houses];
    // Unimproved rent doubles on a complete, colour group.
    return ownsGroup(state, d.owner, sp.group) ? sp.rent[0] * 2 : sp.rent[0];
  }
  if (sp.type === 'rail') {
    const count = RAIL_SPACES.filter((i) => state.deeds[i].owner === d.owner).length;
    return RAIL_RENT[count];
  }
  if (sp.type === 'utility') {
    const count = UTIL_SPACES.filter((i) => state.deeds[i].owner === d.owner).length;
    return UTIL_MULTIPLIER[count] * diceTotal;
  }
  return 0;
}

// --- money -----------------------------------------------------------------

function credit(state, playerId, amount, reason) {
  const p = player(state, playerId);
  p.cash += amount;
  emit(state, 'cash', { player: playerId, amount, balance: p.cash, reason });
}

/**
 * Move money out of a player's pocket. If they cannot cover it, the shortfall
 * becomes a debt and the game blocks on `phase: 'debt'` until they raise the
 * cash or go bankrupt.
 * Returns true when the payment settled immediately.
 */
function charge(state, playerId, amount, creditorId, reason) {
  const p = player(state, playerId);
  if (amount <= 0) return true;

  if (p.cash >= amount) {
    p.cash -= amount;
    emit(state, 'cash', { player: playerId, amount: -amount, balance: p.cash, reason });
    if (creditorId) credit(state, creditorId, amount, reason);
    else if (state.settings.freeParkingPot) state.pot += amount;
    return true;
  }

  state.debt = { debtor: playerId, creditor: creditorId ?? null, amount, reason };
  state.phase = 'debt';
  emit(state, 'debt', { player: playerId, creditor: creditorId ?? null, amount, reason });
  return false;
}

/** Called after any action that might have raised enough cash to clear a debt. */
function trySettleDebt(state) {
  if (state.phase !== 'debt' || !state.debt) return;
  const { debtor, creditor, amount, reason } = state.debt;
  const p = player(state, debtor);
  if (p.cash < amount) return;

  p.cash -= amount;
  emit(state, 'cash', { player: debtor, amount: -amount, balance: p.cash, reason });
  if (state.pendingPayEach) {
    // A "pay every player" card the debtor had to liquidate to cover: the money
    // belongs to the other players, not the bank.
    for (const id of state.pendingPayEach.to) credit(state, id, state.pendingPayEach.amount, reason);
    state.pendingPayEach = null;
  } else if (creditor) credit(state, creditor, amount, reason);
  else if (state.settings.freeParkingPot) state.pot += amount;

  state.debt = null;
  emit(state, 'debtCleared', { player: debtor });
  resumeAfterDebt(state);
}

function resumeAfterDebt(state) {
  // A debt can interrupt a landing, an auction win, or a card. Once cleared we
  // return to whatever the turn was doing.
  if (state.auction) { state.phase = 'auction'; finishAuctionPayment(state); return; }
  state.phase = 'end';
  maybeAdvanceAfterTurnEnd(state);
}

// --- bankruptcy ------------------------------------------------------------

function goBankrupt(state, debtorId, creditorId) {
  const p = player(state, debtorId);
  p.bankrupt = true;
  const owned = holdings(state, debtorId);

  // Houses always go back to the bank's supply; the buildings are not transferred.
  for (const i of owned) {
    const d = state.deeds[i];
    if (d.houses === 5) { state.hotels += 1; }
    else if (d.houses > 0) { state.houses += d.houses; }
    d.houses = 0;
  }

  if (creditorId) {
    const creditor = player(state, creditorId);
    creditor.cash += p.cash;
    for (const i of owned) state.deeds[i].owner = creditorId;
    creditor.jailCards += p.jailCards;
    emit(state, 'bankrupt', { player: debtorId, to: creditorId, cash: p.cash, spaces: owned });
  } else {
    for (const i of owned) { state.deeds[i].owner = null; state.deeds[i].mortgaged = false; }
    // Bank repossession: the properties go straight back up for auction.
    state.auctionQueue.push(...owned);
    emit(state, 'bankrupt', { player: debtorId, to: null, cash: p.cash, spaces: owned });
  }

  p.cash = 0;
  p.jailCards = 0;
  state.debt = null;
  state.pendingPayEach = null;

  const left = activePlayers(state);
  if (left.length <= 1) {
    state.phase = 'gameover';
    state.winner = left[0]?.id ?? null;
    emit(state, 'gameover', { winner: state.winner });
    return;
  }

  // Anything the bank repossessed goes straight back up for auction.
  if (state.auctionQueue.length > 0) {
    startAuction(state, state.auctionQueue.shift());
    return;
  }

  state.phase = 'end';
  maybeAdvanceAfterTurnEnd(state);
}

// --- movement --------------------------------------------------------------

function moveTo(state, p, target, { collectGo = true, why = 'move' } = {}) {
  const from = p.pos;
  const wrapped = target < from;
  p.pos = target;
  emit(state, 'move', { player: p.id, from, to: target, why });
  if (wrapped && collectGo) {
    credit(state, p.id, GO_SALARY, 'Passed GO');
    emit(state, 'passGo', { player: p.id });
  }
}

function sendToJail(state, p) {
  const from = p.pos;
  p.pos = JAIL_INDEX;
  p.inJail = true;
  p.jailRolls = 0;
  state.doubles = 0;
  emit(state, 'jailed', { player: p.id, from });
  state.phase = 'end';
}

// --- landing ---------------------------------------------------------------

function landOn(state, p, diceTotal) {
  const sp = BOARD[p.pos];
  emit(state, 'land', { player: p.id, space: p.pos });

  switch (sp.type) {
    case 'go':
    case 'jail':
      state.phase = 'end';
      break;

    case 'parking':
      if (state.settings.freeParkingPot && state.pot > 0) {
        credit(state, p.id, state.pot, 'Free parking pot');
        emit(state, 'potClaimed', { player: p.id, amount: state.pot });
        state.pot = 0;
      }
      state.phase = 'end';
      break;

    case 'gotojail':
      sendToJail(state, p);
      break;

    case 'tax':
      if (charge(state, p.id, sp.amount, null, sp.name)) state.phase = 'end';
      break;

    case 'chance':
    case 'chest':
      drawCard(state, p, sp.type, diceTotal);
      break;

    case 'prop':
    case 'rail':
    case 'utility': {
      const d = state.deeds[p.pos];
      if (d.owner === null) {
        state.phase = 'buy';
        state.pendingBuy = p.pos;
        emit(state, 'offer', { player: p.id, space: p.pos, price: sp.price });
      } else if (d.owner === p.id || d.mortgaged) {
        state.phase = 'end';
      } else {
        const rent = rentFor(state, p.pos, diceTotal) * (state.rentMultiplier || 1);
        state.rentMultiplier = 1;
        emit(state, 'rent', { player: p.id, to: d.owner, space: p.pos, amount: rent });
        if (charge(state, p.id, rent, d.owner, `Rent on ${sp.name}`)) state.phase = 'end';
      }
      break;
    }
    default:
      state.phase = 'end';
  }

  if (state.phase === 'end') maybeAdvanceAfterTurnEnd(state);
}

// --- cards -----------------------------------------------------------------

function drawCard(state, p, kind, diceTotal) {
  const deckKey = kind === 'chance' ? 'chanceDeck' : 'chestDeck';
  const source = kind === 'chance' ? CHANCE : CHEST;
  if (state[deckKey].length === 0) {
    state[deckKey] = shuffle(state, source.map((c) => c.id));
  }
  const cardId = state[deckKey].shift();
  const card = source.find((c) => c.id === cardId);
  emit(state, 'card', { player: p.id, kind, card: { id: card.id, text: card.text } });

  applyCard(state, p, card, diceTotal);
}

function applyCard(state, p, card, diceTotal) {
  switch (card.action) {
    case 'money':
      if (card.amount >= 0) { credit(state, p.id, card.amount, card.text); state.phase = 'end'; }
      else if (charge(state, p.id, -card.amount, null, card.text)) state.phase = 'end';
      break;

    case 'collectEach': {
      let taken = 0;
      for (const other of activePlayers(state)) {
        if (other.id === p.id) continue;
        const amt = Math.min(other.cash, card.amount);
        other.cash -= amt;
        taken += amt;
        emit(state, 'cash', { player: other.id, amount: -amt, balance: other.cash, reason: card.text });
      }
      credit(state, p.id, taken, card.text);
      state.phase = 'end';
      break;
    }

    case 'payEach': {
      const others = activePlayers(state).filter((o) => o.id !== p.id);
      const total = card.amount * others.length;
      if (p.cash >= total) {
        for (const o of others) { p.cash -= card.amount; credit(state, o.id, card.amount, card.text); }
        emit(state, 'cash', { player: p.id, amount: -total, balance: p.cash, reason: card.text });
        state.phase = 'end';
      } else {
        // Pay what we can via the debt machinery, crediting everyone on settle.
        state.pendingPayEach = { amount: card.amount, to: others.map((o) => o.id) };
        charge(state, p.id, total, null, card.text);
      }
      break;
    }

    case 'move':
      moveTo(state, p, card.to, { collectGo: card.pass !== false, why: 'card' });
      landOn(state, p, diceTotal);
      return;

    case 'moveBy': {
      const from = p.pos;
      const target = ((p.pos + card.steps) % 40 + 40) % 40;
      // Going back three never passes GO, so no salary either way.
      p.pos = target;
      emit(state, 'move', { player: p.id, from, to: target, why: 'card' });
      landOn(state, p, diceTotal);
      return;
    }

    case 'nearest': {
      const pool = card.kind === 'rail' ? RAIL_SPACES : UTIL_SPACES;
      let target = pool.find((i) => i > p.pos);
      const wrapped = target === undefined;
      if (wrapped) target = pool[0];
      const from = p.pos;
      p.pos = target;
      emit(state, 'move', { player: p.id, from, to: target, why: 'card' });
      if (wrapped) { credit(state, p.id, GO_SALARY, 'Passed GO'); emit(state, 'passGo', { player: p.id }); }

      const d = state.deeds[target];
      if (d.owner === null) {
        state.phase = 'buy';
        state.pendingBuy = target;
        emit(state, 'offer', { player: p.id, space: target, price: BOARD[target].price });
      } else if (d.owner === p.id || d.mortgaged) {
        state.phase = 'end';
      } else if (card.kind === 'rail') {
        const rent = rentFor(state, target, diceTotal) * 2;
        emit(state, 'rent', { player: p.id, to: d.owner, space: target, amount: rent });
        if (charge(state, p.id, rent, d.owner, 'Double transit fare')) state.phase = 'end';
      } else {
        const roll = rollDie(state) + rollDie(state);
        emit(state, 'dice', { player: p.id, dice: [roll], utility: true });
        const rent = 10 * roll;
        emit(state, 'rent', { player: p.id, to: d.owner, space: target, amount: rent });
        if (charge(state, p.id, rent, d.owner, 'Ten times your roll')) state.phase = 'end';
      }
      break;
    }

    case 'jail':
      sendToJail(state, p);
      break;

    case 'getOut':
      p.jailCards += 1;
      emit(state, 'jailCard', { player: p.id, count: p.jailCards });
      state.phase = 'end';
      break;

    case 'repairs': {
      let houses = 0, hotels = 0;
      for (const i of holdings(state, p.id)) {
        const d = state.deeds[i];
        if (d.houses === 5) hotels += 1; else houses += d.houses;
      }
      const bill = houses * card.perHouse + hotels * card.perHotel;
      if (bill === 0 || charge(state, p.id, bill, null, 'Repairs')) state.phase = 'end';
      break;
    }

    default:
      state.phase = 'end';
  }

  if (state.phase === 'end') maybeAdvanceAfterTurnEnd(state);
}

// --- auctions --------------------------------------------------------------

function startAuction(state, spaceIndex) {
  const bidders = activePlayers(state).map((p) => p.id);
  state.auction = {
    space: spaceIndex,
    high: 0,
    highBidder: null,
    // Bidding opens with whoever's turn it is, or the first solvent player.
    order: bidders,
    turnIdx: bidders.indexOf(current(state)?.id) >= 0 ? bidders.indexOf(current(state).id) : 0,
    out: [],
  };
  state.phase = 'auction';
  emit(state, 'auctionStart', { space: spaceIndex });
}

function auctionAdvance(state) {
  const a = state.auction;
  const live = a.order.filter((id) => !a.out.includes(id) && !player(state, id).bankrupt);

  if (live.length === 0) { endAuction(state, null); return; }
  if (live.length === 1 && a.highBidder !== null) { endAuction(state, a.highBidder); return; }
  if (live.length === 1 && a.highBidder === null) {
    // Everyone else passed before any bid; the last player can take it for $1
    // or pass, so keep the auction open for exactly one more decision.
  }

  do {
    a.turnIdx = (a.turnIdx + 1) % a.order.length;
  } while (a.out.includes(a.order[a.turnIdx]) || player(state, a.order[a.turnIdx]).bankrupt);

  emit(state, 'auctionTurn', { player: a.order[a.turnIdx], high: a.high, highBidder: a.highBidder });
}

function endAuction(state, winnerId) {
  const a = state.auction;
  if (!winnerId) {
    emit(state, 'auctionEnd', { space: a.space, winner: null, price: 0 });
    state.auction = null;
    nextQueuedAuctionOrEnd(state);
    return;
  }
  emit(state, 'auctionEnd', { space: a.space, winner: winnerId, price: a.high });
  finishAuctionPayment(state, winnerId);
}

function finishAuctionPayment(state, winnerId) {
  const a = state.auction;
  if (!a) return;
  const winner = winnerId ?? a.highBidder;
  if (charge(state, winner, a.high, null, `Auction: ${BOARD[a.space].name}`)) {
    state.deeds[a.space].owner = winner;
    emit(state, 'acquire', { player: winner, space: a.space, price: a.high, via: 'auction' });
    state.auction = null;
    nextQueuedAuctionOrEnd(state);
  }
}

function nextQueuedAuctionOrEnd(state) {
  if (state.auctionQueue.length > 0) {
    startAuction(state, state.auctionQueue.shift());
    return;
  }
  state.phase = 'end';
  maybeAdvanceAfterTurnEnd(state);
}

// --- turn flow -------------------------------------------------------------

function maybeAdvanceAfterTurnEnd(state) {
  // Nothing automatic: the player still has to press End Turn, which lets them
  // build or trade after landing. Rolling doubles is surfaced here though.
  if (state.phase !== 'end') return;
  const p = current(state);
  if (!p) return;
  if (p.bankrupt) {
    // The player whose turn it is just went out — nobody is left to press End
    // Turn, so move the game along ourselves.
    state.canRollAgain = false;
    state.doubles = 0;
    advanceTurn(state);
    return;
  }
  state.canRollAgain = state.doubles > 0 && !p.inJail;
}

function advanceTurn(state) {
  state.doubles = 0;
  do {
    state.turn = (state.turn + 1) % state.players.length;
  } while (state.players[state.turn].bankrupt);
  state.phase = 'preroll';
  state.round += 1;
  emit(state, 'turn', { player: current(state).id });
}

export function endTurn(state) {
  const p = current(state);
  if (state.canRollAgain) {
    state.canRollAgain = false;
    state.phase = 'preroll';
    emit(state, 'rollAgain', { player: p.id });
    return;
  }
  advanceTurn(state);
}

// --- public action surface -------------------------------------------------

const fail = (msg) => ({ ok: false, error: msg });
const done = () => ({ ok: true });

/**
 * Apply a player action. Returns `{ok}` or `{ok:false, error}`.
 * The caller is responsible for cloning state if it needs to roll back.
 */
export function applyAction(state, playerId, action) {
  if (state.phase === 'gameover') return fail('The game is over.');
  const p = player(state, playerId);
  if (!p) return fail('Unknown player.');
  if (p.bankrupt) return fail('You are out of the game.');

  // Actions that are legal outside your own turn.
  if (action.type === 'proposeTrade') return doProposeTrade(state, p, action);
  if (action.type === 'respondTrade') return doRespondTrade(state, p, action);
  if (action.type === 'bid' || action.type === 'passBid') return doAuctionAction(state, p, action);

  // Debt is resolved by the debtor, whoever's turn it is.
  if (state.phase === 'debt') {
    if (state.debt.debtor !== playerId) return fail('Waiting on another player to settle a debt.');
    if (action.type === 'concede') {
      goBankrupt(state, playerId, state.debt.creditor);
      return done();
    }
    if (!['mortgage', 'sellHouse', 'unmortgage'].includes(action.type)) {
      return fail('You owe money — mortgage, sell buildings, or concede.');
    }
  } else if (current(state)?.id !== playerId) {
    return fail('Not your turn.');
  }

  switch (action.type) {
    case 'roll':        return doRoll(state, p);
    case 'buy':         return doBuy(state, p);
    case 'decline':     return doDecline(state, p);
    case 'buildHouse':  return doBuild(state, p, action.space);
    case 'sellHouse':   return doSellHouse(state, p, action.space);
    case 'mortgage':    return doMortgage(state, p, action.space);
    case 'unmortgage':  return doUnmortgage(state, p, action.space);
    case 'payJail':     return doPayJail(state, p);
    case 'useJailCard': return doUseJailCard(state, p);
    case 'endTurn':
      if (state.phase !== 'end' && state.phase !== 'preroll') return fail('Finish what you are doing first.');
      if (state.phase === 'preroll' && !state.canRollAgain) return fail('Roll the dice first.');
      endTurn(state);
      return done();
    case 'concede':
      goBankrupt(state, playerId, null);
      return done();
    default:
      return fail(`Unknown action: ${action.type}`);
  }
}

function doRoll(state, p) {
  if (state.phase !== 'preroll') return fail('You cannot roll right now.');

  const d1 = rollDie(state), d2 = rollDie(state);
  const total = d1 + d2;
  const isDouble = d1 === d2;
  state.dice = [d1, d2];
  emit(state, 'dice', { player: p.id, dice: [d1, d2] });

  if (p.inJail) {
    p.jailRolls += 1;
    if (isDouble) {
      p.inJail = false;
      p.jailRolls = 0;
      emit(state, 'jailOut', { player: p.id, how: 'doubles' });
      moveTo(state, p, (p.pos + total) % 40, { why: 'roll' });
      landOn(state, p, total);
      // Rolling doubles out of jail does not grant another turn.
      state.doubles = 0;
      return done();
    }
    if (p.jailRolls >= 3) {
      emit(state, 'jailTimeUp', { player: p.id });
      if (!charge(state, p.id, JAIL_FINE, null, 'Gridlock fine')) return done();
      p.inJail = false;
      p.jailRolls = 0;
      emit(state, 'jailOut', { player: p.id, how: 'fine' });
      moveTo(state, p, (p.pos + total) % 40, { why: 'roll' });
      landOn(state, p, total);
      return done();
    }
    state.phase = 'end';
    maybeAdvanceAfterTurnEnd(state);
    return done();
  }

  if (isDouble) {
    state.doubles += 1;
    if (state.doubles >= 3) {
      emit(state, 'speeding', { player: p.id });
      sendToJail(state, p);
      maybeAdvanceAfterTurnEnd(state);
      return done();
    }
  } else {
    state.doubles = 0;
  }

  moveTo(state, p, (p.pos + total) % 40, { why: 'roll' });
  landOn(state, p, total);
  return done();
}

function doBuy(state, p) {
  if (state.phase !== 'buy') return fail('Nothing is for sale.');
  const i = state.pendingBuy;
  const price = BOARD[i].price;
  if (p.cash < price) return fail('You cannot afford it — decline and it goes to auction.');
  p.cash -= price;
  emit(state, 'cash', { player: p.id, amount: -price, balance: p.cash, reason: `Bought ${BOARD[i].name}` });
  state.deeds[i].owner = p.id;
  state.pendingBuy = null;
  emit(state, 'acquire', { player: p.id, space: i, price, via: 'buy' });
  state.phase = 'end';
  maybeAdvanceAfterTurnEnd(state);
  return done();
}

function doDecline(state, p) {
  if (state.phase !== 'buy') return fail('Nothing to decline.');
  const i = state.pendingBuy;
  state.pendingBuy = null;
  if (state.settings.auctions) {
    startAuction(state, i);
  } else {
    state.phase = 'end';
    maybeAdvanceAfterTurnEnd(state);
  }
  return done();
}

function doAuctionAction(state, p, action) {
  const a = state.auction;
  if (!a || state.phase !== 'auction') return fail('No auction is running.');
  if (a.order[a.turnIdx] !== p.id) return fail('Not your bid.');
  if (a.out.includes(p.id)) return fail('You already passed.');

  if (action.type === 'passBid') {
    a.out.push(p.id);
    emit(state, 'auctionPass', { player: p.id });
    const live = a.order.filter((id) => !a.out.includes(id));
    if (live.length === 0) { endAuction(state, a.highBidder); return done(); }
    if (live.length === 1 && a.highBidder === live[0]) { endAuction(state, a.highBidder); return done(); }
    auctionAdvance(state);
    return done();
  }

  const amount = Math.floor(Number(action.amount));
  if (!Number.isFinite(amount) || amount <= a.high) return fail('Bid must beat the current bid.');
  if (amount > p.cash) return fail('You cannot cover that bid.');
  a.high = amount;
  a.highBidder = p.id;
  emit(state, 'auctionBid', { player: p.id, amount });
  const live = a.order.filter((id) => !a.out.includes(id));
  if (live.length === 1) { endAuction(state, p.id); return done(); }
  auctionAdvance(state);
  return done();
}

// --- building --------------------------------------------------------------

/** Why a build is illegal, or null when it is fine. */
export function buildBlocker(state, playerId, i) {
  const sp = BOARD[i];
  if (!sp || sp.type !== 'prop') return 'You can only build on neighborhoods.';
  const d = state.deeds[i];
  if (d.owner !== playerId) return 'You do not own it.';
  if (!ownsGroup(state, playerId, sp.group)) return `You need all of ${GROUPS[sp.group].name}.`;
  if (GROUP_SPACES[sp.group].some((g) => state.deeds[g].mortgaged)) return 'Lift the mortgages in that group first.';
  if (d.houses >= 5) return 'Already a hotel.';
  const min = Math.min(...GROUP_SPACES[sp.group].map((g) => state.deeds[g].houses));
  if (d.houses > min) return 'Build evenly across the group.';
  if (d.houses === 4 && state.hotels <= 0) return 'The bank is out of hotels.';
  if (d.houses < 4 && state.houses <= 0) return 'The bank is out of houses.';
  if (player(state, playerId).cash < GROUPS[sp.group].house) return 'Not enough cash.';
  return null;
}

function doBuild(state, p, i) {
  const blocker = buildBlocker(state, p.id, i);
  if (blocker) return fail(blocker);
  const sp = BOARD[i];
  const cost = GROUPS[sp.group].house;
  const d = state.deeds[i];

  p.cash -= cost;
  emit(state, 'cash', { player: p.id, amount: -cost, balance: p.cash, reason: `Built on ${sp.name}` });

  if (d.houses === 4) {
    d.houses = 5;
    state.hotels -= 1;
    state.houses += 4; // the four houses go back in the box
    emit(state, 'build', { player: p.id, space: i, level: 5 });
  } else {
    d.houses += 1;
    state.houses -= 1;
    emit(state, 'build', { player: p.id, space: i, level: d.houses });
  }
  return done();
}

function doSellHouse(state, p, i) {
  const sp = BOARD[i];
  if (!sp || sp.type !== 'prop') return fail('Nothing to sell there.');
  const d = state.deeds[i];
  if (d.owner !== p.id) return fail('You do not own it.');
  if (d.houses === 0) return fail('No buildings there.');
  const max = Math.max(...GROUP_SPACES[sp.group].map((g) => state.deeds[g].houses));
  if (d.houses < max) return fail('Sell evenly across the group.');
  if (d.houses === 5 && state.houses < 4) return fail('The bank has no houses to break the hotel into.');

  const refund = Math.floor(GROUPS[sp.group].house / 2);
  if (d.houses === 5) {
    d.houses = 4;
    state.hotels += 1;
    state.houses -= 4;
  } else {
    d.houses -= 1;
    state.houses += 1;
  }
  credit(state, p.id, refund, `Sold building on ${sp.name}`);
  emit(state, 'build', { player: p.id, space: i, level: d.houses, sold: true });
  trySettleDebt(state);
  return done();
}

function doMortgage(state, p, i) {
  const sp = BOARD[i];
  const d = state.deeds[i];
  if (!d || d.owner !== p.id) return fail('You do not own it.');
  if (d.mortgaged) return fail('Already mortgaged.');
  if (sp.type === 'prop' && GROUP_SPACES[sp.group].some((g) => state.deeds[g].houses > 0)) {
    return fail('Sell the buildings in that group first.');
  }
  d.mortgaged = true;
  credit(state, p.id, Math.floor(sp.price / 2), `Mortgaged ${sp.name}`);
  emit(state, 'mortgage', { player: p.id, space: i, on: true });
  trySettleDebt(state);
  return done();
}

function doUnmortgage(state, p, i) {
  const sp = BOARD[i];
  const d = state.deeds[i];
  if (!d || d.owner !== p.id) return fail('You do not own it.');
  if (!d.mortgaged) return fail('Not mortgaged.');
  // Integer arithmetic throughout: 200 * 1.1 lands on 220.00000000000003 in
  // floating point, which would round up to an off-by-one $221.
  const principal = Math.floor(sp.price / 2);
  const cost = principal + Math.ceil(principal / 10);
  if (p.cash < cost) return fail(`You need $${cost}.`);
  p.cash -= cost;
  d.mortgaged = false;
  emit(state, 'cash', { player: p.id, amount: -cost, balance: p.cash, reason: `Lifted mortgage on ${sp.name}` });
  emit(state, 'mortgage', { player: p.id, space: i, on: false });
  return done();
}

// --- jail ------------------------------------------------------------------

function doPayJail(state, p) {
  if (!p.inJail) return fail('You are not in gridlock.');
  if (state.phase !== 'preroll') return fail('Too late this turn.');
  if (p.cash < JAIL_FINE) return fail('You cannot afford the fine.');
  p.cash -= JAIL_FINE;
  emit(state, 'cash', { player: p.id, amount: -JAIL_FINE, balance: p.cash, reason: 'Gridlock fine' });
  if (state.settings.freeParkingPot) state.pot += JAIL_FINE;
  p.inJail = false;
  p.jailRolls = 0;
  emit(state, 'jailOut', { player: p.id, how: 'paid' });
  return done();
}

function doUseJailCard(state, p) {
  if (!p.inJail) return fail('You are not in gridlock.');
  if (p.jailCards <= 0) return fail('You have no card.');
  p.jailCards -= 1;
  p.inJail = false;
  p.jailRolls = 0;
  emit(state, 'jailOut', { player: p.id, how: 'card' });
  return done();
}

// --- trading ---------------------------------------------------------------

function sideIsValid(state, ownerId, side) {
  if (!side) return false;
  if (!Number.isFinite(side.cash) || side.cash < 0) return false;
  if (side.cash > player(state, ownerId).cash) return false;
  if (!Array.isArray(side.spaces)) return false;
  for (const i of side.spaces) {
    const d = state.deeds[i];
    if (!d || d.owner !== ownerId) return false;
    const sp = BOARD[i];
    // Nothing with buildings standing on it can change hands.
    if (sp.type === 'prop' && GROUP_SPACES[sp.group].some((g) => state.deeds[g].houses > 0)) return false;
  }
  const cards = side.jailCards || 0;
  if (cards < 0 || cards > player(state, ownerId).jailCards) return false;
  return true;
}

function doProposeTrade(state, p, action) {
  if (state.phase === 'gameover') return fail('The game is over.');
  if (state.trade) return fail('Another trade is already on the table.');
  const other = player(state, action.to);
  if (!other || other.bankrupt || other.id === p.id) return fail('Pick a player still in the game.');
  const give = { cash: 0, spaces: [], jailCards: 0, ...action.give };
  const get = { cash: 0, spaces: [], jailCards: 0, ...action.get };
  if (!sideIsValid(state, p.id, give)) return fail('You cannot offer that.');
  if (!sideIsValid(state, other.id, get)) return fail('They cannot give that.');
  if (give.cash === 0 && get.cash === 0 && give.spaces.length === 0 && get.spaces.length === 0
      && !give.jailCards && !get.jailCards) return fail('An empty trade.');

  state.trade = { from: p.id, to: other.id, give, get };
  emit(state, 'tradeOffer', { from: p.id, to: other.id, give, get });
  return done();
}

function doRespondTrade(state, p, action) {
  const t = state.trade;
  if (!t) return fail('No trade on the table.');
  if (t.to !== p.id && t.from !== p.id) return fail('Not your trade.');
  // Either side can walk away; only the recipient can accept.
  if (!action.accept) {
    state.trade = null;
    emit(state, 'tradeResult', { from: t.from, to: t.to, accepted: false, by: p.id });
    return done();
  }
  if (t.to !== p.id) return fail('Only the other player can accept.');
  if (!sideIsValid(state, t.from, t.give) || !sideIsValid(state, t.to, t.get)) {
    state.trade = null;
    emit(state, 'tradeResult', { from: t.from, to: t.to, accepted: false, stale: true });
    return fail('The trade is no longer valid.');
  }

  const a = player(state, t.from), b = player(state, t.to);
  a.cash -= t.give.cash; b.cash += t.give.cash;
  b.cash -= t.get.cash;  a.cash += t.get.cash;
  a.jailCards -= t.give.jailCards; b.jailCards += t.give.jailCards;
  b.jailCards -= t.get.jailCards;  a.jailCards += t.get.jailCards;
  for (const i of t.give.spaces) state.deeds[i].owner = b.id;
  for (const i of t.get.spaces)  state.deeds[i].owner = a.id;

  emit(state, 'tradeResult', { from: t.from, to: t.to, accepted: true, give: t.give, get: t.get });
  state.trade = null;
  trySettleDebt(state);
  return done();
}

// --- setup -----------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  startCash: 1500,
  auctions: true,        // official rule: declined properties go to auction
  freeParkingPot: false, // house rule: fines pile up on Gas Works Park
};

export function createGame({ players, settings = {}, seed = 1 }) {
  const state = {
    rng: seed >>> 0,
    seq: 0,
    round: 0,
    turn: 0,
    phase: 'preroll',
    dice: [0, 0],
    doubles: 0,
    canRollAgain: false,
    houses: TOTAL_HOUSES,
    hotels: TOTAL_HOTELS,
    pot: 0,
    pendingBuy: null,
    debt: null,
    pendingPayEach: null,
    auction: null,
    auctionQueue: [],
    trade: null,
    rentMultiplier: 1,
    winner: null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: [],
    deeds: [],
    log: [],
    chanceDeck: [],
    chestDeck: [],
  };

  state.players = players.map((p, idx) => ({
    id: p.id,
    name: p.name,
    token: p.token,
    isCPU: !!p.isCPU,
    cash: state.settings.startCash,
    pos: 0,
    inJail: false,
    jailRolls: 0,
    jailCards: 0,
    bankrupt: false,
    order: idx,
  }));

  for (let i = 0; i < 40; i++) {
    const sp = BOARD[i];
    state.deeds[i] = (sp.type === 'prop' || sp.type === 'rail' || sp.type === 'utility')
      ? { owner: null, houses: 0, mortgaged: false }
      : null;
  }

  state.chanceDeck = shuffle(state, CHANCE.map((c) => c.id));
  state.chestDeck = shuffle(state, CHEST.map((c) => c.id));

  emit(state, 'start', { players: state.players.map((p) => p.id) });
  emit(state, 'turn', { player: state.players[0].id });
  return state;
}

/** Actions the given player may legally take right now — drives the UI. */
export function legalActions(state, playerId) {
  const out = [];
  const p = player(state, playerId);
  if (!p || p.bankrupt || state.phase === 'gameover') return out;

  const isTurn = current(state)?.id === playerId;

  if (state.trade && state.trade.to === playerId) out.push('respondTrade');
  else if (state.trade && state.trade.from === playerId) out.push('cancelTrade');
  else if (!state.debt) out.push('proposeTrade');

  if (state.phase === 'auction' && state.auction?.order[state.auction.turnIdx] === playerId) {
    out.push('bid', 'passBid');
    return out;
  }

  if (state.phase === 'debt' && state.debt.debtor === playerId) {
    out.push('mortgage', 'sellHouse', 'concede');
    return out;
  }

  if (!isTurn) return out;

  switch (state.phase) {
    case 'preroll':
      if (p.inJail) {
        out.push('roll');
        if (p.cash >= JAIL_FINE) out.push('payJail');
        if (p.jailCards > 0) out.push('useJailCard');
      } else {
        out.push('roll');
      }
      if (state.canRollAgain) out.push('endTurn');
      out.push('buildHouse', 'sellHouse', 'mortgage', 'unmortgage');
      break;
    case 'buy':
      if (p.cash >= BOARD[state.pendingBuy].price) out.push('buy');
      out.push('decline');
      break;
    case 'end':
      out.push('endTurn', 'buildHouse', 'sellHouse', 'mortgage', 'unmortgage');
      break;
    default:
      break;
  }
  return out;
}
