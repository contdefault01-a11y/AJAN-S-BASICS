// Procedural low-resolution textures and flat 2D icons, drawn on canvases with nearest-neighbour
// filtering for the deliberately cheap Classic look. Character art comes from /assets PNGs.
import * as THREE from 'three';
import { RESTAURANTS, fmtCash } from '/shared/constants.js';

const cache = new Map();
let images = {};
export function setImages(imgs) { images = imgs; }
export function getImage(k) { return images[k]; }

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  return c;
}

export function toTex(c, { repeat = true, smooth = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function speckle(g, w, h, base, colors, density, seed, size = 1) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = seeded(seed);
  const n = Math.floor(w * h * density / (size * size));
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(Math.floor(r() * w / size) * size, Math.floor(r() * h / size) * size, size, size);
  }
}

// ------------------------------------------------------------------ surfaces
export const SURFACES = {
  brick: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#ecebe6', ['#e2e1db', '#f5f5f1', '#d9d8d2'], 0.5, 1);
    g.fillStyle = '#c9c8c1';
    for (let y = 0; y < 64; y += 8) {
      g.fillRect(0, y, 64, 1);
      const off = (y / 8) % 2 ? 8 : 0;
      for (let x = off; x < 64; x += 16) g.fillRect(x, y, 1, 8);
    }
  }),
  plaster: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#dfe6c8', ['#d6ddbe', '#e7edd3'], 0.4, 2);
    g.fillStyle = '#b7c49a'; g.fillRect(0, 0, 64, 2);
  }),
  gymwall: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#cfe0f2', ['#c4d6ea', '#d9e8f7'], 0.4, 3);
    g.fillStyle = '#9fb9d6'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1);
  }),
  cafewall: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#dcdcdc', ['#d0d0d0', '#e6e6e6', '#cfd3d6'], 0.5, 4);
    g.fillStyle = '#bfc2c4'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(32, 0, 1, 64); g.fillRect(0, 32, 64, 1);
  }),
  wood: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#8a5a2b', ['#7a4e24', '#94633a', '#6f4520'], 0.35, 5);
    g.fillStyle = '#5c3a1a'; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 64);
  }),
  beige: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#e8dcc0', ['#dfd2b4', '#efe5cc'], 0.4, 6)),
  concrete: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#a9a9a2', ['#9c9c95', '#b5b5ae', '#8f8f88'], 0.6, 7)),
  outbrick: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#b65e3e', ['#a55436', '#c06a48'], 0.5, 8);
    g.fillStyle = '#d9c6b0';
    for (let y = 0; y < 64; y += 8) { g.fillRect(0, y, 64, 1); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < 64; x += 16) g.fillRect(x, y, 1, 8); }
  }),
  kfcwall: () => canvas(64, 64, (g) => {
    for (let x = 0; x < 64; x += 16) { g.fillStyle = '#c8102e'; g.fillRect(x, 0, 8, 64); g.fillStyle = '#f4f1ec'; g.fillRect(x + 8, 0, 8, 64); }
  }),
  popwall: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#f6e7c8', ['#efdfbd', '#fbeed4'], 0.4, 9);
    g.fillStyle = '#f26522'; g.fillRect(0, 44, 64, 20); g.fillStyle = '#b8410e'; g.fillRect(0, 44, 64, 2);
  }),
  bluecarpet: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#1d2c78', ['#16236a', '#26388e', '#101a55', '#2c41a0'], 0.9, 21, 2)),
  brickgreen: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#ecebe6', ['#e2e1db', '#f5f5f1', '#d9d8d2'], 0.5, 22);
    g.fillStyle = '#c9c8c1';
    for (let y = 0; y < 64; y += 8) { g.fillRect(0, y, 64, 1); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < 64; x += 16) g.fillRect(x, y, 1, 8); }
  }),
  greenband: () => canvas(16, 16, (g) => { g.fillStyle = '#18c418'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#0e8f0e'; g.fillRect(0, 14, 16, 2); }),
  hedge: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#1f5a17', ['#174a11', '#2a6e20', '#123d0d', '#357f25'], 0.9, 23, 2);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 12; i++) g.fillRect((i * 23) % 64, (i * 37) % 64, 4, 3);
  }),
  grass: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#4caa36', ['#3f9a2c', '#5bbb42', '#357f25', '#68c84e'], 0.9, 24, 2)),
  deskwood: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#c8792e', ['#b86a24', '#d58a3c', '#a95f1e'], 0.35, 25);
    g.fillStyle = 'rgba(110,55,15,0.55)';
    for (let y = 2; y < 64; y += 5) for (let x = 0; x < 64; x++) if (Math.sin(x * 0.2 + y) > 0.3) g.fillRect(x, y + Math.round(Math.sin(x * 0.15 + y * 0.7) * 1.5), 1, 1);
  }),
  carpet: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#c9a77a', ['#b8956a', '#d8b98d', '#a88660', '#e2c79e', '#8d6f4c'], 0.9, 10, 2)),
  classcarpet: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#7f8f9b', ['#71818d', '#8d9da9', '#64737e'], 0.8, 11, 2)),
  gymfloor: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#d6a660', ['#cc9b55', '#deb06c'], 0.4, 12);
    g.fillStyle = '#b8853f'; for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 1, 64);
  }),
  cafefloor: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#e9dcc3', ['#d7c6a6', '#f3eadb', '#c8b28d', '#bba27b'], 0.85, 13, 2)),
  redcarpet: () => canvas(64, 64, (g, w, h) => speckle(g, w, h, '#7c1f22', ['#6c1a1d', '#8a2a2c'], 0.6, 14, 2)),
  tiles: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#d2d2cc', ['#c6c6c0', '#dcdcd6'], 0.4, 15);
    g.fillStyle = '#a7a7a0'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(0, 32, 64, 1); g.fillRect(32, 0, 1, 64);
  }),
  checker: () => canvas(64, 64, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#c8102e' : '#f3efe8'; g.fillRect(x * 16, y * 16, 16, 16); }
  }),
  browntile: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#8a5132', ['#7d482b', '#975b3a'], 0.4, 16);
    g.fillStyle = '#5e3420'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
  }),
  ceiling: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#e4e4e4', ['#9a9a9a', '#5c5c5c', '#c2c2c2', '#ffffff', '#7a7a7a'], 0.45, 17, 2);
    g.fillStyle = '#cfc2a8'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
  }),
  plazaceil: () => canvas(64, 64, (g, w, h) => {
    speckle(g, w, h, '#b9c4cc', ['#a9b5be', '#c8d1d8'], 0.4, 18);
    g.fillStyle = '#7f8a92'; g.fillRect(0, 0, 64, 2);
  }),
};

