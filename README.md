# PartyVerse

Real-time multiplayer party games. Jump into rooms with friends, ready up, and play together — all synchronized instantly over WebSockets with a server-authoritative game engine.

## Stack

- **Frontend**: React 18 + Vite + TypeScript (dark neon glassmorphism UI, mobile-first responsive)
- **Backend**: Node.js + Express + Socket.IO + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Realtime**: Socket.IO, server-authoritative state (clients never mutate authoritative state)

## Games

All games run on the same server-authoritative engine (`Lobby → Ready → Countdown → Game → Rounds → Timer → Score → Results → Rematch`) with shared game types and socket events.

| Game | Description |
|------|-------------|
| Brain Battle (`quiz`) | Fast trivia quiz with streak multipliers (5 rounds) |
| Fastest Finger (`reaction`) | Reaction speed game — first to click wins each round (5 rounds) |
| RPS Battle Royale (`rps`) | Every player picks rock/paper/scissors; beat everyone to reach the target score |
| Draw & Guess (`draw`) | One drawer draws a hidden word; others guess. Correct guess ends the round early |
| Telephone (`telephone`) | Chain game: prompt → draw → caption, relayed through the room |
| Sabotaj (`sabotaj`) | Hidden-role cooperative game — one player is the saboteur; repair stations before time runs out |

## Features

- **Auth**: register, login, JWT session, protected pages, user profile
- **Dashboard**: create room, join by code, recent & active rooms, games, profile, friends list
- **Lobby**: live player list, host, ready/unready, game selection, start, leave, host transfer
- **Matchmaking**: quick play auto-matching; private rooms with invite links and room codes
- **Spectate**: watch ongoing games in spectator mode
- **Realtime**: join/leave/ready/new-player/start/actions are broadcast instantly — no refresh
- **Server-authoritative**: game timing, answers, scores and round resolution happen only on the server
- **Reconnect**: auto-reconnect with automatic room rejoin, full state resync and a 120s grace period
- **Progress**: XP, levels, achievements, leaderboards, game history, daily challenges with streaks
- **Social**: friends, in-room chat, emoji reactions
- **Security**: hashed passwords, server-side validation for every action, host-only controls, no secrets in the client

## Project layout

```
partyverse/
├── backend/            # Express + Socket.IO + Prisma
│   ├── prisma/         # schema + migrations
│   ├── src/
│   │   ├── games/      # game engine core + registry + 6 games (quiz, reaction, rps, draw, telephone, sabotaj)
│   │   ├── socket/     # realtime handlers + authoritative store + persistence + room sweeper
│   │   ├── routes/     # REST API (auth, rooms, games, social, uploads)
│   │   └── ...
│   └── tests/          # integration tests (vitest + supertest + socket.io-client)
├── frontend/           # React + Vite + TS
│   └── src/
│       ├── context/    # Auth, Realtime, Toast providers
│       ├── games/      # game UIs
│       ├── pages/      # auth, dashboard, lobby, game, profile
│       └── ...
└── docker-compose.yml  # PostgreSQL
```

## Getting started

Prerequisites: Node 20+, PostgreSQL 15 (or Docker).

```bash
# 1. Start Postgres (Docker) or use a local instance
docker compose up -d

# 2. Configure backend env
cp backend/.env.example backend/.env
#  -> set DATABASE_URL and JWT_SECRET

# 3. Install dependencies (npm workspaces)
npm install

# 4. Run migrations + generate client
npm run db:generate --workspace backend
npm run db:deploy --workspace backend

# 5. Run dev servers (backend :4000, frontend :5173 with API proxy)
npm run dev
```

Open http://localhost:5173

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | Run backend + frontend dev servers |
| `npm run build` | Production build for both workspaces |
| `npm run lint` | ESLint both workspaces |
| `npm run typecheck` | TypeScript typecheck both workspaces |
| `npm run test` | Backend integration/realtime tests |

## Realtime protocol

Clients only ever **send intents** (`room:join`, `room:ready`, `room:selectGame`, `room:start`, `game:action`, `chat:send`, `reaction:send`) and **render state broadcast by the server** (`room:state`, `room:update`, `game:state`, `game:stroke`, `game:revealGuess`, `game:finished`). The server validates every intent against the authoritative in-memory store before applying it, so clients cannot cheat by manipulating local state. Games that need hidden information (e.g. the draw word, saboteur role, RPS choices) are delivered via per-user `personalSnapshot` state so secrets never leak to other players.

## Environment variables

See `backend/.env.example`. Never commit real secrets — `.env` files are gitignored.
