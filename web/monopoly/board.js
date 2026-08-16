// Seattle board data — 40 spaces, classic economy re-skinned to the city.
// Shared verbatim by the browser client and the Netlify function, so this file
// must stay dependency-free and side-effect-free.

export const GROUPS = {
  duwamish:  { name: 'Duwamish',      color: '#6b4f3a', house: 50 },
  south:     { name: 'South End',     color: '#8fd3f4', house: 50 },
  central:   { name: 'Central',       color: '#e05f8a', house: 100 },
  canal:     { name: 'Ship Canal',    color: '#f08a3c', house: 100 },
  west:      { name: 'West & North',  color: '#d1414a', house: 150 },
  waterfront:{ name: 'Waterfront',    color: '#f2c14e', house: 150 },
  hills:     { name: 'The Hills',     color: '#3f9b6d', house: 200 },
  lakeside:  { name: 'Lakeside',      color: '#2d5fa8', house: 200 },
};

// Rent tables are [base, 1 house, 2, 3, 4, hotel].
export const BOARD = [
  { i: 0,  type: 'go',       name: 'GO',                     blurb: 'Collect $200 salary as you pass' },
  { i: 1,  type: 'prop',     name: 'South Park',             group: 'duwamish',   price: 60,  rent: [2, 10, 30, 90, 160, 250] },
  { i: 2,  type: 'chest',    name: 'Community Board' },
  { i: 3,  type: 'prop',     name: 'Georgetown',             group: 'duwamish',   price: 60,  rent: [4, 20, 60, 180, 320, 450] },
  { i: 4,  type: 'tax',      name: 'B&O Tax',                amount: 200, blurb: 'No income tax in Washington — but the B&O gets you anyway' },
  { i: 5,  type: 'rail',     name: 'Bainbridge Ferry',       price: 200 },
  { i: 6,  type: 'prop',     name: 'White Center',           group: 'south',      price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { i: 7,  type: 'chance',   name: 'Rainy Day' },
  { i: 8,  type: 'prop',     name: 'Beacon Hill',            group: 'south',      price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { i: 9,  type: 'prop',     name: 'Rainier Beach',          group: 'south',      price: 120, rent: [8, 40, 100, 300, 450, 600] },
  { i: 10, type: 'jail',     name: 'Gridlock',               blurb: 'Just passing through' },
  { i: 11, type: 'prop',     name: 'Columbia City',          group: 'central',    price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { i: 12, type: 'utility',  name: 'Seattle City Light',     price: 150 },
  { i: 13, type: 'prop',     name: 'Greenwood',              group: 'central',    price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { i: 14, type: 'prop',     name: 'Lake City',              group: 'central',    price: 160, rent: [12, 60, 180, 500, 700, 900] },
  { i: 15, type: 'rail',     name: 'Link Light Rail',        price: 200 },
  { i: 16, type: 'prop',     name: 'Wallingford',            group: 'canal',      price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { i: 17, type: 'chest',    name: 'Community Board' },
  { i: 18, type: 'prop',     name: 'Fremont',                group: 'canal',      price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { i: 19, type: 'prop',     name: 'Ballard',                group: 'canal',      price: 200, rent: [16, 80, 220, 600, 800, 1000] },
  { i: 20, type: 'parking',  name: 'Gas Works Park',         blurb: 'Free parking — a Seattle fantasy' },
  { i: 21, type: 'prop',     name: 'West Seattle',           group: 'west',       price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { i: 22, type: 'chance',   name: 'Rainy Day' },
  { i: 23, type: 'prop',     name: 'Green Lake',             group: 'west',       price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { i: 24, type: 'prop',     name: 'Magnolia',               group: 'west',       price: 240, rent: [20, 100, 300, 750, 925, 1100] },
  { i: 25, type: 'rail',     name: 'Sounder Train',          price: 200 },
  { i: 26, type: 'prop',     name: 'Belltown',               group: 'waterfront', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { i: 27, type: 'prop',     name: 'Pioneer Square',         group: 'waterfront', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { i: 28, type: 'utility',  name: 'Seattle Public Utilities', price: 150 },
  { i: 29, type: 'prop',     name: 'Pike Place Market',      group: 'waterfront', price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
  { i: 30, type: 'gotojail', name: 'Go To Gridlock',         blurb: 'I-5 is stopped. Again.' },
  { i: 31, type: 'prop',     name: 'Queen Anne',             group: 'hills',      price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { i: 32, type: 'prop',     name: 'Capitol Hill',           group: 'hills',      price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { i: 33, type: 'chest',    name: 'Community Board' },
  { i: 34, type: 'prop',     name: 'Downtown',               group: 'hills',      price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
  { i: 35, type: 'rail',     name: 'Seattle Center Monorail', price: 200 },
  { i: 36, type: 'chance',   name: 'Rainy Day' },
  { i: 37, type: 'prop',     name: 'Madison Park',           group: 'lakeside',   price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
  { i: 38, type: 'tax',      name: 'Sales Tax',              amount: 100, blurb: 'Highest in the state' },
  { i: 39, type: 'prop',     name: 'Medina',                 group: 'lakeside',   price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
];

export const GO_SALARY = 200;
export const JAIL_INDEX = 10;
export const JAIL_FINE = 50;
export const MORTGAGE_INTEREST = 0.1; // 10% to lift a mortgage
export const TOTAL_HOUSES = 32;
export const TOTAL_HOTELS = 12;

// Every space index belonging to a colour group, precomputed for monopoly checks.
export const GROUP_SPACES = {};
for (const s of BOARD) {
  if (s.type === 'prop') (GROUP_SPACES[s.group] ||= []).push(s.i);
}

export const RAIL_SPACES = BOARD.filter((s) => s.type === 'rail').map((s) => s.i);
export const UTIL_SPACES = BOARD.filter((s) => s.type === 'utility').map((s) => s.i);

// Railroad rent doubles per railroad held: 25 / 50 / 100 / 200.
export const RAIL_RENT = [0, 25, 50, 100, 200];
// Utilities: 4x dice with one, 10x with both.
export const UTIL_MULTIPLIER = [0, 4, 10];

export const TOKENS = [
  { id: 'coffee',  label: 'Coffee Cup',   emoji: '☕' },
  { id: 'ferry',   label: 'Ferry',        emoji: '⛴️' },
  { id: 'salmon',  label: 'Salmon',       emoji: '🐟' },
  { id: 'guitar',  label: 'Guitar',       emoji: '🎸' },
  { id: 'rain',    label: 'Umbrella',     emoji: '☂️' },
  { id: 'plane',   label: 'Jet',          emoji: '✈️' },
  { id: 'tower',   label: 'Space Needle', emoji: '🗼' },
  { id: 'crab',    label: 'Dungeness Crab', emoji: '🦀' },
];

// ---------------------------------------------------------------------------
// Cards
//
// `action` values are interpreted by the engine:
//   money        amount (+/-) from the bank
//   collectEach  amount from every other solvent player
//   payEach      amount to every other solvent player
//   move         to a space index; `pass` false means no GO salary even if wrapped
//   moveBy       relative steps (can be negative)
//   nearest      'rail' | 'utility'  — advance to nearest, with special rent
//   jail         go directly to gridlock
//   getOut       keep a get-out-of-gridlock card
//   repairs      perHouse / perHotel assessed across everything you own
// ---------------------------------------------------------------------------

export const CHANCE = [
  { id: 'c1',  text: 'The sun is out. The whole city goes outside. Advance to GO.', action: 'move', to: 0, pass: true },
  { id: 'c2',  text: 'Seahawks home game. Advance to Downtown.', action: 'move', to: 34, pass: true },
  { id: 'c3',  text: 'Farmers market run. Advance to Pike Place Market.', action: 'move', to: 29, pass: true },
  { id: 'c4',  text: 'Brunch line in Columbia City. Advance there.', action: 'move', to: 11, pass: true },
  { id: 'c5',  text: 'You sprint for the last boat. Advance to the nearest transit stop and pay double the fare.', action: 'nearest', kind: 'rail' },
  { id: 'c6',  text: 'The power flickers. Advance to the nearest utility and pay ten times your roll.', action: 'nearest', kind: 'utility' },
  { id: 'c7',  text: 'Your sourdough starter goes viral. Collect $50.', action: 'money', amount: 50 },
  { id: 'c8',  text: 'You talk your way out of a parking ticket. Get out of Gridlock free.', action: 'getOut' },
  { id: 'c9',  text: 'Wrong exit off I-5. Go back three spaces.', action: 'moveBy', steps: -3 },
  { id: 'c10', text: 'A protest closes Mercer. Go directly to Gridlock.', action: 'jail' },
  { id: 'c11', text: 'Moss on the roof. Repairs cost $25 per house and $100 per hotel.', action: 'repairs', perHouse: 25, perHotel: 100 },
  { id: 'c12', text: 'Speeding on the 520 bridge. Pay $15.', action: 'money', amount: -15 },
  { id: 'c13', text: 'Weekend on the peninsula. Take the Bainbridge Ferry.', action: 'move', to: 5, pass: true },
  { id: 'c14', text: 'You are elected to the neighborhood council. Pay each player $50.', action: 'payEach', amount: 50 },
  { id: 'c15', text: 'Your startup gets acquired. Collect $150.', action: 'money', amount: 150 },
  { id: 'c16', text: 'You win the latte art throwdown. Collect $100.', action: 'money', amount: 100 },
];

export const CHEST = [
  { id: 'h1',  text: 'Advance to GO.', action: 'move', to: 0, pass: true },
  { id: 'h2',  text: 'Bank error in your favor. Collect $200.', action: 'money', amount: 200 },
  { id: 'h3',  text: 'Urgent care after a bike lane incident. Pay $50.', action: 'money', amount: -50 },
  { id: 'h4',  text: 'You sell your Amazon vest collection. Collect $50.', action: 'money', amount: 50 },
  { id: 'h5',  text: 'A friend on the council owes you one. Get out of Gridlock free.', action: 'getOut' },
  { id: 'h6',  text: 'Caught riding the Link without tapping. Go directly to Gridlock.', action: 'jail' },
  { id: 'h7',  text: 'Opening night at the opera. Collect $50 from every player.', action: 'collectEach', amount: 50 },
  { id: 'h8',  text: 'It is your birthday. Collect $10 from each player.', action: 'collectEach', amount: 10 },
  { id: 'h9',  text: 'Your rainy day fund matures. Collect $100.', action: 'money', amount: 100 },
  { id: 'h10', text: 'Hospital fees. Pay $100.', action: 'money', amount: -100 },
  { id: 'h11', text: 'Tuition at the community college. Pay $50.', action: 'money', amount: -50 },
  { id: 'h12', text: 'Consulting gig for a coffee chain. Collect $25.', action: 'money', amount: 25 },
  { id: 'h13', text: 'The city repaves your street. Pay $40 per house and $115 per hotel.', action: 'repairs', perHouse: 40, perHotel: 115 },
  { id: 'h14', text: 'Second place in the Seafair milk carton derby. Collect $10.', action: 'money', amount: 10 },
  { id: 'h15', text: 'You inherit a cabin on the Olympic Peninsula. Collect $100.', action: 'money', amount: 100 },
  { id: 'h16', text: 'Sales tax refund. Collect $20.', action: 'money', amount: 20 },
];

export const space = (i) => BOARD[((i % 40) + 40) % 40];
