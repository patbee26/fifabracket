# Emerald City

A Seattle-themed property trading game for 2–8 players — online with family on their own
devices, around one screen, or against the computer. No build step, no framework.

## Play

Locally, with the multiplayer API running:

```bash
node scripts/monopoly_dev_server.mjs      # http://localhost:4319/monopoly/
```

Rooms in the dev server are in-memory and vanish when the process stops. For behaviour
identical to production (persistent rooms via Netlify Blobs) use `netlify dev` instead.

Solo and pass-and-play work from any static server, since the engine runs in the browser:

```bash
python3 -m http.server -d web 4318        # http://localhost:4318/monopoly/
```

## Modes

| Mode | How it works |
|------|--------------|
| **Online** | The host gets a four-letter room code; everyone else joins from their own device. The server is authoritative. |
| **Play the CPU** | You against 1–4 bots, entirely in your browser. |
| **Pass & play** | 2–6 people sharing one screen. |

CPU players can be added to an online game too, so four family members plus two bots is fine.

## The board

Seattle by property value, from the Duwamish flats to the lakeshore:

| Group | Spaces |
|-------|--------|
| Duwamish | South Park, Georgetown |
| South End | White Center, Beacon Hill, Rainier Beach |
| Central | Columbia City, Greenwood, Lake City |
| Ship Canal | Wallingford, Fremont, Ballard |
| West & North | West Seattle, Green Lake, Magnolia |
| Waterfront | Belltown, Pioneer Square, Pike Place Market |
| The Hills | Queen Anne, Capitol Hill, Downtown |
| Lakeside | Madison Park, Medina |

Railroads are transit — Bainbridge Ferry, Link Light Rail, Sounder Train and the Monorail.
Utilities are Seattle City Light and Seattle Public Utilities. Jail is **Gridlock**, Free
Parking is **Gas Works Park**, Chance is **Rainy Day** and Community Chest is the
**Community Board**. There is no income tax square, because Washington has no income tax —
you pay **B&O Tax** instead.

The prices and rent tables are the standard ones, so the game plays exactly as you expect.

## Rules

Everything is implemented:

- Buying, rent, and rent doubling on a complete colour group
- Auctions when a property is declined (the official rule, and the default)
- Houses and hotels, with the even-build rule and the 32-house / 12-hotel bank supply
- Mortgaging, and lifting a mortgage at 10% interest
- Gridlock: three-doubles speeding, rolling out, paying the fine, get-out-of-gridlock cards
- Player-to-player trading — deeds, cash and cards on both sides
- Debt: you must sell buildings or mortgage deeds before you may declare bankruptcy
- Bankruptcy chains, including the bank re-auctioning a repossessed portfolio

House rules are toggled in the waiting room: auctions on or off, money piling up on Gas
Works Park, and the starting cash.

Two deliberate simplifications, both to avoid stacking several simultaneous debts:

- "Collect from every player" cards take whatever a player has if they cannot pay in full,
  rather than forcing each of them into their own bankruptcy resolution.
- A bankruptcy owed to the bank returns houses to the supply and re-auctions the deeds,
  rather than transferring mortgages with their debt attached.

## Files

| File | Purpose |
|------|---------|
| `board.js` | The 40 spaces, colour groups, and both card decks |
| `engine.js` | Rules engine — deterministic, seeded, no DOM |
| `ai.js` | CPU opponents: valuation, bidding, building, trading |
| `ui.js` | Board rendering, token animation, modals, effects |
| `net.js` | Client for the multiplayer API, plus adaptive polling |
| `app.js` | Screen flow and the bridge between engine and network |
| `sound.js` | Web Audio sound effects, synthesized — nothing downloaded |
| `styles.css` | Layout, theming, animation |

The engine is shared byte-for-byte with the server (`netlify/lib/rooms.mjs` imports it), so
every action a client takes is re-validated against identical rules.

## Multiplayer

`POST /api/game` with an `op` field: `create`, `join`, `addCpu`, `removeSeat`, `start`,
`action`, `state`. Rooms live in Netlify Blobs. Each player holds a secret issued at join
time, so nobody can act as anyone else, and the server never returns another player's secret.

Clients poll rather than hold a socket open — a turn-based board game does not need one.
Polling backs off when the tab is hidden and speeds up right after you act. Because the
server owns the state, closing a tab loses nothing: reopen the page and rejoin.

CPU turns are resolved server-side inside whichever request is in flight, bounded per
request, so a game of bots still finishes if every human has been knocked out.

## Tests

```bash
node tests/test_monopoly_engine.mjs   # rules
node tests/test_monopoly_ai.mjs       # CPU behaviour, full bot games
node tests/test_monopoly_server.mjs   # rooms, auth, concurrency
```

No dependencies — the server tests run the real request handler against an in-memory
stand-in for Netlify Blobs, conditional writes included.
