# Security

Players sign in to Firebase anonymously, and every seat is tied to that Firebase user (`auth.uid`). [database.rules.json](../database.rules.json) builds on that.

## What the rules enforce

| Path | Rule |
| --- | --- |
| everything | Denied unless listed below. Every listed path requires a signed-in user. |
| `rooms/$roomId` | Readable by signed-in users. Only **members** can change a room. A new room can only be created by its host, with the host as a member. Fields and types are fixed; the host must be a member; `createdAt` cannot change. |
| `rooms/$roomId/members/$uid` | Users can add **only themselves**, and only while the room is in the lobby. They can always remove themselves. |
| `presence/$roomId/$uid` | Users write only their own presence, and only as members. |
| `lobbies/$roomId` | Only the room's host can list it. Anyone can remove a listing whose room is gone or that is older than 10 minutes. |

## What they cannot enforce

Game logic runs in the players' browsers, so the rules cannot check game moves:

- **Hands are readable.** The game state, including every hand, is one string every reader of the room can see. Anyone with developer tools can see the other players' cards.
- **Members can write any state.** A member could replace the state with a crafted one, for example to deal themselves better cards.
- **The host plays the bots** and could make them play badly.

That is acceptable for casual games among friends. It is not acceptable for ranked play or anything with prizes.

## Path to a server-authoritative game

The engine is shaped so this is an incremental change:

1. **Moves become requests.** Players push `{ seat, actionId }` to `rooms/$roomId/moves`; the rules allow each member to push only for their own seat. Clients stop writing `state`.
2. **A trusted backend applies them.** A Cloud Function (or any server with the Admin SDK) listens to `moves`, loads the game definition, which runs unchanged because it is pure, checks `legalActions`, applies the move and writes the new state. Bots run there too.
3. **Hands become private.** The backend writes `public` state (table, counts, log) to the room and each hand to `hands/$roomId/$uid`, readable only by that user (`auth.uid == $uid`). Clients render from `public` plus their own hand, which is exactly what `view(state, seat)` already returns.
4. **Results become trustworthy.** Only the backend writes results and any leaderboard stats.

## Other notes

- The Firebase web config in `js/config.js` is not a secret; access is controlled by the rules and authorized domains.
- Player names are cleaned (no control characters or `<>`) and capped at 24 characters. The UI renders all text with `textContent`, never as HTML.
- Consider [Firebase App Check](https://firebase.google.com/docs/app-check) to make scripted abuse of your database harder.
- Rooms are deleted when their last member leaves. Abandoned rooms (everyone closed the tab) remain; add a scheduled cleanup (for example a Cloud Function deleting rooms with an `updatedAt` older than a day) once you deploy.
