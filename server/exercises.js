// Seven distinct training exercises. The server generates a randomized puzzle (spec + secret
// solution) when a player opens a station and validates whatever the client submits.
// The spec sent to the client never contains the solution unless the exercise is a memory /
// dexterity task whose content must be shown to the player anyway.

export const EXERCISE_TYPES = ['order', 'register', 'timing', 'ingredients', 'prep', 'quiz', 'qc'];

export const EXERCISE_INFO = {
  order:       { title: 'ORDER ASSEMBLY',      blurb: 'Put exactly what is on the ticket onto the tray.' },
  register:    { title: 'CASH REGISTER',       blurb: 'Ring up the exact total using the register keys.' },
  timing:      { title: 'KITCHEN TIMING',      blurb: 'Stop the fryer needle inside the green zone 3 times.' },
  ingredients: { title: 'INGREDIENT SELECTION', blurb: 'Pick only the ingredients the recipe asks for.' },
  prep:        { title: 'FOOD PREPARATION',    blurb: 'Watch the prep steps light up, then repeat them in order.' },
  quiz:        { title: 'TRAINING QUIZ',       blurb: 'Answer all three questions correctly.' },
  qc:          { title: 'QUALITY CONTROL',     blurb: 'Compare the ticket with the tray and find the problem.' },
};

const FOODS = ['Drumstick', 'Wings', 'Burger', 'Fries', 'Biscuit', 'Coleslaw', 'Soda', 'Corn', 'Nuggets', 'Pie'];

const RECIPES = [
  { name: 'Spicy Chicken Sandwich', need: ['Brioche Bun', 'Spicy Fillet', 'Pickles', 'Spicy Mayo'] },
  { name: 'Classic Chicken Wrap', need: ['Tortilla', 'Tenders', 'Lettuce', 'Ranch'] },
  { name: 'Famous Bowl', need: ['Mashed Potatoes', 'Corn', 'Popcorn Chicken', 'Gravy', 'Cheese'] },
  { name: 'Cajun Fries Basket', need: ['Fries', 'Cajun Seasoning', 'Salt'] },
  { name: 'Breakfast Biscuit', need: ['Biscuit', 'Egg', 'Cheese', 'Bacon'] },
  { name: 'Chicken Burger Deluxe', need: ['Sesame Bun', 'Fillet', 'Lettuce', 'Tomato', 'Mayo'] },
];
const ALL_INGREDIENTS = [...new Set(RECIPES.flatMap((r) => r.need).concat(['Onion', 'Ketchup', 'Mustard', 'Jalapenos', 'Honey', 'Butter', 'Rice']))];

const PREP_STEPS = [
  { id: 'bread', label: 'BREAD', color: '#e8c07a' },
  { id: 'fry', label: 'FRY', color: '#ff8a00' },
  { id: 'drain', label: 'DRAIN', color: '#8ad0ff' },
  { id: 'season', label: 'SEASON', color: '#ff3b3b' },
  { id: 'box', label: 'BOX', color: '#ffffff' },
  { id: 'serve', label: 'SERVE', color: '#5be35b' },
];

const QUIZ_BANK = [
  { q: 'How many training exercises must you finish?', a: '7', w: ['5', '3', '10'] },
  { q: 'How many calories does AJAN want you to eat?', a: '7,000', w: ['700', '2,000', '70,000'] },
  { q: 'What does the Principal hate seeing in the halls?', a: 'Running', w: ['Walking', 'Reading', 'Eating apples'] },
  { q: 'Which item cuts a jump rope?', a: 'Safety Scissors', w: ['AJAN Cola', 'Alarm Clock', 'Protein Bar'] },
  { q: 'Fryer oil should be changed when it is...', a: 'Dark and smoky', w: ['Fresh', 'Cold', 'Sparkling'] },
  { q: 'Where do you buy food in this school?', a: 'KFC and Popeyes', w: ['The gym', 'The janitor closet', 'Room 102'] },
  { q: 'A customer pays $10 for a $7.50 meal. Change?', a: '$2.50', w: ['$3.50', '$2.00', '$17.50'] },
  { q: 'Wash your hands for at least...', a: '20 seconds', w: ['2 seconds', '1 minute of thinking', 'Never'] },
  { q: 'What does the Bully want from you?', a: 'One of your items', w: ['Your cash', 'A hug', 'Homework'] },
  { q: 'Hot food must be kept...', a: 'Hot', w: ['On the floor', 'In your pocket', 'Frozen'] },
  { q: 'Who sweeps the halls?', a: 'Gotta Sweep', w: ['1st Prize', 'Playtime', 'The Principal'] },
  { q: 'What does AJAN do when he walks?', a: 'Stomps', w: ['Tiptoes', 'Moonwalks', 'Hovers'] },
  { q: 'The first thing to say to a customer is...', a: 'Welcome! Can I take your order?', w: ['Go away', 'Run!', 'We are closed'] },
  { q: 'Which character pushes you with a hug?', a: '1st Prize', w: ['Arts and Crafters', 'The Bully', 'AJAN'] },
];

const pickN = (rng, arr, n) => rng.shuffle(arr.slice()).slice(0, n);

