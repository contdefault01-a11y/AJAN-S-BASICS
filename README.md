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

WASD move · mouse turns left/right only (no looking up or down – everything you can pick up or use
is at eye height) · **hold Space** to look straight behind you · **Shift** run (uses stamina) · **left click / E** interact with doors,
machines, pickups and restaurant counters · **right click / Q** use the selected item ·
**1-3 / mouse wheel** select item · **Space** jump rope (while Playtime has you) · **Esc** pause · **F3** debug overlay.
During an exercise the keys it shows (E, G, letters, Space) belong to the exercise.

## How a run goes

1. **Welcome** – you spawn in the entrance hall (REF1-style: a straight corridor, a door on the
   left and one on the right, AJAN ahead). Behind you the front doors lead to a small fenced
   garden with the school bus – there is no way out. AJAN greets you (`AJANSTART.mp3`) while
   `music1.wav` plays quietly.
2. **Exercise 1** (left door): push-ups – alternate **E** and **G** 16 times.
   AJAN says you earned a coin (`AJANCOIN.mp3`): walk up to him and he hands you a Shiny Quarter.
3. **Exercise 2** (right door): reaction keys – press each key as it appears... the last one is a
   key that does not exist. It still counts, but AJAN gets mad: `AJANMAD.mp3` + `musicwrong.wav`,
   his shocked face (`FACE3.png`) in the corner, and he vanishes to the **cafeteria**. The chase
   is on: no music, just his `STOMP.mp3` steps (louder and heavier the closer he is, muffled far
   away, with camera shake). He hears doors being opened.
4. **Exercises 3–7** (random order every match): cone sprint (run to each cone, E), kitchen timing
   (press E in the green zone), quick math and two easy trivia rounds (3 questions each, answer
   with 1 / 2 / 3). `music2.wav` replaces
   any other music while an exercise runs. Leaving the room abandons it.
5. **COLLECT_CASH / FAST_FOOD** – $1–$4 bills appear; buy 7,000 calories at KFC / Popeyes
   (north of the cafeteria). A full order costs about $20.
6. **FINAL_ESCAPE** – the whole screen turns deep red and the ground shakes without pause, `musicescape.wav` loops, AJAN goes berserk. The only way
   out is the front entrance where you started: out to the garden and the school bus (**VICTORY**).
   In multiplayer everyone still playing must be out there at the same time to escape together.
   The four corner EXIT doors are fakes – get close and they vanish into a stretch of wall covered
   in cursed drawings (giant grinning gorillas, red-eyed characters, scribbles, eyes) – different on each.

Everyone except AJAN (Principal, Playtime, Bully, Gotta Sweep, 1st Prize, Arts and Crafters)
ignores you until the chase has started; after that they are active and a bit faster than before.

### Characters

* **Principal** – no running in the halls (`PRINCIPAL1`), no students in the Faculty room (`FACU`) →
  detention (always 20 s, then he walks off muttering `pr1/pr2/pr3`). If he sees the Bully steal
  from you (`PRINBUL`) he hurries over, hands the item back and marches the Bully to his office. AJAN is told where you are. Principal's Keys open the door early.
* **Playtime** – 5-jump rope game (Space when the rope hits the floor). Scissors cut the rope.
* **Bully** – blocks a hallway and takes one random item (`BULLYSEE/TAKE/PASS` – placeholders
  until supplied); with nothing to give he gets bored and leaves.
* **Gotta Sweep** – bursts out of his closet with a school-wide `sweepout.wav`, rushes at anyone he
  sees (`sweep.wav`), very fast, and sometimes grabs you and drags you back to his closet.
* **1st Prize** – big: he fills most of the hallway, so slip past on the sides. Once he spots
  you he turns and charges fast and shoves hard. Scissors cut his wires.
* **Arts and Crafters** (the sock) – every now and then his `childmusic.wav` plays for the whole
  school; after your 7th exercise, staring at him makes him charge and teleport you.
