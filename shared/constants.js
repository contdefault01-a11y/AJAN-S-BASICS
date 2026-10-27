// Shared gameplay constants used by both the server simulation and the browser client.

export const CELL = 2.5;            // world units per grid cell
export const WALL_H = 7.5;          // ceiling height (one hallway width, like the Classic school)
export const EYE_H = 3.4;
export const PLAYER_R = 0.7;

export const WALK_SPEED = 7.5;
export const RUN_SPEED = 12;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 20;     // per second while sprinting
export const STAMINA_REGEN = 12;     // per second while walking / idle

export const INTERACT_DIST = 4.2;
export const INVENTORY_SLOTS = 3;
export const EXERCISE_COUNT = 7;
export const CALORIE_GOAL = 7000;

export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 15;
export const CLIENT_SEND_HZ = 15;

// Per-player phases (server authoritative). MENU / LOADING / PAUSED are client-only.
export const PHASE = Object.freeze({
  MENU: 'MENU',
  LOADING: 'LOADING',
  INTRO: 'INTRO',
  TRAINING: 'TRAINING',
  COLLECT_CASH: 'COLLECT_CASH',
  FAST_FOOD: 'FAST_FOOD',
  FINAL_ESCAPE: 'FINAL_ESCAPE',
  DETENTION: 'DETENTION',   // overlay status; tracked as player.detention but exposed for UI
  CAUGHT: 'CAUGHT',
  VICTORY: 'VICTORY',
  PAUSED: 'PAUSED',
});

// Legal phase transitions for the main objective chain.
export const PHASE_TRANSITIONS = Object.freeze({
  INTRO: ['TRAINING', 'CAUGHT'],
  TRAINING: ['COLLECT_CASH', 'CAUGHT'],
  COLLECT_CASH: ['FAST_FOOD', 'FINAL_ESCAPE', 'CAUGHT'],
  FAST_FOOD: ['FINAL_ESCAPE', 'CAUGHT'],
  FINAL_ESCAPE: ['VICTORY', 'CAUGHT'],
  CAUGHT: ['INTRO'],
  VICTORY: ['INTRO'],
});

export function canTransition(from, to) {
  return (PHASE_TRANSITIONS[from] || []).includes(to);
}

export const ITEMS = Object.freeze({
  scissors: { id: 'scissors', name: 'Safety Scissors', desc: "Cuts Playtime's rope and 1st Prize's wires." },
  coin:     { id: 'coin',     name: 'Shiny Quarter',  desc: 'Use on a vending machine.' },
  soda:     { id: 'soda',     name: 'AJAN Cola',       desc: 'Sprays a fizzy blast that pushes characters away.' },
  keys:     { id: 'keys',     name: "Principal's Keys", desc: 'Unlocks the detention door early.' },
  bar:      { id: 'bar',      name: 'Protein Bar',     desc: 'Restores stamina (overfills to 200%).' },
  lock:     { id: 'lock',     name: 'Swinging Door Lock', desc: 'Locks the door you look at for 20 seconds.' },
  sneakers: { id: 'sneakers', name: 'Quiet Sneakers',  desc: 'For 30 seconds AJAN cannot hear doors you open.' },
  clock:    { id: 'clock',    name: 'Alarm Clock',     desc: 'Drop it: it rings after 5 seconds and lures AJAN.' },
  energy:   { id: 'energy',   name: 'Energy Drink',    desc: 'Unlimited sprint for 15 seconds.' },
});

// Items the Bully is allowed to steal (cash is never an inventory item).
export const BULLY_STEALABLE = Object.keys(ITEMS);

