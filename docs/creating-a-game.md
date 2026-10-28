# Creating a game

A game is an object registered with `OCG.games.register(definition)`. Its functions are **pure**: they take a state and return a new one, without touching the DOM, the database or the clock. That keeps games easy to test and lets the engine run them inside database transactions (which may retry).

Use [games/climb.js](../games/climb.js) as the template.

## The contract

```js
OCG.games.register({
    id: "my-game",          // lowercase, used in the database and URLs
    name: "My Game",        // shown in the UI
    minPlayers: 2,
    maxPlayers: 4,
    botNames: ["Ada", "Bit"],   // optional; otherwise "Bot 1", "Bot 2", …

    // players: [{ seat, name, bot }] in seat order. Return the initial state (plain JSON).
    setup(players, random) { },

    // The seat whose turn it is, or null when nobody can act (game over).
    currentSeat(state) { },

    // Every move `seat` may make now; [] when it is not their turn.
    // Each action needs a unique `id` and a `label`. Actions with `cards` are played by
    // selecting exactly those cards in the generic UI; others are shown as buttons.
    legalActions(state, seat) { return [{ id: "pass", type: "pass", label: "Pass" }]; },

    // Return the new state after `seat` plays `action` (always one of legalActions).
    applyAction(state, seat, action) { },

    isOver(state) { },
    results(state) { return [{ seat: 0, place: 1 }]; },   // in finishing order

    // What `seat` may see (seat is null for spectators). Never include other players' hands.
    view(state, seat) {
        return {
            hand: [],            // card ids for this seat
            table: [],           // card ids shown on the table
            tableLabel: "",      // caption above the table
            cardCounts: [],      // optional: cards left per seat
            finished: [],        // optional: seats that are out, in order
            log: []              // optional: recent events as text
        };
    },

    // Optional: pick a bot move from `actions` (defaults to a random legal action).
    chooseBotAction(state, seat, actions, random) { return actions[0]; }
});
```

## Rules of thumb

- **State is plain JSON.** No classes, `Map`, `Set`, `undefined` or functions. The engine stores it as a JSON string.
- **Copy, then change.** Start `applyAction` with `const state = structuredClone(previous)`; never mutate the input.
- **Use the `random` you are given** in `setup` and `chooseBotAction`, not `Math.random`, so tests can seed it.
- **Validate through `legalActions`.** The engine only calls `applyAction` with an action whose `id` appears in `legalActions(state, seat)`, so `applyAction` can trust its input.
- **Keep the log in the state** if you want a shared history (`state.log`, capped to the last ~20 entries).
- **Cards** are string ids like `"H12"` (queen of hearts); `OCG.cards` has `standardDeck`, `shuffle`, `deal`, `sort`, `parse` and `label`. Games with other decks can use their own ids, but the generic UI renders `OCG.cards` ids.

## Wiring it up

1. Save it as `games/my-game.js`, wrapped like Climb: `(function (OCG) { ... })(globalThis.OCG ??= {});`.
2. Add `<script src="games/my-game.js"></script>` to `index.html` after the existing games (before `js/room.js`).
3. Set `defaultGame: "my-game"` in `js/config.js`. With more than one game registered, the home screen shows a game picker.
4. Add tests (copy `tests/climb.test.cjs`): rules edge cases, plus a loop that plays many seeded games with bots to the end and checks invariants.
5. Run `npm run stamp` and `npm test`.

## Custom UI

The generic UI covers shedding and trick-taking games with one hand, one table area and simple actions. When your game needs more (several piles, trading, bidding), keep `js/room.js` and render your own screens:

```js
const room = new OCG.Room(db, roomId).open(room => {
    room.status;        // "lobby" | "playing" | "finished"
    room.seats;         // [{ id, name, bot }]
    room.mySeat;        // my seat index, or null for spectators
    room.view;          // your game's view(state, mySeat)
    room.legalActions;  // my legal moves right now
});
await room.act(action);
```

Put game-specific rendering in a separate file (for example `js/my-game-ui.js`) and choose it in `app.js` by `room.definition.id`.

## Beyond simple turns

The contract assumes one seat acts at a time (`currentSeat`). For simultaneous phases (everyone passes cards at once), make `currentSeat` return the next seat that still has to act, and let `legalActions` accept moves from that seat only; or extend `Room.act` to accept moves from any seat for which `legalActions` is non-empty.