* The **Principal** also blows his `whistle.mp3` now and then – everyone hears it.
* **Catboy** – roams slowly, mumbles (`CATBOYPASS/PASS2`, more often the closer you are), and may
  call you over (`CATBOYSEE`). Click him: 50% he drops an item next to him (`CATBOYGOOD`), 50% he
  snitches – AJAN (`CATBOYAJAN`) or the Principal (`CATBOYPRINCIPAL`) appears around the corner.
  During the cash hunt the odds are 25% a $10 bill, 25% an item, 50% betrayal.

**Red lockers** (8 in the hallways): click one to hide – no character can see or catch you. After
10 seconds it starts shaking and throws you out, and you can't hide again for 40 seconds. If the
Principal sees you climb in (`lock.mp3`) he pulls you out and gives you detention.

In multiplayer, exercise progress, cash and calories are shared by every player in the room, including late joiners.

### Getting caught / winning

* Caught: the game freezes on the exact frame, a random `JUMPSCARE1-3.png` fills most of
  the screen with a random (extremely loud) `jump1-3.wav`, then a black screen with a random picture
  from `assets/random/` for 3 seconds, then the main menu.
* Escaped: `WIN.wav` and the `congratulations.png` screen.

### Items

Safety Scissors, Shiny Quarter (vending machines), BSODA / AJAN Cola (a hallway-wide fizzy blast that pushes any character far away),
Principal's Keys, Zesty Protein Bar (stamina), Swinging Door Lock, Quiet Sneakers, Alarm Clock,
BSED energy drink (unlimited sprint). Only a few items lie in hallways; most are in rooms.

## Assets

Everything lives in `/assets` and is used as-is:

* Sprites: `AJAN.png`, `AJANBAD.png`, `PRINCIPAL.png`, `PLAYTIME.png`, `BULLY.png`, `SWEEP.png`,
  `PRIZE.png`, `ARTS.png` (camera-facing flat images, no shadows). Other players are flat 2D
  pictures (`Male1.webp`). `flowerpot.webp` stands in random hallway corners.
* `assets/random/`: item icons (scissors, quarter, BSODA, keys, zesty bar, door lock, BSED),
  cafeteria and restaurant food trays (`Food.webp`), desk clutter (notebooks, papers, pencils),
  globes, the EXIT sign and the school bus.
* Door reactions (only once the chase has started): two random shaking faces from `FACE1-3.png`, one after the other (FACE3 also when AJAN gets mad).
* Looks: `REF1.png` (entrance hall), `REF3.png` (cafeteria), `REFCLASS.png` (classrooms: white
  brick, dark blue carpet, chunky wooden desks), `REFERENCEPRINCIPALOFFICE.webp` (office: green
  band, blue carpet, wooden desks with globes), `MENU.png` / `MENUREF.png` (menu).
* Audio: voices `AJANMENU`, `AJANSTART`, `AJANCOIN`, `AJANMAD`, `PRINCIPAL1/2`, `PLAYTIME1/2`,
  `PRIZE` (loudness-normalized so they sit above the music), `STOMP.mp3`, music `musicmenu`,
  `music1`, `music2`, `musicwrong`, `musicescape` (`.wav`).
* **Not supplied yet:** `BULLYSEE.mp3`, `BULLYTAKE.mp3`, `BULLYPASS.mp3` – synthesized
  placeholders play until the files are dropped into `/assets`.

## Architecture

```
server/index.js      Express static hosting + Socket.IO rooms, 20 Hz simulation, 15 Hz snapshots
server/room.js       Authoritative match: phases, doors, pickups, cash, purchases, detention, victory
server/npcs.js       NPC state machines (AJAN, Principal, Playtime, Bully, Gotta Sweep, 1st Prize, Arts)
server/exercises.js  Seven physical exercises: generators, per-step + final validation, test solver
shared/map.js        The fixed school layout with thin walls on cell edges, props, decals, nav grid
shared/collision.js  Circle-vs-thin-wall/box collision with sub-stepping
shared/nav.js        A* pathfinding and line of sight
public/js/           three.js client: world builder, game session, HUD, exercises UI, audio, post FX
```

The server owns all gameplay state. Clients send their own position (validated for speed and walls;
teleports and wall-clipping are corrected) and request actions with a request id, so a retried
purchase or pickup can never be applied twice. NPCs run only on the server and are interpolated on
clients. Positional exercise steps are only accepted when the server sees you standing there.

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
