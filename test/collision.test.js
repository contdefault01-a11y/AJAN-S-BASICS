import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, E_WALL } from '../shared/map.js';
import { makeSolidTest, resolveCircle } from '../shared/collision.js';
import { PLAYER_R } from '../shared/constants.js';

const map = buildMap();

test('a moving body (1st Prize) never shoves a player through a thin wall', () => {
  const solid = makeSolidTest(map, []);
  const e = map.edges.find((e) => e.t === E_WALL && e.z0 === e.z1 && e.x1 - e.x0 >= 2 && map.isFloor(Math.floor((e.x0 + 0.5) / 2.5), Math.floor((e.z0 + 1) / 2.5)));
  const mx = (e.x0 + e.x1) / 2, wz = e.z0;
  const pos = { x: mx, z: wz + 0.75 };
  // his box overlaps the player; its nearest side lies on the far side of the wall
  const box = { x0: mx - 1.9, x1: mx + 1.9, z0: wz - 0.3, z1: wz + 3.5 };
  resolveCircle(map, pos, PLAYER_R, solid, [box]);
  assert.ok(pos.z > wz, 'player stays on their own side of the wall: z=' + pos.z + ' wall=' + wz);
});