// Fast-food menus. Prices in cents. Values are game-balance examples, not official nutrition data.
export const RESTAURANTS = Object.freeze({
  kfc: {
    id: 'kfc', name: 'KFC', colors: ['#c8102e', '#ffffff'],
    menu: [
      { id: 'kfc_bucket',  name: '8pc Bucket',           price: 899, cal: 2900 },
      { id: 'kfc_bowl',    name: 'Famous Bowl',          price: 499, cal: 720 },
      { id: 'kfc_sand',    name: 'Chicken Sandwich',     price: 449, cal: 650 },
      { id: 'kfc_nugget',  name: 'Popcorn Nuggets',      price: 349, cal: 560 },
      { id: 'kfc_mac',     name: 'Mac & Cheese',         price: 249, cal: 340 },
      { id: 'kfc_biscuit', name: 'Biscuit',              price: 129, cal: 180 },
      { id: 'kfc_pepsi',   name: 'Large Pepsi',          price: 199, cal: 410 },
    ],
  },
  popeyes: {
    id: 'popeyes', name: 'Popeyes', colors: ['#f26522', '#ffffff'],
    menu: [
      { id: 'pop_bigbox',  name: 'Big Box Family Meal',  price: 999, cal: 3500 },
      { id: 'pop_sand',    name: 'Spicy Chicken Sandwich', price: 499, cal: 700 },
      { id: 'pop_tenders', name: '5pc Tenders',          price: 599, cal: 1050 },
      { id: 'pop_fries',   name: 'Large Cajun Fries',    price: 299, cal: 640 },
      { id: 'pop_beans',   name: 'Red Beans & Rice',     price: 249, cal: 390 },
      { id: 'pop_pie',     name: 'Apple Pie',            price: 149, cal: 236 },
      { id: 'pop_tea',     name: 'Large Sweet Tea',      price: 179, cal: 380 },
    ],
  },
});

export function findMenuItem(itemId) {
  for (const r of Object.values(RESTAURANTS)) {
    const m = r.menu.find((i) => i.id === itemId);
    if (m) return { restaurant: r.id, ...m };
  }
  return null;
}

// Best calories-per-cent on the menu: used by the server to guarantee the goal stays reachable.
export const BEST_CAL_PER_CENT = Math.max(
  ...Object.values(RESTAURANTS).flatMap((r) => r.menu.map((m) => m.cal / m.price))
);

// Cash pickup value distribution ($1-$4).
export const CASH_VALUES = [
  { v: 1, w: 35 },
  { v: 2, w: 30 },
  { v: 3, w: 20 },
  { v: 4, w: 15 },
];

export const AUDIO = Object.freeze({
  menuvoice: 'AJANMENU.mp3',
  start: 'AJANSTART.mp3',
  coin: 'AJANCOIN.mp3',
  principal1: 'PRINCIPAL1.mp3',
  principal2: 'PRINCIPAL2.mp3',
  playtime1: 'PLAYTIME1.mp3',
  playtime2: 'PLAYTIME2.mp3',
  bullysee: 'BULLYSEE.mp3',
  bullytake: 'BULLYTAKE.mp3',
  bullypass: 'BULLYPASS.mp3',
  mad: 'AJANMAD.mp3',
  prize: 'PRIZE.mp3',
  stomp: 'STOMP.mp3',
  sweep: 'sweep.wav',          // Gotta Sweep is coming for you
  sweepout: 'sweepout.wav',    // Gotta Sweep leaves his closet (everyone hears it)
  whistle: 'whistle.mp3',      // the Principal's random whistle
  childmusic: 'childmusic.wav', // Arts and Crafters' song
  win: 'WIN.wav',
  jump1: 'jump1.wav',
  jump2: 'jump2.wav',
  jump3: 'jump3.wav',
  catboypass: 'CATBOYPASS.mp3',
  catboypass2: 'CATBOYPASS2.mp3',
  catboysee: 'CATBOYSEE.mp3',
  catboygood: 'CATBOYGOOD.mp3',
  catboyajan: 'CATBOYAJAN.mp3',
  catboyprincipal: 'CATBOYPRINCIPAL.mp3',
  facu: 'FACU.mp3',            // Principal: you entered the faculty room
  prinbul: 'prinbul.mp3',      // Principal: he saw the Bully steal
  pr1: 'pr1.mp3', pr2: 'pr2.mp3', pr3: 'pr3.mp3', // Principal leaving detention
  lockcaught: 'lock.mp3',      // Principal: he saw you climb into a locker
  // music (looping, quieter than voices)
  menu: 'musicmenu.wav',
  music1: 'music1.wav',
  music2: 'music2.wav',
  musicwrong: 'musicwrong.wav',
  musicescape: 'musicescape.wav',
});

// Story beats of a match (room-wide): AJAN welcomes you, gives a coin after the first
// exercise, and the impossible second exercise starts the chase.
export const STORY = Object.freeze({ WELCOME: 'welcome', COIN: 'coin', CHASE: 'chase' });

export function fmtCash(cents) {
  return '$' + (cents / 100).toFixed(2);
}
