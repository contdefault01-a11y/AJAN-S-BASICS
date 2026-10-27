// "Build" step: the client ships as native ES modules (no bundler), so the build verifies that
// every source file parses, that all required assets exist, and that the map builds.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO } from '../shared/constants.js';
import { buildMap } from '../shared/map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
for (const d of ['server', 'shared', 'public/js', 'scripts', 'test']) walk(path.join(ROOT, d));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax ok: ${files.length} files`);

const IMAGES = ['AJAN', 'AJANBAD', 'PRINCIPAL', 'PLAYTIME', 'BULLY', 'SWEEP', 'PRIZE', 'ARTS', 'FACE1', 'FACE2', 'FACE3', 'MENU', 'CATBOY'];
const OPTIONAL = new Set(['BULLYSEE.mp3', 'BULLYTAKE.mp3', 'BULLYPASS.mp3']);
let missing = 0;
for (const f of [...IMAGES.map((i) => i + '.png'), ...Object.values(AUDIO)]) {
  if (existsSync(path.join(ROOT, 'assets', f))) continue;
  if (OPTIONAL.has(f)) console.warn(`note: assets/${f} not supplied yet - a synthesized placeholder is used`);
  else { console.error(`MISSING required asset: assets/${f}`); missing++; }
}
if (!existsSync(path.join(ROOT, 'node_modules/three/build/three.module.js'))) { console.error('three.js not installed - run npm install'); missing++; }
const map = buildMap();
console.log(`map ok: ${map.rooms.length} areas, ${map.doors.length} doors, ${map.props.length} props, ${map.stations.length} exercise stations`);
if (missing) process.exit(1);
console.log('build check passed');