export function surfaceTex(name) {
  return cached('surf:' + name, () => toTex(SURFACES[name]()));
}

// ------------------------------------------------------------------ doors & signs
export function doorTex(kind, label = '') {
  return cached('door:' + kind + ':' + label, () => toTex(canvas(64, 128, (g) => {
    const colors = { entrance: '#1d2fb0', normal: '#1d2fb0', office: '#6b3e1c', faculty: '#7a1010', janitor: '#4b5a3a', kfc: '#c8102e', popeyes: '#f26522', ex: '#1d2fb0', plaza: '#2b6f9e' };
    g.fillStyle = '#d7d7d7'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = colors[kind] || colors.normal; g.fillRect(3, 3, 58, 125);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(3, 3, 2, 125); g.fillRect(59, 3, 2, 125);
    // small window
    g.fillStyle = '#9fd3ff'; g.fillRect(20, 22, 24, 30);
    g.fillStyle = '#ffffff'; g.fillRect(22, 24, 6, 4);
    g.fillStyle = '#222'; g.fillRect(20, 36, 24, 1);
    // handle
    g.fillStyle = '#e0c040'; g.fillRect(50, 66, 6, 4);
    if (label) {
      g.fillStyle = kind === 'faculty' ? '#ff2a2a' : '#fff6a8';
      g.fillRect(6, 84, 52, 18);
      g.fillStyle = '#000'; g.font = 'bold 9px "Comic Sans MS", "Comic Neue", sans-serif'; g.textAlign = 'center';
      g.fillText(label, 32, 97, 50);
    }
  }), { repeat: false }));
}

export function exitTex(open) {
  return cached('exit:' + open, () => toTex(canvas(64, 128, (g) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, 64, 128);
    if (open) {
      const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#fffbe0');
      g.fillStyle = grd; g.fillRect(4, 4, 56, 124);
    } else {
      g.fillStyle = '#8b0d0d'; g.fillRect(4, 4, 27, 124); g.fillRect(33, 4, 27, 124);
      g.fillStyle = '#b0b0b0'; g.fillRect(8, 60, 52, 4);
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillText('EXIT', 32, 40);
    }
  }), { repeat: false }));
}

