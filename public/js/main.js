// Boot, asset loading, menus, options and session lifecycle.
import * as THREE from 'three';
import { buildMap } from '/shared/map.js';
import { audio } from './audio.js';
import { net } from './net.js';
import { setImages, iconTex } from './textures.js';
import { buildWorld } from './world.js';
import { PostFX } from './postfx.js';
import { Game, escapeHtml } from './game.js';

const $ = (id) => document.getElementById(id);
const IMAGES = ['AJAN', 'AJANBAD', 'PRINCIPAL', 'PLAYTIME', 'BULLY', 'SWEEP', 'PRIZE', 'ARTS', 'FACE1', 'FACE2', 'FACE3'];
// supplied item / prop pictures in /assets/random (webp)
const EXTRA_IMAGES = ['Male1', 'flowerpot']; // .webp in /assets
const RANDOM_IMAGES = ['SafetyScissorsIcon_Large', 'QuarterIcon_Large', 'BSODA', 'KeyIcon_Large', 'ZestyBarIcon_Large', 'SwingingDoorLockIcon_Large', 'BBTimesAsset_bigicon_BSED', 'Food', 'Notebooks', 'Papers', 'Pencils', 'Globe', 'ExitSignSprite', 'Bus'];

const DEFAULTS = { master: 0.8, music: 0.6, sfx: 0.9, sens: 1, fov: 65, lowres: false, shake: true, name: '' };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ajan-settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { try { localStorage.setItem('ajan-settings', JSON.stringify(s)); } catch { /* storage unavailable */ } }

const app = {
  settings: loadSettings(),
  canvas: $('view'),
  game: null,
  lastDt: 0.016,
  screen: 'splash',
};
window.__ajan = app; // handy for debugging / automated tests
app.debug = (cmd) => net.act('debug', cmd); // only works on servers started with AJAN_DEBUG=1

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('[assets] missing image', src); resolve(null); };
    img.src = src;
  });
}

