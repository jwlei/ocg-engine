# OCG Engine

Boilerplate for turn-based **online card games** that run in the browser: lobbies, invite links, public room lists, bots, presence, host handoff and synchronized play, backed by Firebase Realtime Database. No build step and no server code: static files plus Firebase.

It ships with one example game, **Climb** (a small shedding game for 2–4 players), to show the game contract. Start a new game by copying `games/climb.js`.

## Quick start (local mode, no setup)

```sh
npm run serve          # or any static server: python -m http.server 8000
```

Open <http://localhost:8000/>. Until you add a Firebase config, the game runs in **local mode**: an in-memory database in one tab. Create a room, add bots and play.

Run the tests (Node.js 20 or newer, no dependencies):

```sh
npm test
```

## Going online with Firebase

1. **Create a project** at <https://console.firebase.google.com/>.
2. **Realtime Database** → Create database (pick a region; start in *locked mode*).
3. **Authentication** → Get started → Sign-in method → **Anonymous** → Enable. Every visitor signs in anonymously; the database rules rely on it.
4. **Register a web app**: Project settings → General → Your apps → Web (`</>`). Copy the `firebaseConfig` object into `js/config.js` (include `databaseURL`).
5. **Publish the rules**: Realtime Database → Rules → paste [database.rules.json](database.rules.json) → Publish. Or, with the [Firebase CLI](https://firebase.google.com/docs/cli): `firebase login`, `firebase use <project-id>`, `firebase deploy --only database`.
6. **Authorized domains**: Authentication → Settings → Authorized domains. `localhost` is there by default; add the domain you deploy to.
7. Serve the site and open it in two browsers (or a normal and a private window) to play against each other. The top bar shows **Online** when connected.

Add `?local` to the URL to force local mode, even with a config.

## Deploying

Any static host works. For **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / root. Add the Pages domain (and any custom domain) to Firebase's authorized domains.

Before deploying changed JS or CSS, run `npm run stamp`. It adds a content hash to each script and stylesheet URL in `index.html`, so returning players never run a stale cached file. `npm test` fails until the stamps are current; CI runs the tests on every push.

## Project layout

| Path | Contents |
| --- | --- |
| `index.html` | The page: home, lobby and game screens. Scripts load in dependency order. |
| `js/config.js` | Firebase config, default game and title. |
| `js/db.js` | Database interface with Firebase and in-memory backends; anonymous sign-in. |
| `js/room.js` | Rooms: create/join, lobby, bots, seats, transactions, presence, host handoff, public listing. |
| `js/games.js` | Game registry and bot move selection. |
| `js/cards.js` | Standard 52-card deck helpers (IDs like `S14`), shuffle, deal, sort. |
| `js/storage.js` | Safe localStorage access and the per-browser player key. |
| `js/app.js` | Generic UI that renders any registered game. |
| `games/` | Game definitions. `climb.js` is the example. |
| `css/base.css` | Styles with theme tokens at the top (light and dark). |
| `database.rules.json` | Firebase security rules. |
| `tests/` | `node --test` suites, using the in-memory backend for multiplayer flows. |
| `docs/` | [Architecture](docs/architecture.md), [creating a game](docs/creating-a-game.md), [security](docs/security.md). |

## Making a new game

1. Copy `games/climb.js` to `games/<your-game>.js` and change `id`, `name`, player counts and the rules functions.
2. Add `<script src="games/<your-game>.js"></script>` to `index.html` after the other games, and set `defaultGame` in `js/config.js`.
3. Add tests next to `tests/climb.test.cjs`, then `npm run stamp` and `npm test`.

The full contract, with tips on state shape, bots and custom UI, is in [docs/creating-a-game.md](docs/creating-a-game.md).

## Limits to know

Game logic runs in the players' browsers. The rules restrict writes to room members, but a member with developer tools can read every hand and craft moves. That is fine for casual play with friends; for anything competitive, move the game logic to a server. [docs/security.md](docs/security.md) describes the path.