export function signTex(key) {
  return cached('sign:' + key, () => {
    if (key === 'exit' && images[IMAGE_ICONS.exit]) return toTex(iconCanvas('exit'), { repeat: false });
    if (key === 'sign_school') return toTex(canvas(256, 40, (g) => {
      g.fillStyle = '#1e7a2e'; g.fillRect(0, 0, 256, 40); g.fillStyle = '#fff'; g.fillRect(3, 3, 250, 34); g.fillStyle = '#1e7a2e'; g.fillRect(5, 5, 246, 30);
      g.fillStyle = '#fff'; g.font = 'bold 20px "Comic Sans MS", sans-serif'; g.textAlign = 'center'; g.fillText("AJAN'S SCHOOLHOUSE", 128, 28);
    }), { repeat: false });
    if (key === 'exit') return toTex(canvas(64, 28, (g) => {
      g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 64, 28);
      g.fillStyle = '#e01010'; g.font = 'bold 20px "Comic Sans MS", sans-serif'; g.textAlign = 'center'; g.fillText('EXIT', 32, 22);
    }), { repeat: false });
    if (key === 'sign_kfc') return toTex(canvas(256, 56, (g) => {
      for (let x = 0; x < 256; x += 16) { g.fillStyle = x % 32 ? '#ffffff' : '#c8102e'; g.fillRect(x, 0, 16, 56); }
      g.fillStyle = '#c8102e'; g.fillRect(56, 4, 144, 48);
      g.fillStyle = '#fff'; g.font = 'bold 40px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('KFC', 128, 44);
    }), { repeat: false });
    if (key === 'sign_pop') return toTex(canvas(288, 56, (g) => {
      g.fillStyle = '#f26522'; g.fillRect(0, 0, 288, 56);
      g.fillStyle = '#fff'; g.fillRect(0, 48, 288, 3);
      g.font = 'bold italic 34px Georgia, serif'; g.textAlign = 'center'; g.fillText('Popeyes', 144, 38);
      g.font = 'bold 10px Arial'; g.fillText('LOUISIANA KITCHEN', 144, 52);
    }), { repeat: false });
    if (key === 'sign_cafe') return toTex(canvas(128, 64, (g) => {
      g.fillStyle = '#1e7a2e'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#ffffff'; g.fillRect(3, 3, 122, 58); g.fillStyle = '#1e7a2e'; g.fillRect(6, 6, 116, 52);
      g.fillStyle = '#fff'; g.font = 'bold 18px "Comic Sans MS", sans-serif'; g.textAlign = 'center'; g.fillText('CAFETERIA', 64, 30);
      g.font = '11px "Comic Sans MS", sans-serif'; g.fillText('Food court this way ^', 64, 48);
    }), { repeat: false });
    return toTex(canvas(8, 8, (g) => { g.fillStyle = '#f0f'; g.fillRect(0, 0, 8, 8); }));
  });
}

export function chalkboardTex(kind) {
  return cached('board:' + kind, () => toTex(canvas(192, 80, (g) => {
    g.fillStyle = '#7a4e24'; g.fillRect(0, 0, 192, 80);
    g.fillStyle = '#1f4d2b'; g.fillRect(5, 5, 182, 70);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '14px "Comic Sans MS", "Comic Neue", cursive'; g.textAlign = 'left';
    const lines = kind === 'board_ex'
      ? ['TRAINING DAY!', 'Finish the exercise', 'at the machine ->']
      : ['1 bucket = 2900 cal', 'NO running!!', "AJAN's rules apply"];
    lines.forEach((l, i) => g.fillText(l, 14, 26 + i * 18));
  }), { repeat: false }));
}

const RULES = {
  rule_run: ['SCHOOL RULE #1', 'NO RUNNING', 'IN THE HALLS!', '- The Principal'],
  rule_faculty: ['RULE #2', 'STUDENTS STAY', 'OUT OF THE', 'FACULTY ROOM'],
  rule_bully: ['WATCH OUT!', 'The Bully wants', 'your items.', 'Have one ready!'],
  rule_ajan: ['AJAN SAYS:', 'Listen for the', 'STOMPS!', 'Close doors!'],
  rule_train: ['DAILY GOAL', '7 EXERCISES', 'then CASH', 'then FOOD'],
  rule_food: ['NUTRITION', 'GOAL:', '7,000', 'CALORIES'],
};
const NAMES = { AJAN: 'AJAN', PRINCIPAL: 'PRINCIPAL', PLAYTIME: 'PLAYTIME', BULLY: 'BULLY', SWEEP: 'GOTTA SWEEP', PRIZE: '1ST PRIZE', ARTS: 'ARTS & CRAFTERS' };

export function posterTex(key) {
  return cached('poster:' + key, () => toTex(canvas(96, 128, (g) => {
    const r = seeded(key.length * 77 + key.charCodeAt(0));
    const bg = ['#ffe24a', '#7fd3ff', '#ff9bd0', '#a6ff8a', '#ffb347'][Math.floor(r() * 5)];
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 96, 128);
    g.fillStyle = bg; g.fillRect(3, 3, 90, 122);
    g.fillStyle = '#000'; g.textAlign = 'center';
    if (RULES[key]) {
      g.font = 'bold 12px "Comic Sans MS", "Comic Neue", sans-serif';
      RULES[key].forEach((l, i) => { g.font = (i === 1 || i === 2 ? 'bold 15px ' : 'bold 11px ') + '"Comic Sans MS", "Comic Neue", sans-serif'; g.fillText(l, 48, 28 + i * 26, 88); });
      return;
    }
    const img = images[key];
    if (img) {
      const s = Math.min(84 / img.width, 96 / img.height);
      g.imageSmoothingEnabled = true;
      g.drawImage(img, 48 - (img.width * s) / 2, 8, img.width * s, img.height * s);
    }
    g.fillStyle = '#000'; g.font = 'bold 11px "Comic Sans MS", "Comic Neue", sans-serif';
    g.fillText(NAMES[key] || key, 48, 120, 90);
  }), { repeat: false }));
}

