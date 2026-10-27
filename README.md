# AJAN'S BASICS IN FAST FOOD AND TRAINING

A Classic-style first-person horror-comedy for the browser, with real online multiplayer.
Finish **7 training exercises**, collect **cash**, buy **7,000 calories** at **KFC** or **Popeyes**,
then escape the school while a furious AJAN stomps after you through a red hallucination.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

Solo play and multiplayer both go through the same Node server (solo games are private,
pausable one-player rooms), so always open the game through the server URL.

| Script | What it does |
|---|---|
| `npm start` | Starts the HTTP + Socket.IO game server (`server/index.js`). |
| `npm run dev` | Same, restarting on file changes. |
| `npm run build` | Build check: syntax-checks every source file, verifies required assets, builds the map. The client is native ES modules, no bundler. |
| `npm test` | Map connectivity, exercise solvability, server rules / NPC tests and a two-client Socket.IO multiplayer test. |

## Controls

WASD move · mouse look · **Shift** run (uses stamina) · **left click** (or E) interact with doors,
exercises, pickups and restaurant counters · **right click** (or Q) use the selected item ·
**1-3 / mouse wheel** select item · **Space** jump rope · **Esc** pause · **F3** debug overlay.

## How a run goes

1. **INTRO** – AJAN greets you (`AJANSTART.mp3`) and stays happy.
2. **TRAINING** – seven exercise rooms each hold a different station: Order Assembly, Cash Register,
   Kitchen Timing, Ingredient Selection, Food Preparation, Training Quiz, Quality Control. Puzzles
   are generated and validated on the server and re-randomized every match. After the first one
   AJAN says you earned a coin (`AJANCOIN.mp3`), walks over to hand you a Shiny Quarter, then turns
   angry (`AJANBAD.png`) and starts hunting. His stomp cadence speeds up with progress; stomps shake
   the camera depending on distance. Wrong answers tell him where you are.
3. **COLLECT_CASH** – $1–$4 bills appear on desks, tables, counters and hallway corners.
4. **FAST_FOOD** – buy from the KFC / Popeyes menus (price + calories, money is checked server-side).
   A full order costs about $20.
5. **FINAL_ESCAPE** – at 7,000 calories `AJANMAD.mp3` plays, AJAN goes berserk, the screen turns into
   a red, wavy hallucination and the four corner EXIT doors open. Reach one to win (**VICTORY**).

Getting caught (**CAUGHT**) ends your run only; in multiplayer the others keep playing and you can
try again. **DETENTION**, the jump-rope game and pauses are overlays on top of the main phase.

### Characters

* **Principal** – wanders; seeing you run or enter the Faculty room plays `PRINCIPAL1.mp3` and he
  chases you; catching you plays `PRINCIPAL2.mp3` and locks you in his office for 20 s (+5 s each
  time, max 45 s). AJAN is told where you are. Principal's Keys open the door early.
* **Playtime** – spots you (`PLAYTIME1.mp3`), then a 5-jump rope game (`PLAYTIME2.mp3`). Missing
  resets the count. Scissors cut the rope.
* **Bully** – blocks a hallway (`BULLYSEE`); takes one random item (`BULLYTAKE`) and leaves, or says
  no (`BULLYPASS`) and gets bored after a few seconds. Never steals cash.
* **Gotta Sweep** – waits in the janitor's closet, then sweeps the halls for ~20 s pushing players
  and characters with collision-aware pushes.
* **1st Prize** – turns slowly and awkwardly, charges and shoves you (`PRIZE.mp3`). Scissors cut
  his wires for 15 s.
* **Arts and Crafters** – a rare, shy sighting early on; after your 7th exercise, staring at him
  makes him charge and whisk you to another part of the school.

### Items

Safety Scissors, Shiny Quarter (vending machines → AJAN Cola / Protein Bar), AJAN Cola (spray that
pushes characters), Principal's Keys, Protein Bar (stamina to 200%), Swinging Door Lock (15 s),
Quiet Sneakers (doors make no noise for 30 s), Alarm Clock (lures AJAN), Energy Drink (unlimited
sprint for 15 s). Three inventory slots; picking up with full hands swaps the selected item.

## Assets

Everything lives in `/assets` and is used as-is:

* Sprites: `AJAN.png`, `AJANBAD.png`, `PRINCIPAL.png`, `PLAYTIME.png`, `BULLY.png`, `SWEEP.png`,
  `PRIZE.png`, `ARTS.png` (camera-facing billboards, cropped to their alpha bounds at load).
* Door reactions: `FACE1.png` (grin), `FACE2.png` (eye-roll), `FACE3.png` (shock) – a random one,
  never the same twice in a row, pops up bottom-right when you open a door.
* Menu: `MENU.png` (its baked-in labels are covered by the real, clickable buttons). `MENUREF.png`,
  `REF1.png` and `REF3.png` are references for the menu layout, HUD and look.
* Audio: `AJANMENU`, `AJANSTART`, `AJANCOIN`, `AJANMAD`, `PRINCIPAL1/2`, `PLAYTIME1/2`, `PRIZE`.
* **Not supplied yet:** `BULLYSEE.mp3`, `BULLYTAKE.mp3`, `BULLYPASS.mp3`. The game already requests
  them; until they exist a short synthesized placeholder plays and a console warning is logged.
  Drop the files into `/assets` with those names and they are used automatically.

Item icons, cash bills, food props, posters, signs, menu boards and all surface textures are drawn
procedurally on low-resolution canvases. Stomps, doors and other effects are synthesized with Web Audio.

## Architecture

```
server/index.js      Express static hosting + Socket.IO rooms, 20 Hz simulation, 15 Hz snapshots
server/room.js       Authoritative match: phases, doors, pickups, cash, purchases, detention, victory
server/npcs.js       NPC state machines (AJAN, Principal, Playtime, Bully, Gotta Sweep, 1st Prize, Arts)
server/exercises.js  Seven exercise generators + validators (+ a reference solver used by tests)
shared/map.js        The fixed school layout, props, decals, nav grid (used by server and client)
shared/collision.js  Circle-vs-grid/box collision with sub-stepping
shared/nav.js        A* pathfinding and line of sight
public/js/           three.js client: world builder, game session, HUD, exercises UI, audio, post FX
```

The server owns all gameplay state. Clients send their own position (validated for speed and walls;
teleports and wall-clipping are corrected) and request actions with a request id, so a retried
purchase or pickup can never be applied twice. NPCs run only on the server and are interpolated on
clients. Exercise solutions never leave the server for the logic puzzles.

## Deploying on Render

`render.yaml` defines a single **Web Service** (Node 22): build `npm ci && npm run build`, start
`npm start`, health check `/healthz`. The server binds `0.0.0.0:$PORT`, serves the client and assets
itself, and the client connects to the same origin, so WebSockets work without extra configuration.

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Set by Render automatically. |
| `MAX_PLAYERS` | `8` | Players per multiplayer game. |
| `CORS_ORIGIN` | `*` | Comma-separated origins allowed to connect if the client is hosted elsewhere. |
| `AJAN_DEBUG` | unset | `1` enables test-only cheat actions. Never set this in production. |

If you host the client separately, point it at the game server with `?server=https://your-server`
or by defining `window.AJAN_SERVER_URL` before `main.js` loads.

Note: Render's free plan sleeps idle services; the first visit after a nap takes a few seconds.
