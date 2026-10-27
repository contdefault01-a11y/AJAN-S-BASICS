// Seven genuinely different training-exercise interactions rendered as retro worksheet panels.
import { audio } from './audio.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, cls, fn) => {
  const b = el('button', 'xbtn ' + (cls || ''), text);
  b.addEventListener('click', (ev) => { ev.stopPropagation(); audio.play('click', { dedupe: false }); fn(b); });
  return b;
};
const money = (c) => '$' + (c / 100).toFixed(2);

// Returns a controller { root, destroy }. submit(answer) sends to the server.
export function renderExercise(container, data, submit) {
  container.innerHTML = '';
  const { type, info, spec } = data;
  const head = el('div', 'xhead');
  head.append(el('div', 'xtitle', 'EXERCISE ' + (data.station + 1) + ': ' + info.title), el('div', 'xblurb', info.blurb));
  const body = el('div', 'xbody');
  const foot = el('div', 'xfoot');
  container.append(head, body, foot);
  const cleanups = [];

  switch (type) {
    case 'order': {
      const ticket = el('div', 'ticket');
      ticket.append(el('div', 'tk-h', 'ORDER #' + (100 + Math.floor(Math.random() * 899))));
      spec.ticket.forEach((t) => ticket.append(el('div', 'tk-l', t.qty + 'x ' + t.item)));
      const counts = {};
      const tray = el('div', 'tray');
      const renderTray = () => {
        tray.innerHTML = '<div class="tk-h">YOUR TRAY</div>';
        const keys = Object.keys(counts).filter((k) => counts[k] > 0);
        if (!keys.length) tray.append(el('div', 'tk-l dim', '(empty)'));
        keys.forEach((k) => tray.append(el('div', 'tk-l', counts[k] + 'x ' + k)));
      };
      const grid = el('div', 'grid4');
      spec.options.forEach((o) => {
        const cell = el('div', 'food');
        cell.append(el('div', 'food-n', o));
        cell.append(btn('+', 'small', () => { counts[o] = (counts[o] || 0) + 1; renderTray(); }));
        cell.append(btn('-', 'small', () => { counts[o] = Math.max(0, (counts[o] || 0) - 1); renderTray(); }));
        grid.append(cell);
      });
      renderTray();
      const row = el('div', 'row'); row.append(ticket, tray);
      body.append(row, grid);
      foot.append(btn('CLEAR TRAY', '', () => { for (const k in counts) counts[k] = 0; renderTray(); }), btn('SERVE ORDER', 'go', () => submit({ counts: { ...counts } })));
      break;
    }

    case 'register': {
      const presses = [];
      const disp = el('div', 'lcd');
      const target = el('div', 'target', 'CUSTOMER OWES: ' + money(spec.target));
      const upd = () => { disp.textContent = money(presses.reduce((s, p) => s + p, 0)); };
      const keys = el('div', 'keys');
      spec.keys.forEach((k) => keys.append(btn(k >= 100 ? '$' + k / 100 : k + '¢', 'key', () => { if (presses.length < 60) presses.push(k); upd(); })));
      upd();
      body.append(target, disp, keys);
      foot.append(btn('UNDO', '', () => { presses.pop(); upd(); }), btn('CLEAR', '', () => { presses.length = 0; upd(); }), btn('RING IT UP', 'go', () => submit({ presses: presses.slice() })));
      break;
    }

    case 'timing': {
      const gauge = el('div', 'gauge');
      const zone = el('div', 'gzone');
      const needle = el('div', 'needle');
      gauge.append(zone, needle);
      const status = el('div', 'target', 'Batch 1 of 3');
      const misses = el('div', 'dim', '');
      body.append(el('div', 'fryer', '🍗 FRYER'), gauge, status, misses);
      let i = 0, miss = 0, hits = [];
      const t0 = performance.now();
      const pos = () => {
        const t = (performance.now() - t0) / 1000 * spec.speed;
        const f = t % 2;
        return f < 1 ? f : 2 - f; // ping-pong 0..1
      };
      const showZone = () => { const z = spec.zones[i]; zone.style.left = z.start * 100 + '%'; zone.style.width = z.width * 100 + '%'; };
      showZone();
      let raf = 0;
      const loop = () => { needle.style.left = pos() * 100 + '%'; raf = requestAnimationFrame(loop); };
      loop();
      cleanups.push(() => cancelAnimationFrame(raf));
      const press = () => {
        const p = pos(), z = spec.zones[i];
        if (p >= z.start && p <= z.start + z.width) {
          hits.push(p); i++;
          audio.play('pickup', { dedupe: false });
          if (i >= 3) { cancelAnimationFrame(raf); submit({ hits }); return; }
          status.textContent = 'Batch ' + (i + 1) + ' of 3'; showZone();
        } else {
          miss++;
          audio.play('fail', { dedupe: false });
          misses.textContent = 'Missed ' + miss + ' / ' + (spec.maxMisses + 1);
          if (miss > spec.maxMisses) { cancelAnimationFrame(raf); submit({ hits: [] }); }
        }
      };
      const stopBtn = btn('STOP! (Space)', 'go big', press);
      const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); press(); } };
      window.addEventListener('keydown', onKey);
      cleanups.push(() => window.removeEventListener('keydown', onKey));
      foot.append(stopBtn);
      break;
    }

    case 'ingredients': {
      const chosen = new Set();
      body.append(el('div', 'target', 'RECIPE: ' + spec.recipe));
      const card = el('div', 'ticket'); card.append(el('div', 'tk-h', 'NEEDS:'));
      spec.need.forEach((n) => card.append(el('div', 'tk-l', '• ' + n)));
      const grid = el('div', 'grid5');
      spec.options.forEach((o) => {
        const b = btn(o, 'ing', () => { if (chosen.has(o)) { chosen.delete(o); b.classList.remove('on'); } else { chosen.add(o); b.classList.add('on'); } });
        grid.append(b);
      });
      const row = el('div', 'row'); row.append(card, grid);
      body.append(row);
      foot.append(btn('BUILD IT', 'go', () => submit({ selected: [...chosen] })));
      break;
    }

    case 'prep': {
      const status = el('div', 'target', 'WATCH THE STEPS...');
      const pads = el('div', 'pads');
      const padEls = spec.steps.map((s, i) => {
        const b = btn(s.label, 'pad', () => input(i));
        b.style.setProperty('--c', s.color);
        b.disabled = true;
        pads.append(b);
        return b;
      });
      const entered = [];
      const prog = el('div', 'dim', '');
      body.append(status, pads, prog);
      const timers = [];
      spec.sequence.forEach((s, k) => {
        timers.push(setTimeout(() => padEls[s].classList.add('lit'), 400 + k * spec.flashMs));
        timers.push(setTimeout(() => padEls[s].classList.remove('lit'), 400 + k * spec.flashMs + spec.flashMs * 0.7));
      });
      timers.push(setTimeout(() => { status.textContent = 'YOUR TURN: repeat the steps in order'; padEls.forEach((b) => (b.disabled = false)); }, 500 + spec.sequence.length * spec.flashMs));
      cleanups.push(() => timers.forEach(clearTimeout));
      function input(i) {
        entered.push(i);
        padEls[i].classList.add('lit'); setTimeout(() => padEls[i].classList.remove('lit'), 180);
        prog.textContent = 'Step ' + entered.length + ' / ' + spec.sequence.length;
        if (entered.length >= spec.sequence.length) { padEls.forEach((b) => (b.disabled = true)); submit({ sequence: entered.slice() }); }
      }
      break;
    }

    case 'quiz': {
      const answers = new Array(spec.questions.length).fill(-1);
      spec.questions.forEach((q, qi) => {
        const box = el('div', 'quiz');
        box.append(el('div', 'q', (qi + 1) + '. ' + q.q));
        const opts = el('div', 'grid2');
        const bs = q.choices.map((c, ci) => {
          const b = btn(String.fromCharCode(65 + ci) + ') ' + c, 'choice', () => { answers[qi] = ci; bs.forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
          opts.append(b);
          return b;
        });
        box.append(opts);
        body.append(box);
      });
      foot.append(btn('HAND IN', 'go', () => {
        if (answers.includes(-1)) { flash(container, 'Answer every question!'); return; }
        submit({ answers: answers.slice() });
      }));
      break;
    }

    case 'qc': {
      const row = el('div', 'row');
      const ticket = el('div', 'ticket'); ticket.append(el('div', 'tk-h', 'TICKET (click the problem line)'));
      spec.ticket.forEach((t, i) => ticket.append(btn(t.qty + 'x ' + t.item, 'line', () => submit({ line: i }))));
      const tray = el('div', 'tray'); tray.append(el('div', 'tk-h', 'WHAT IS ON THE TRAY'));
      spec.tray.forEach((t) => tray.append(el('div', 'tk-l', t.qty + 'x ' + t.item)));
      row.append(ticket, tray);
      body.append(el('div', 'target', 'One ticket line is missing, wrong or the wrong amount.'), row);
      break;
    }
  }

  foot.append(btn('LEAVE (Esc)', 'quit', () => data.onClose && data.onClose()));
  return { destroy: () => cleanups.forEach((f) => f()) };
}

export function flash(container, text) {
  const f = el('div', 'xflash', text);
  container.append(f);
  setTimeout(() => f.remove(), 1400);
}