export function menuBoardTex(rid) {
  return cached('menuboard:' + rid, () => {
    const r = RESTAURANTS[rid];
    return toTex(canvas(384, 116, (g) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, 384, 116);
      g.fillStyle = r.colors[0]; g.fillRect(0, 0, 384, 18);
      g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.fillText(r.name.toUpperCase() + ' MENU', 192, 14);
      g.font = '11px Arial'; g.textAlign = 'left';
      r.menu.forEach((m, i) => {
        const y = 32 + i * 12;
        g.fillStyle = '#ffe680'; g.fillText(m.name, 10, y);
        g.fillStyle = '#ffffff'; g.textAlign = 'right'; g.fillText(fmtCash(m.price), 290, y);
        g.fillStyle = '#9cff9c'; g.fillText(m.cal.toLocaleString('en-US') + ' cal', 374, y); g.textAlign = 'left';
      });
    }), { repeat: false });
  });
}

const STATION_STYLE = {
  pushups: ['#ff7b00', 'PUSH-UPS', 'E + G'],
  impossible: ['#1aa34a', 'REACTION', 'KEYS'],
  sequence: ['#1aa34a', 'REACTION', 'KEYS'],
  cones: ['#e03030', 'CONE', 'SPRINT'],
  order: ['#7a3fe0', 'ORDER', 'RUN'],
  fryer: ['#e0b000', 'KITCHEN', 'TIMING'],
  mop: ['#1f6fe0', 'CLEAN', 'UP'],
  boxes: ['#00a7a7', 'BOX', 'CARRY'],
};
export function stationTex(type, done, n) {
  return cached('station:' + type + done + n, () => toTex(canvas(96, 96, (g) => {
    const [c, a, b] = STATION_STYLE[type] || ['#888', '?', '?'];
    g.fillStyle = '#333'; g.fillRect(0, 0, 96, 96);
    g.fillStyle = done ? '#1db954' : c; g.fillRect(4, 4, 88, 88);
    g.fillStyle = '#000'; g.fillRect(10, 10, 76, 46);
    g.fillStyle = done ? '#7dff9a' : '#ffffff'; g.textAlign = 'center';
    g.font = 'bold 11px "Comic Sans MS", sans-serif';
    if (done) { g.font = 'bold 22px sans-serif'; g.fillText('DONE', 48, 42); }
    else { g.fillText(a, 48, 28, 72); g.fillText(b, 48, 44, 72); }
    g.fillStyle = '#fff'; g.font = 'bold 12px "Comic Sans MS", sans-serif'; g.fillText('EXERCISE ' + n, 48, 74);
    g.fillStyle = '#ff0'; g.fillRect(16, 80, 10, 8); g.fillStyle = '#0f0'; g.fillRect(43, 80, 10, 8); g.fillStyle = '#f00'; g.fillRect(70, 80, 10, 8);
  }), { repeat: false }));
}

export function vendingTex(kind) {
  return cached('vend:' + kind, () => toTex(canvas(64, 128, (g) => {
    g.fillStyle = kind === 'soda' ? '#c41b1b' : '#1b4fc4'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#fff'; g.font = 'bold 10px Arial'; g.textAlign = 'center';
    g.fillText(kind === 'soda' ? 'AJAN COLA' : 'PROTEIN', 32, 14); if (kind !== 'soda') g.fillText('BARS', 32, 25);
    g.fillStyle = '#20262c'; g.fillRect(6, 30, 38, 70);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { g.fillStyle = kind === 'soda' ? ['#f33', '#fff', '#333'][(x + y) % 3] : ['#fc0', '#6c3', '#fff'][(x + y) % 3]; g.fillRect(9 + x * 12, 34 + y * 13, 8, 9); }
    g.fillStyle = '#ddd'; g.fillRect(48, 40, 10, 20); g.fillStyle = '#000'; g.fillRect(51, 44, 4, 8);
    g.fillStyle = '#111'; g.fillRect(10, 106, 34, 12);
    g.fillStyle = '#fff'; g.font = '7px Arial'; g.fillText('25¢', 53, 72);
  }), { repeat: false }));
}