export function generateExercise(type, rng) {
  switch (type) {
    case 'order': {
      const items = pickN(rng, FOODS, rng.int(3, 4));
      const ticket = items.map((item) => ({ item, qty: rng.int(1, 3) }));
      const options = rng.shuffle(pickN(rng, FOODS.filter((f) => !items.includes(f)), 4).concat(items));
      return { spec: { type, ticket, options }, solution: Object.fromEntries(ticket.map((t) => [t.item, t.qty])) };
    }
    case 'register': {
      const target = rng.int(101, 1999);
      return { spec: { type, target, keys: [1000, 500, 100, 25, 10, 5, 1] }, solution: target };
    }
    case 'timing': {
      const zones = [];
      for (let i = 0; i < 3; i++) {
        const width = 0.12 + rng() * 0.06;
        zones.push({ start: 0.1 + rng() * (0.8 - width), width });
      }
      return { spec: { type, zones, speed: 0.55 + rng() * 0.25, maxMisses: 2 }, solution: zones };
    }
    case 'ingredients': {
      const recipe = rng.pick(RECIPES);
      const distract = pickN(rng, ALL_INGREDIENTS.filter((i) => !recipe.need.includes(i)), 10 - recipe.need.length);
      return { spec: { type, recipe: recipe.name, need: recipe.need, options: rng.shuffle(recipe.need.concat(distract)) }, solution: recipe.need.slice().sort() };
    }
    case 'prep': {
      const len = 5;
      const seq = [];
      for (let i = 0; i < len; i++) {
        let s;
        do s = rng.int(0, PREP_STEPS.length - 1); while (seq.length && s === seq[seq.length - 1]);
        seq.push(s);
      }
      return { spec: { type, steps: PREP_STEPS, sequence: seq, flashMs: 650 }, solution: seq };
    }
    case 'quiz': {
      const qs = pickN(rng, QUIZ_BANK, 3).map((q) => {
        const choices = rng.shuffle([q.a, ...q.w]);
        return { q: q.q, choices, answer: choices.indexOf(q.a) };
      });
      return { spec: { type, questions: qs.map(({ q, choices }) => ({ q, choices })) }, solution: qs.map((q) => q.answer) };
    }
    case 'qc': {
      const items = pickN(rng, FOODS, 5);
      const ticket = items.map((item) => ({ item, qty: rng.int(1, 2) }));
      const bad = rng.int(0, ticket.length - 1);
      const mode = rng.pick(['missing', 'wrong', 'qty']);
      const tray = ticket.map((t) => ({ ...t }));
      if (mode === 'missing') tray.splice(bad, 1);
      else if (mode === 'wrong') tray[bad] = { item: rng.pick(FOODS.filter((f) => !items.includes(f))), qty: ticket[bad].qty };
      else tray[bad] = { item: ticket[bad].item, qty: ticket[bad].qty + 1 };
      return { spec: { type, ticket, tray: rng.shuffle(tray) }, solution: bad };
    }
    default:
      throw new Error('unknown exercise type ' + type);
  }
}

// Returns { ok: boolean, reason?: string }. `elapsed` = seconds since the puzzle was served.
export function validateExercise(type, solution, spec, answer, elapsed) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'No answer.' };
  switch (type) {
    case 'order': {
      const counts = answer.counts || {};
      const keys = Object.keys(counts).filter((k) => counts[k] > 0);
      const want = Object.keys(solution);
      if (keys.length !== want.length) return { ok: false, reason: 'The tray does not match the ticket.' };
      for (const k of want) if (counts[k] !== solution[k]) return { ok: false, reason: 'Wrong amount of ' + k + '.' };
      return { ok: true };
    }
    case 'register': {
      const presses = Array.isArray(answer.presses) ? answer.presses : [];
      if (presses.length > 60 || presses.some((p) => !spec.keys.includes(p))) return { ok: false, reason: 'Invalid keys.' };
      const sum = presses.reduce((s, p) => s + p, 0);
      return sum === solution ? { ok: true } : { ok: false, reason: 'The drawer is off!' };
    }
    case 'timing': {
      const hits = Array.isArray(answer.hits) ? answer.hits : [];
      if (hits.length !== 3) return { ok: false, reason: 'Burnt!' };
      if (elapsed < 1.2) return { ok: false, reason: 'Too fast to be real.' };
      for (let i = 0; i < 3; i++) {
        const z = solution[i], h = Number(hits[i]);
        if (!(h >= z.start - 0.015 && h <= z.start + z.width + 0.015)) return { ok: false, reason: 'Burnt!' };
      }
      return { ok: true };
    }
    case 'ingredients': {
      const sel = Array.isArray(answer.selected) ? answer.selected.slice().sort() : [];
      return sel.length === solution.length && sel.every((s, i) => s === solution[i]) ? { ok: true } : { ok: false, reason: 'That is not the recipe!' };
    }
    case 'prep': {
      const seq = Array.isArray(answer.sequence) ? answer.sequence : [];
      if (elapsed < (solution.length * spec.flashMs) / 1000) return { ok: false, reason: 'Too fast to be real.' };
      return seq.length === solution.length && seq.every((s, i) => s === solution[i]) ? { ok: true } : { ok: false, reason: 'Wrong order!' };
    }
    case 'quiz': {
      const a = Array.isArray(answer.answers) ? answer.answers : [];
      return a.length === solution.length && a.every((x, i) => x === solution[i]) ? { ok: true } : { ok: false, reason: 'Wrong answer!' };
    }
    case 'qc':
      return answer.line === solution ? { ok: true } : { ok: false, reason: 'You approved a bad order!' };
    default:
      return { ok: false, reason: 'Unknown exercise.' };
  }
}

// Reference solver used by tests to prove every generated puzzle is solvable.
export function solveExercise(type, spec, solution) {
  switch (type) {
    case 'order': return { counts: { ...solution } };
    case 'register': {
      const presses = []; let left = solution;
      for (const k of spec.keys) while (left >= k) { presses.push(k); left -= k; }
      return { presses };
    }
    case 'timing': return { hits: solution.map((z) => z.start + z.width / 2) };
    case 'ingredients': return { selected: spec.need.slice() };
    case 'prep': return { sequence: solution.slice() };
    case 'quiz': return { answers: solution.slice() };
    case 'qc': return { line: solution };
  }
  return null;
}
