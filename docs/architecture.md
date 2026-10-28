# Architecture

The engine is layered; each file depends only on the ones below it.

```
app.js         generic UI: home, lobby, table, results
card-motion.js drag previews, flights, landings, clearing, dealing (DOM)
gestures.js    flick/drag recognition and throw motion (pure)
room.js        rooms: lobby, seats, bots, moves, presence, host handoff, public listing
games.js       registry of game definitions + bot move selection
db.js          database interface (Firebase or in-memory)
```

Game definitions (`games/*.js`) are pure functions and only use `cards.js` and the registry.

## Data model

All shared state lives in Firebase Realtime Database:

```
rooms/$roomId
  game        "climb"                         registered game id
  hostUid     auth uid of the current host
  status      "lobby" | "playing" | "finished"
  isPublic    listed in lobbies/ while waiting
  createdAt, updatedAt, version               version increments on every change
  members/$uid  { name, playerKey, joinedAt }  humans, keyed by Firebase auth uid
  bots/$botId   { name, addedAt }              host-added bots
  seats       [{ id, name, bot, left? }]      fixed when the game starts
  state       "<JSON string>"                 the game's own state
  results     [{ seat, place }]               when finished
  startedAt   when the current game started   seeds stable table layouts
  lastMove    { seat, actionId, cards?, motion?, version }   how the last cards were thrown

presence/$roomId/$uid  { at }                  removed by Firebase when the browser disconnects
lobbies/$roomId        { game, host, players, maxPlayers, updatedAt }
```

The game state is stored as a JSON **string**. Firebase drops empty arrays and objects and turns sparse arrays into maps; storing a string keeps each game's state exactly as its code wrote it.

## How a move happens

1. The UI calls `room.act(action)` with one of `room.legalActions`.
2. `act` runs a **database transaction** on `rooms/$roomId`. Inside it, the latest state is parsed, the action is matched by `id` against `legalActions(state, seat)` and applied with `applyAction`. If the move is no longer legal (someone else moved first), the transaction aborts and the UI shows an error.
3. Every client's subscription receives the new room, and the UI re-renders from `view(state, mySeat)`.

Transactions make concurrent moves safe without a server: Firebase retries the update against the newest value, and the turn check rejects stale moves.

## Card motion

Motion is presentation, not game state: games never see it, but the room keeps it so every client animates a move the same way.

1. **Gesture.** `card-motion.js` attaches to the hand. A mouse picks a card up as soon as it moves; a touch waits 8 px and picks up only within the upward cone (`gestures.touchDragAxis`), leaving sideways strokes to native scrolling. While dragging, a preview follows the pointer and tilts with its velocity.
2. **Release.** `gestures.FlickTracker` samples the last 80 ms of the stroke. Releasing over the table, or with a recent upward flick (fast enough, long enough, inside the cone, not held too long, ignoring tiny lift-off recoil), plays the cards; anything else glides them back. Thresholds live in `OCG.gestures.tuning`.
3. **Throw.** `gestures.throwMotion` turns the release point and velocity into `{ x, y, power, spin, pitch, yaw }` relative to the table. `room.act(action, { motion })` stores it in `lastMove.motion`; bots get `gestures.botMotion`, and button plays a gentle random throw.
4. **Landing.** Each client renders the new play at the spot the motion points to, with a stable fan from `cardMotion.jitter(seed, …)`, then `cardMotion.animatePlay` flies each card from its origin (the drag preview, the hand card, or the player's seat for others): it lifts, arcs, touches down at 64% of the flight and slides to rest along the throw.
5. **Clearing and dealing.** Plays that leave the table are swept up and faded (`animateClear`); a fresh hand is dealt in from the table (`animateDeal`).

The table keeps unchanged plays as the same DOM elements, so only new cards move.

## Bots

The host's browser plays for bot seats. After each change, if the current seat is a bot, the host waits `botDelayMs` (700 ms) and runs a transaction that picks a move with the game's `chooseBotAction` (or a random legal move) and a random throw. The transaction checks that the room `version` is unchanged, so a bot never moves twice for one state.

When a human leaves a running game, their seat becomes a bot (`left: true`) so the game can finish.

## Presence and host handoff

Each member writes `presence/$roomId/$uid` and registers `onDisconnect().remove()`, so Firebase deletes it when the tab closes or the connection drops. If the host's presence is missing for 15 seconds, the earliest-joined online member takes over as host by transaction. A host who leaves hands over to the next member right away; the last member leaving deletes the room.

## Room codes

Rooms get a random 6-digit code. Creation is a transaction that only writes when the code is unused, so an existing room is never overwritten.

## Local mode and tests

`MemoryBackend` implements the same interface as `FirebaseBackend` over an in-memory JSON tree, including value subscriptions, transactions and `onDisconnect`. Several `MemoryBackend` clients can share one `MemoryStore`, which is how `tests/room.test.cjs` simulates multiple players, a host disconnecting and late joiners without Firebase.

## Why a generic UI?

`app.js` renders any game from its `view()` (hand, table, card counts, log) and `legalActions()` (buttons). That is enough for many shedding and trick-taking games. For richer games, keep `room.js` and replace or extend `app.js`; see [creating-a-game.md](creating-a-game.md#custom-ui).