export function timerCanvas() {
  const c = canvas(128, 48, () => {});
  return c;
}
export function drawTimer(c, text, active) {
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 128, 48);
  g.fillStyle = active ? '#ff3030' : '#3a3a3a'; g.font = 'bold 26px monospace'; g.textAlign = 'center';
  g.fillText(text, 64, 34);
  g.fillStyle = '#888'; g.font = '8px monospace'; g.fillText('DETENTION', 64, 45);
}

// ------------------------------------------------------------------ flat sprites (items, cash, food)
const ICONS = {
  scissors: (g) => {
    g.strokeStyle = '#2b5cff'; g.lineWidth = 5; g.beginPath(); g.arc(18, 46, 9, 0, 7); g.stroke(); g.beginPath(); g.arc(40, 50, 9, 0, 7); g.stroke();
    g.fillStyle = '#d8d8d8'; g.beginPath(); g.moveTo(22, 38); g.lineTo(52, 6); g.lineTo(56, 10); g.lineTo(30, 42); g.fill();
    g.beginPath(); g.moveTo(34, 42); g.lineTo(18, 6); g.lineTo(13, 9); g.lineTo(26, 44); g.fill();
    g.fillStyle = '#555'; g.fillRect(27, 37, 4, 4);
  },
  coin: (g) => {
    g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(32, 32, 22, 0, 7); g.fill();
    g.fillStyle = '#dcdcdc'; g.beginPath(); g.arc(32, 32, 18, 0, 7); g.fill();
    g.fillStyle = '#888'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.fillText('25', 32, 39);
    g.fillStyle = '#fff'; g.fillRect(20, 18, 6, 3);
  },
  soda: (g) => {
    g.fillStyle = '#b30000'; g.fillRect(20, 12, 24, 44); g.fillStyle = '#ddd'; g.fillRect(22, 6, 20, 6); g.fillRect(20, 56, 24, 3);
    g.fillStyle = '#fff'; g.font = 'bold 9px Arial'; g.textAlign = 'center'; g.fillText('AJAN', 32, 30); g.fillText('COLA', 32, 42);
  },
  keys: (g) => {
    g.strokeStyle = '#d4a017'; g.lineWidth = 5; g.beginPath(); g.arc(20, 20, 10, 0, 7); g.stroke();
    g.fillStyle = '#d4a017'; g.fillRect(26, 26, 26, 6); g.fillRect(44, 32, 5, 9); g.fillRect(36, 32, 5, 6);
    g.fillStyle = '#9a9a9a'; g.fillRect(14, 36, 6, 20); g.fillRect(20, 50, 8, 4);
  },
  bar: (g) => {
    g.fillStyle = '#3a8a1a'; g.fillRect(6, 22, 52, 22); g.fillStyle = '#e8e8e8'; g.fillRect(4, 24, 4, 18); g.fillRect(56, 24, 4, 18);
    g.fillStyle = '#fff'; g.font = 'bold 9px Arial'; g.textAlign = 'center'; g.fillText('PROTEIN', 32, 37);
  },
  lock: (g) => {
    g.strokeStyle = '#888'; g.lineWidth = 6; g.beginPath(); g.arc(32, 26, 12, Math.PI, 0); g.stroke();
    g.fillStyle = '#e0b020'; g.fillRect(14, 26, 36, 28); g.fillStyle = '#333'; g.fillRect(29, 34, 6, 12);
  },
  sneakers: (g) => {
    g.fillStyle = '#f3f3f3'; g.beginPath(); g.moveTo(6, 44); g.lineTo(10, 24); g.lineTo(30, 26); g.lineTo(58, 40); g.lineTo(58, 50); g.lineTo(6, 50); g.fill();
    g.fillStyle = '#2b5cff'; g.fillRect(6, 48, 52, 6); g.fillStyle = '#e03030'; g.fillRect(20, 32, 18, 4);
  },
  clock: (g) => {
    g.fillStyle = '#e03030'; g.beginPath(); g.arc(18, 14, 8, 0, 7); g.arc(46, 14, 8, 0, 7); g.fill();
    g.fillStyle = '#c00'; g.beginPath(); g.arc(32, 36, 20, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 36, 15, 0, 7); g.fill();
    g.fillStyle = '#000'; g.fillRect(31, 24, 2, 13); g.fillRect(31, 35, 10, 2);
  },
  energy: (g) => {
    g.fillStyle = '#111'; g.fillRect(20, 8, 24, 50); g.fillStyle = '#7dff3a'; g.beginPath(); g.moveTo(36, 14); g.lineTo(24, 36); g.lineTo(32, 36); g.lineTo(28, 54); g.lineTo(42, 28); g.lineTo(34, 28); g.fill();
    g.fillStyle = '#bbb'; g.fillRect(20, 6, 24, 3);
  },
  cash: (g) => {
    g.fillStyle = '#2f7d32'; g.fillRect(2, 16, 60, 32); g.fillStyle = '#8fd694'; g.fillRect(5, 19, 54, 26);
    g.fillStyle = '#2f7d32'; g.beginPath(); g.arc(32, 32, 9, 0, 7); g.fill();
    g.fillStyle = '#8fd694'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText('$', 32, 37);
    g.fillStyle = '#2f7d32'; g.font = 'bold 8px Arial'; g.fillText('1', 10, 28); g.fillText('1', 54, 42);
  },
};

