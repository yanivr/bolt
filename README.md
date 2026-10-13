# BOLT RIVALS

Build smart. Drive hard. A browser-first, mobile-first tactical racing game: build a battle car
on a fixed 1,000-credit budget, then race it on a server-authoritative track.

`docs/MASTER_SPEC.md` is the implementation contract and the source of truth. `CLAUDE.md` holds
the working instructions for coding agents. This README describes what exists today.

## Status: Milestone A (foundation and vertical car demo)

Milestone A of Section 20 is implemented and awaiting hardware sign-off. What runs today:

- One authored city track, **Neon Cut**, with its Lantern Alley shortcut, ordered checkpoints,
  three laps, and baked clear-night pixel terrain.
- A server-authoritative test drive: a Colyseus room simulates the car at 30 Hz, the client
  predicts with the same shared code and reconciles to the server.
- A fixed north-up camera with look-ahead, and a floating joystick that points where the car
  should go, with a wheel-style option, keyboard and mouse fallbacks and a left-handed layout.
- Five composited cars (Beetle, Arrow, Pickup, Spider and Trike: the whole chassis list, by
  product-owner decision, see `docs/DECISIONS.md` entry 87), drawn from separate body, wheel,
  engine, shadow and light layers at 64 headings.
- Anonymous guest sessions, a versioned HTTP API, and automated unit, integration and
  end-to-end tests.

Everything else in the specification (garage, 105-part catalog, weapons, AI rivals, friend
rooms, seven more tracks, blueprints, deployment) belongs to Milestones B through G and is
tracked in `docs/RELEASE_CHECKLIST.md`. Nothing in this build pretends to be those features.

## Requirements

- Node.js 22 or newer
- pnpm 10 (`corepack enable` picks up the pinned version)

## Run it

```bash
pnpm install
pnpm build        # builds the web client and the server bundle (art is committed)
pnpm start        # one port: http://localhost:2567 serves the game, API and sockets
```

To try it on a phone, put the phone on the same network and open
`http://<your-computer-ip>:2567`. Landscape is the intended orientation.

For development with hot reload:

```bash
cp .env.example .env
pnpm dev          # server on :2567, Vite on :5173 (proxied, also reachable from the LAN)
```

Useful URL flags, development aids only:

| Flag           | Effect                                                                    |
| :------------- | :------------------------------------------------------------------------ |
| `?debug=1`     | Shows frame rate, renderer, link mode, latency and prediction corrections |
| `?autopilot=1` | A centerline driver holds the controls until you touch the screen         |

If the game server cannot be reached, the client falls back to an **offline test drive** that
runs the same shared simulation in the page and says so in the HUD. It exists so the driving
feel can be checked on hardware before a server is deployed. Build with `VITE_ALLOW_OFFLINE=0`
to disable it.

## Saved cars, car codes and PostgreSQL

My Blueprints lives in the browser and works offline. Sharing a car issues a short code such as
`CAR-7K92QZ-R4` (`Copy Code` on a saved car, `Share Blueprint` on the results screen), and
`Load Code` (Home, My Blueprints, the garage, or a link `/car/<code>`) brings a shared car in.
Codes, guest sessions and match records are stored in PostgreSQL. Settings has `Privacy Info`,
with what is kept and a working `Delete My Data`. Details: `docs/PERSISTENCE.md`.

```bash
pnpm db:dev                                              # PostgreSQL 16 on :5499, no Docker needed
DATABASE_URL=postgresql://bolt@localhost:5499/bolt pnpm dev
pnpm test:db                                             # the persistence suites on bolt_test
pnpm db:dev stop
```

Or, with Docker: `pnpm install && pnpm build && docker compose up` (PostgreSQL and the server on
:2567; a development stack, not the deployment). Without `DATABASE_URL` the server keeps
everything in memory and says so in its log; in production it refuses to start without one.

## Quality checks

```bash
pnpm check        # eslint, tsc -b, unit and integration tests (Vitest)
pnpm test:e2e     # Playwright against the production build (run pnpm build first)
pnpm art:check    # fails if committed car atlases differ from what the pipeline bakes
npx tsx tests/visual/capture.ts            # screenshots and a recording of an autopilot lap
npx tsx tests/visual/capture.ts http://localhost:2567 tests/visual/out touch   # touch-driven
```

## Layout

```text
apps/web        React menus and HUD, Phaser race view, input, prediction, audio
apps/server     Express API, Colyseus rooms, guest sessions, authoritative loop
packages/shared Pure simulation: physics, track queries, checkpoints, protocol, compositor
packages/content Catalog, tracks, weather presets, player-facing strings
art/scripts     Deterministic pixel-art pipeline: sprite modeller, terrain baker, effects
art/source      Heading-0 source cells exported by the pipeline
art/manifests   Copies of the generated manifests, for review and diffing
tests           unit, integration, e2e, visual capture, helpers
docs            Specification, decisions, art guide, test plan, release checklist, evidence
references      User-supplied reference images (inspiration only, never shipped)
```

## Art

All art is original and generated by code in `art/scripts`, deterministically: the same
commit bakes byte-identical atlases on any machine. `pnpm art` rebakes everything and writes
review sheets to `art/preview/`. See `docs/ART_GUIDE.md`.

The images under `references/` are directional reference for camera, density and layout. They
are not part of the game and nothing is copied from them.

## Deployment

Not deployed. There is no public URL. The server refuses to start in production without a
real `GUEST_TOKEN_SECRET` and a `DATABASE_URL`. Production Docker images, Caddy and the public HTTPS deployment
are Milestone G and need infrastructure credentials.