function setupRenderer() {
  const r = new THREE.WebGLRenderer({ canvas: app.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  app.renderer = r;
  app.scene = new THREE.Scene();
  app.scene.background = new THREE.Color('#8fd0ff'); // sky, only visible from the front garden
  app.camera = new THREE.PerspectiveCamera(app.settings.fov, 1, 0.1, 400);
  app.postfx = new PostFX(r);
  const resize = () => {
    const lowres = app.settings.lowres;
    r.setPixelRatio(lowres ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5));
    r.setSize(window.innerWidth, window.innerHeight, false);
    app.canvas.classList.toggle('pixel', lowres);
    app.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    app.camera.fov = app.settings.fov;
    app.camera.updateProjectionMatrix();
    const v = new THREE.Vector2(); r.getDrawingBufferSize(v);
    app.postfx.setSize(v.x, v.y);
  };
  app.resize = resize;
  window.addEventListener('resize', resize);
  resize();
}

function buildStaticWorld() {
  app.map = buildMap();
  app.world = buildWorld(app.map);
  app.scene.add(app.world.root);
  // decorative food / cleaning sprites (flat, camera-facing)
  app.foodSprites = [];
  for (const f of app.map.sprites) {
    const s = f.s || 1;
    const tex = iconTex(f.key);
    const asp = tex.image ? tex.image.width / tex.image.height : 1;
    const geo = new THREE.PlaneGeometry(s * asp, s).translate(0, s / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(f.x, f.y, f.z);
    app.scene.add(m);
    app.foodSprites.push(m);
  }
}

// ------------------------------------------------------------------ screens
const SCREENS = ['splash', 'menu', 'sub-mp', 'sub-howto', 'sub-options', 'sub-about', 'loading'];
function show(screen) {
  app.screen = screen;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== screen);
}

function backToMenu() {
  if (app.game) { app.game.dispose(); app.game = null; net.leave(); }
  audio.stopAll();
  show('menu');
  menuMusic();
}

let menuVoicePlayed = false;
function menuMusic() {
  audio.playMusic('menu');
  // AJAN's menu line plays once per visit, never on repeat
  if (!menuVoicePlayed) { menuVoicePlayed = true; audio.play('menuvoice', { dedupe: 'menuvoice' }); }
}

let optionsReturn = 'menu';
function openOptions(from) {
  optionsReturn = from;
  const s = app.settings;
  $('opt-master').value = s.master; $('opt-music').value = s.music; $('opt-sfx').value = s.sfx;
  $('opt-sens').value = s.sens; $('opt-fov').value = s.fov; $('opt-lowres').checked = s.lowres; $('opt-shake').checked = s.shake;
  show('sub-options');
  if (from === 'pause') $('sub-options').style.zIndex = 35;
}

function bindOptions() {
  const upd = () => {
    const s = app.settings;
    s.master = +$('opt-master').value; s.music = +$('opt-music').value; s.sfx = +$('opt-sfx').value;
    s.sens = +$('opt-sens').value; s.fov = +$('opt-fov').value; s.lowres = $('opt-lowres').checked; s.shake = $('opt-shake').checked;
    audio.settings = { master: s.master, music: s.music, sfx: s.sfx };
    audio.applyVolumes();
    app.resize();
    saveSettings(s);
  };
  for (const id of ['opt-master', 'opt-music', 'opt-sfx', 'opt-sens', 'opt-fov', 'opt-lowres', 'opt-shake']) $(id).addEventListener('input', upd);
}

function bindMenus() {
  $('btn-splash').addEventListener('click', boot);
  document.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('click', () => {
    audio.play('click', { dedupe: false });
    const act = b.dataset.act;
    if (act === 'play') startSession({ solo: true });
    if (act === 'mp') { show('sub-mp'); $('mp-name').value = app.settings.name || ''; refreshList(); }
    if (act === 'howto') show('sub-howto');
    if (act === 'options') openOptions('menu');
    if (act === 'about') show('sub-about');
  }));
  document.querySelectorAll('.mbtn.back').forEach((b) => b.addEventListener('click', () => {
    audio.play('click', { dedupe: false });
    if (b.closest('#sub-options') && optionsReturn === 'pause') { $('sub-options').classList.add('hidden'); $('sub-options').style.zIndex = ''; app.screen = 'game'; return; }
    show('menu');
  }));
  $('btn-host').addEventListener('click', () => startSession({ solo: false }));
  $('btn-join').addEventListener('click', () => {
    const code = $('mp-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('mp-msg').textContent = 'Enter a 4-letter game code.'; return; }
    startSession({ solo: false, code });
  });
  $('btn-refresh').addEventListener('click', refreshList);
  $('btn-loading-back').addEventListener('click', () => backToMenu());

  $('btn-resume').addEventListener('click', () => { app.game && app.game.lock(); });
  $('btn-pause-options').addEventListener('click', () => openOptions('pause'));
  $('btn-quit').addEventListener('click', () => backToMenu());
  $('btn-again').addEventListener('click', () => app.game && app.game.restart());
  $('btn-end-menu').addEventListener('click', () => backToMenu());
  $('btn-win-menu').addEventListener('click', () => backToMenu());
  $('btn-win-again').addEventListener('click', () => { if (app.game && app.game.solo) { backToMenuQuiet(); startSession({ solo: true }); } else if (app.game) app.game.restart(); });
  $('clicklock').addEventListener('click', () => app.game && app.game.lock());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && app.game && app.game.ui) { app.game.closeUi(false); app.game.pause(true); }
  });
}

async function refreshList() {
  $('mp-list').textContent = 'Looking for games...';
  try {
    await net.connect();
    const list = await net.request('list', {});
    const box = $('mp-list');
    box.innerHTML = '';
    if (!Array.isArray(list) || !list.length) { box.textContent = 'No open games. Host one!'; return; }
    for (const g of list) {
      const row = document.createElement('div');
      row.className = 'mp-game';
      row.innerHTML = `<span><b>${escapeHtml(g.code)}</b> - ${escapeHtml(g.host)}'s game (${g.players}/8)</span>`;
      const b = document.createElement('button');
      b.className = 'mbtn tiny'; b.textContent = 'JOIN';
      b.onclick = () => startSession({ solo: false, code: g.code });
      row.append(b);
      box.append(row);
    }
  } catch (e) {
    $('mp-list').textContent = e.message;
  }
}