const FOOD = {
  tray: (g) => { g.fillStyle = '#b5651d'; g.fillRect(4, 36, 56, 14); g.fillStyle = '#fff'; g.beginPath(); g.arc(22, 36, 9, Math.PI, 0); g.fill(); g.fillStyle = '#e8c07a'; g.fillRect(36, 28, 16, 8); },
  burger: (g) => { g.fillStyle = '#d99a3a'; g.beginPath(); g.arc(32, 34, 20, Math.PI, 0); g.fill(); g.fillStyle = '#3d9a2a'; g.fillRect(12, 34, 40, 4); g.fillStyle = '#6b3a1a'; g.fillRect(12, 38, 40, 7); g.fillStyle = '#d99a3a'; g.fillRect(12, 45, 40, 6); },
  fries: (g) => { g.fillStyle = '#f2d03a'; for (let i = 0; i < 6; i++) g.fillRect(18 + i * 5, 10 + (i % 2) * 4, 4, 26); g.fillStyle = '#e02020'; g.beginPath(); g.moveTo(14, 30); g.lineTo(50, 30); g.lineTo(46, 56); g.lineTo(18, 56); g.fill(); },
  carton: (g) => { g.fillStyle = '#fff'; g.fillRect(20, 22, 24, 32); g.fillStyle = '#2b5cff'; g.fillRect(20, 34, 24, 10); g.fillStyle = '#ddd'; g.beginPath(); g.moveTo(20, 22); g.lineTo(32, 12); g.lineTo(44, 22); g.fill(); },
  cup: (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(20, 16); g.lineTo(44, 16); g.lineTo(40, 56); g.lineTo(24, 56); g.fill(); g.fillStyle = '#e03030'; g.fillRect(22, 30, 20, 8); g.fillStyle = '#333'; g.fillRect(33, 4, 2, 12); },
  wrapper: (g) => { g.fillStyle = '#e6e6e6'; g.beginPath(); g.moveTo(10, 50); g.lineTo(24, 38); g.lineTo(40, 46); g.lineTo(54, 36); g.lineTo(52, 54); g.lineTo(12, 56); g.fill(); g.fillStyle = '#d33'; g.fillRect(24, 46, 10, 3); },
  pizza: (g) => { g.fillStyle = '#e8a33a'; g.beginPath(); g.moveTo(10, 50); g.lineTo(54, 50); g.lineTo(32, 12); g.fill(); g.fillStyle = '#f3d46b'; g.beginPath(); g.moveTo(16, 46); g.lineTo(48, 46); g.lineTo(32, 18); g.fill(); g.fillStyle = '#c0281e'; g.fillRect(28, 32, 5, 5); g.fillRect(22, 40, 5, 5); g.fillRect(36, 40, 5, 5); },
  apple: (g) => { g.fillStyle = '#d61f1f'; g.beginPath(); g.arc(32, 38, 15, 0, 7); g.fill(); g.fillStyle = '#5a3a1a'; g.fillRect(31, 16, 3, 9); g.fillStyle = '#3a9a2a'; g.fillRect(34, 18, 8, 4); },
  papers: (g) => { g.fillStyle = '#fff'; g.fillRect(14, 36, 36, 18); g.fillStyle = '#888'; for (let i = 0; i < 4; i++) g.fillRect(18, 40 + i * 3, 26, 1); },
  mug: (g) => { g.fillStyle = '#2b5cff'; g.fillRect(22, 26, 18, 26); g.strokeStyle = '#2b5cff'; g.lineWidth = 4; g.beginPath(); g.arc(42, 38, 6, -1.5, 1.5); g.stroke(); },
  mop: (g) => { g.fillStyle = '#8a5a2b'; g.fillRect(30, 2, 4, 48); g.fillStyle = '#ddd'; for (let i = 0; i < 7; i++) g.fillRect(20 + i * 3, 48, 2, 14); },
  spray: (g) => { g.fillStyle = '#29a3ff'; g.fillRect(24, 26, 16, 30); g.fillStyle = '#fff'; g.fillRect(26, 18, 10, 8); g.fillRect(36, 18, 8, 3); },
  bucket: (g) => { g.fillStyle = '#c8102e'; g.beginPath(); g.moveTo(14, 18); g.lineTo(50, 18); g.lineTo(44, 58); g.lineTo(20, 58); g.fill(); g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) g.fillRect(20 + i * 10, 22, 5, 34); g.fillStyle = '#c47a2c'; g.beginPath(); g.arc(32, 18, 16, Math.PI, 0); g.fill(); },
  box_kfc: (g) => { g.fillStyle = '#c8102e'; g.fillRect(14, 28, 36, 26); g.fillStyle = '#fff'; g.font = 'bold 11px Arial'; g.textAlign = 'center'; g.fillText('KFC', 32, 45); },
  cup_kfc: (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(20, 16); g.lineTo(44, 16); g.lineTo(40, 56); g.lineTo(24, 56); g.fill(); g.fillStyle = '#c8102e'; g.fillRect(22, 28, 20, 14); },
  box_pop: (g) => { g.fillStyle = '#f26522'; g.fillRect(12, 28, 40, 26); g.fillStyle = '#fff'; g.font = 'bold 8px Arial'; g.textAlign = 'center'; g.fillText('POPEYES', 32, 45); },
  cup_pop: (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(20, 16); g.lineTo(44, 16); g.lineTo(40, 56); g.lineTo(24, 56); g.fill(); g.fillStyle = '#f26522'; g.fillRect(22, 28, 20, 14); },
  bucketfloor: (g) => { g.fillStyle = '#888'; g.fillRect(16, 26, 32, 30); },
};

// Items and props that come from the supplied images in /assets/random/
export const IMAGE_ICONS = {
  scissors: 'random/SafetyScissorsIcon_Large', coin: 'random/QuarterIcon_Large', soda: 'random/BSODA',
  keys: 'random/KeyIcon_Large', bar: 'random/ZestyBarIcon_Large', lock: 'random/SwingingDoorLockIcon_Large',
  energy: 'random/BBTimesAsset_bigicon_BSED', food: 'random/Food', notebooks: 'random/Notebooks',
  papers: 'random/Papers', pencils: 'random/Pencils', globe: 'random/Globe', exit: 'random/ExitSignSprite',
  bus: 'random/Bus',
};

const MORE = {
  bush: (g) => { g.fillStyle = '#2d7a22'; for (const [x, y, r] of [[20, 44, 16], [44, 44, 16], [32, 30, 18]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } g.fillStyle = '#4caa36'; g.fillRect(24, 26, 6, 4); g.fillRect(40, 38, 6, 4); },
  flower: (g) => { g.fillStyle = '#2f8a24'; g.fillRect(31, 30, 3, 34); g.fillStyle = ['#ff4a8a', '#ffe14a', '#ffffff', '#ff7a2a'][Math.floor(Math.random() * 4)]; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(32 + Math.cos(i) * 8, 24 + Math.sin(i) * 8, 6, 0, 7); g.fill(); } g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(32, 24, 5, 0, 7); g.fill(); },
  cone: (g) => { g.fillStyle = '#ff6a00'; g.beginPath(); g.moveTo(32, 4); g.lineTo(52, 58); g.lineTo(12, 58); g.fill(); g.fillStyle = '#fff'; g.fillRect(22, 30, 20, 6); g.fillRect(17, 44, 30, 6); g.fillStyle = '#c84f00'; g.fillRect(8, 56, 48, 6); },
  spill: (g) => { g.fillStyle = 'rgba(120,200,255,0.85)'; g.beginPath(); g.ellipse(32, 48, 28, 12, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(20, 44, 10, 3); },
  box: (g) => { g.fillStyle = '#b8873f'; g.fillRect(10, 18, 44, 40); g.fillStyle = '#8f6328'; g.fillRect(10, 18, 44, 6); g.fillStyle = '#d9b06a'; g.fillRect(28, 18, 8, 40); },
  shelf: (g) => { g.fillStyle = '#7a5a3a'; g.fillRect(6, 4, 6, 58); g.fillRect(52, 4, 6, 58); for (let y = 14; y < 64; y += 16) g.fillRect(6, y, 52, 4); g.fillStyle = '#3cff3c'; g.fillRect(16, 2, 32, 8); },
  arrow: (g) => { g.fillStyle = '#ffe600'; g.beginPath(); g.moveTo(32, 60); g.lineTo(8, 30); g.lineTo(22, 30); g.lineTo(22, 4); g.lineTo(42, 4); g.lineTo(42, 30); g.lineTo(56, 30); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); },
  counter: (g) => { g.fillStyle = '#3cff3c'; g.fillRect(4, 20, 56, 12); g.fillStyle = '#000'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('SERVE', 32, 30); },
  nuggets: (g) => { g.fillStyle = '#d99a3a'; for (const [x, y] of [[20, 40], [34, 36], [44, 46], [28, 50]]) { g.beginPath(); g.ellipse(x, y, 9, 7, 0.4, 0, 7); g.fill(); } },
  pie: (g) => { g.fillStyle = '#c47a2c'; g.fillRect(10, 32, 44, 18); g.fillStyle = '#e8a33a'; g.fillRect(12, 30, 40, 4); g.fillStyle = '#7a2a10'; g.fillRect(18, 38, 6, 3); g.fillRect(34, 40, 6, 3); },
};