// ------------------------------------------------------------------ sessions
async function startSession({ solo, code }) {
  const name = solo ? (app.settings.name || 'Trainee') : ($('mp-name').value.trim() || 'Trainee');
  if (!solo) { app.settings.name = name; saveSettings(app.settings); }
  show('loading');
  $('loading-msg').textContent = solo ? 'Opening the school...' : 'Connecting to the server...';
  $('btn-loading-back').classList.add('hidden');
  let res;
  try {
    await net.connect();
    res = code ? await net.request('join', { code, name, key: net.key }) : await net.request('create', { solo, name });
  } catch (e) {
    res = { ok: false, err: e.message };
  }
  if (!res || !res.ok) {
    if (!solo) { show('sub-mp'); $('mp-msg').textContent = (res && res.err) || 'Could not join.'; }
    else { $('loading-msg').textContent = (res && res.err) || 'Could not start the game.'; $('btn-loading-back').classList.remove('hidden'); }
    return;
  }
  net.key = res.key;
  $('mp-msg').textContent = '';
  audio.stopMusic();
  audio.stop('menuvoice');
  if (app.game) app.game.dispose();
  app.game = new Game(app, res.init, {
    onRestartSolo: () => { backToMenuQuiet(); startSession({ solo: true }); },
    onDeath: () => backToMenu(),
  });
  show('none');
  app.screen = 'game';
  app.game.lock();
}

function backToMenuQuiet() {
  if (app.game) { app.game.dispose(); app.game = null; net.leave(); }
  audio.stopAll();
}

net.on('snapshot', (s) => { if (app.game) app.game.onSnapshot(s); });
net.on('disconnected', () => { if (app.game) $('netwarn').classList.remove('hidden'); });
net.on('reconnected', async () => {
  if (!app.game || !net.key) return;
  const res = await net.request('resume', { key: net.key });
  $('netwarn').classList.add('hidden');
  if (res.ok) app.game.applyInit(res.init);
  else { backToMenu(); alert('Your game session was lost: ' + (res.err || 'unknown error')); }
});

// ------------------------------------------------------------------ boot
async function boot() {
  $('btn-splash').disabled = true;
  audio.unlock();
  audio.settings = { master: app.settings.master, music: app.settings.music, sfx: app.settings.sfx };
  audio.applyVolumes();
  const bar = $('load-bar').firstChild;
  let pImg = 0, pAud = 0;
  const prog = () => { bar.style.width = Math.round((pImg * 0.4 + pAud * 0.5 + (app.world ? 0.1 : 0)) * 100) + '%'; };
  $('load-text').textContent = 'Loading pictures and voices...';
  const imgs = {};
  let n = 0;
  await Promise.all([
    Promise.all(IMAGES.map(async (k) => { imgs[k] = await loadImage('/assets/' + k + '.png'); pImg = ++n / (IMAGES.length + RANDOM_IMAGES.length); prog(); })),
    Promise.all(EXTRA_IMAGES.map(async (k) => { imgs[k] = await loadImage('/assets/' + k + '.webp'); })),
    Promise.all(RANDOM_IMAGES.map(async (k) => { imgs['random/' + k] = await loadImage('/assets/random/' + k + '.webp'); pImg = ++n / (IMAGES.length + RANDOM_IMAGES.length); prog(); })),
    audio.loadAll((p) => { pAud = p; prog(); }),
  ]);
  setImages(imgs);
  app.randomImages = RANDOM_IMAGES.filter((k) => imgs['random/' + k]);
  $('load-text').textContent = 'Building the school...';
  await new Promise((r) => setTimeout(r, 30));
  buildStaticWorld();
  prog();
  show('menu');
  menuMusic();
}

function loop() {
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    app.lastDt = dt;
    // after a catch the game stays frozen on the exact frame you died
    if (app.game && !app.game.frozen) {
      app.game.frame(dt);
      app.postfx.render(app.scene, app.camera, dt, now / 1000);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

setupRenderer();
bindMenus();
bindOptions();
loop();