export function iconCanvas(key) {
  return cached('iconc:' + key, () => {
    const img = IMAGE_ICONS[key] && images[IMAGE_ICONS[key]];
    if (img) {
      const S = 128;
      return canvas(S, S, (g) => {
        const k = Math.min(S / img.width, S / img.height);
        g.drawImage(img, (S - img.width * k) / 2, S - img.height * k, img.width * k, img.height * k);
      });
    }
    return canvas(64, 64, (g) => (ICONS[key] || FOOD[key] || MORE[key] || ICONS.coin)(g));
  });
}
export function iconTex(key) {
  return cached('icon:' + key, () => toTex(iconCanvas(key), { repeat: false }));
}
export function iconDataURL(key) {
  return cached('iconurl:' + key, () => iconCanvas(key).toDataURL());
}
export function imageTex(key) {
  return cached('img:' + key, () => {
    const t = new THREE.Texture(images[key]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  });
}

// Character sprite: crop the PNG to its alpha bounding box so the billboard hugs the art.
export function spriteTex(key) {
  return cached('sprite:' + key, () => {
    const img = images[key];
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return { tex: t, aspect: out.width / out.height };
  });
}

// Other players: a flat 2D picture of a random kid (hair, skin and clothes vary per player).
export function playerSpriteTex(color, seed = 1) {
  return cached('playerspr:' + color + seed, () => {
    const r = seeded(seed * 7919 + 13);
    const skin = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][Math.floor(r() * 5)];
    const hair = ['#2b1a0e', '#6b3e1c', '#e8c35a', '#111111', '#a33a1a'][Math.floor(r() * 5)];
    const pants = ['#2a3a6a', '#333333', '#5a4a2a', '#1d4d8f'][Math.floor(r() * 4)];
    const longHair = r() < 0.4;
    const c = canvas(64, 128, (g) => {
      g.imageSmoothingEnabled = false;
      // legs + shoes
      g.fillStyle = pants; g.fillRect(19, 74, 11, 44); g.fillRect(34, 74, 11, 44);
      g.fillStyle = '#ffffff'; g.fillRect(16, 116, 15, 8); g.fillRect(33, 116, 15, 8);
      g.fillStyle = '#222'; g.fillRect(16, 122, 15, 3); g.fillRect(33, 122, 15, 3);
      // body + arms
      g.fillStyle = color; g.fillRect(15, 34, 34, 42); g.fillRect(6, 36, 10, 30); g.fillRect(48, 36, 10, 30);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(15, 70, 34, 6);
      g.fillStyle = skin; g.fillRect(6, 66, 10, 8); g.fillRect(48, 66, 10, 8); g.fillRect(27, 28, 10, 8);
      // head
      g.fillStyle = skin; g.beginPath(); g.ellipse(32, 18, 13, 15, 0, 0, 7); g.fill();
      g.fillStyle = hair; g.beginPath(); g.ellipse(32, 9, 14, 8, 0, Math.PI, 0); g.fill(); g.fillRect(18, 6, 28, 6);
      if (longHair) { g.fillRect(17, 8, 5, 24); g.fillRect(42, 8, 5, 24); }
      g.fillStyle = '#fff'; g.fillRect(24, 16, 6, 5); g.fillRect(34, 16, 6, 5);
      g.fillStyle = '#000'; g.fillRect(26, 17, 3, 3); g.fillRect(36, 17, 3, 3);
      g.fillStyle = '#a0302a'; g.fillRect(27, 26, 10, 2);
    });
    return { tex: toTex(c, { repeat: false }), aspect: 0.5 };
  });
}

export function labelTex(text, color = '#fff') {
  return cached('label:' + text + color, () => {
    const c = canvas(128, 24, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 128, 24);
      g.fillStyle = color; g.font = 'bold 15px "Comic Sans MS", sans-serif'; g.textAlign = 'center'; g.fillText(text, 64, 17, 124);
    });
    return toTex(c, { repeat: false, smooth: true });
  });
}

export function shadowTex() {
  return cached('shadow', () => toTex(canvas(32, 32, (g) => {
    const grd = g.createRadialGradient(16, 16, 2, 16, 16, 16);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  }), { repeat: false, smooth: true }));
}

export function sprayTex() {
  return cached('spray', () => toTex(canvas(32, 32, (g) => {
    g.fillStyle = 'rgba(180,60,30,0.85)';
    for (let i = 0; i < 40; i++) { const a = i * 2.4, r = (i % 7) * 2; g.fillRect(16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 3, 3); }
    g.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 10; i++) g.fillRect(8 + i * 2, 10 + (i % 3) * 5, 2, 2);
  }), { repeat: false }));
}
