// Generic UI: home (create, join, public lobbies), lobby, table and results for any registered game.
// Games describe what to show through view(); see docs/creating-a-game.md.
(function (OCG) {
    "use strict";

    const $ = id => document.getElementById(id);
    let db = null;
    let room = null;
    let stopLobbies = null;
    let selected = new Set();

    function el(tag, props = {}, ...children) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key == "class") { element.className = value; }
            else if (key.startsWith("on")) { element.addEventListener(key.slice(2), value); }
            else if (value === true) { element.setAttribute(key, ""); }
            else if (value !== false && value != null) { element.setAttribute(key, value); }
        }
        element.append(...children.flat().filter(child => child != null && child !== false));
        return element;
    }

    function toast(message) {
        const region = $("toast");
        region.textContent = message;
        region.hidden = false;
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => { region.hidden = true; }, 3500);
    }

    // Runs a user action, showing any error instead of throwing.
    function attempt(action) {
        return async (...args) => {
            try { await action(...args); }
            catch (error) {
                console.error(error);
                toast(error.message || String(error));
            }
        };
    }

    function playerName() {
        const name = OCG.rooms.cleanName($("playerName").value);
        OCG.storage.set("name", name);
        return name;
    }

    function show(screen) {
        for (const id of ["home", "lobby", "game"]) { $(id).hidden = id != screen; }
    }

    function setRoomInUrl(id) {
        const url = new URL(location.href);
        if (id) { url.searchParams.set("room", id); } else { url.searchParams.delete("room"); }
        history.replaceState(null, "", url);
    }

    function cardFace(cardId, { selectable = false, isSelected = false, onclick = null } = {}) {
        const card = OCG.cards.parse(cardId);
        const label = `${OCG.cards.rankLabel(card.rank)}${card.symbol}`;
        const props = { class: `card${card.red ? " card--red" : ""}${isSelected ? " is-selected" : ""}`,
            "aria-label": OCG.cards.label(cardId) };
        if (!selectable) { return el("span", props, label); }
        return el("button", { ...props, type: "button", "aria-pressed": String(isSelected), onclick }, label);
    }

    // Home -----------------------------------------------------------------------------------------

    function renderLobbies(listings) {
        const list = $("publicLobbies");
        const entries = listings.filter(listing => {
            try { return Boolean(OCG.games.get(listing.game)); } catch (error) { return false; }
        });
        list.replaceChildren(...entries.map(listing => el("li", {},
            el("button", { type: "button", class: "lobby-entry", onclick: attempt(() => enterRoom(listing.id, true)) },
                el("span", {}, `${listing.host}'s ${OCG.games.get(listing.game).name}`),
                el("span", { class: "muted" }, `${listing.players}/${listing.maxPlayers}`)))));
        $("noLobbies").hidden = entries.length > 0;
    }

    async function createRoom(isPublic) {
        const created = await OCG.Room.create(db, { game: $("gameSelect").value, name: playerName(),
            playerKey: OCG.storage.playerKey(), isPublic });
        await enterRoom(created.id, false);
    }

    async function enterRoom(id, join) {
        if (room) { room.close(); }
        selected = new Set();
        room = new OCG.Room(db, id);
        if (join) {
            const role = await room.join({ name: playerName(), playerKey: OCG.storage.playerKey() });
            if (role == "spectator") { toast("The game has started; you are watching."); }
        }
        setRoomInUrl(room.id);
        room.open(render);
    }

    async function leaveRoom() {
        const leaving = room;
        room = null;
        setRoomInUrl(null);
        show("home");
        if (leaving) { await (leaving.isMember ? leaving.leave() : leaving.close()); }
    }

    // Room -----------------------------------------------------------------------------------------

    function render(current) {
        if (current !== room) { return; }
        if (!room.loaded) { return; }
        if (!room.exists) {
            toast("That room no longer exists.");
            leaveRoom();
            return;
        }
        document.querySelectorAll(".room-code").forEach(code => { code.textContent = room.id; });
        if (room.status == "lobby") {
            show("lobby");
            renderLobby();
        } else {
            show("game");
            renderGame();
        }
    }

    function renderLobby() {
        const definition = room.definition;
        $("lobbyTitle").textContent = definition.name;
        $("lobbyVisibility").textContent = room.record.isPublic ? "Public room" : "Private room";
        const host = room.isHost;
        const seats = room.members.length + room.bots.length;
        $("lobbyPlayers").replaceChildren(
            ...room.members.map(member => el("li", {},
                el("span", { class: `presence${room.isOnline(member.uid) ? " is-online" : ""}`, "aria-hidden": "true" }),
                el("span", { class: "grow" }, member.name, member.uid === room.db.uid ? " (you)" : ""),
                member.uid === room.record.hostUid ? el("span", { class: "badge" }, "Host") : null,
                host && member.uid !== room.db.uid
                    ? el("button", { type: "button", class: "link", onclick: attempt(() => room.kick(member.uid)) }, "Remove")
                    : null)),
            ...room.bots.map(bot => el("li", {},
                el("span", { class: "presence is-online", "aria-hidden": "true" }),
                el("span", { class: "grow" }, bot.name),
                el("span", { class: "badge" }, "Bot"),
                host ? el("button", { type: "button", class: "link", onclick: attempt(() => room.removeBot(bot.id)) }, "Remove") : null)));
        $("lobbySeats").textContent = `${seats}/${definition.maxPlayers} seats · needs ${definition.minPlayers}+`;
        $("addBotButton").hidden = !host;
        $("addBotButton").disabled = seats >= definition.maxPlayers;
        $("startButton").hidden = !host;
        $("startButton").disabled = seats < definition.minPlayers;
        $("joinRoomButton").hidden = room.isMember;
        $("lobbyHint").textContent = host ? "" : room.isMember ? "Waiting for the host to start." : "You are watching this lobby.";
    }

    function renderGame() {
        const definition = room.definition;
        const state = room.state;
        const view = room.view;
        const turn = definition.currentSeat(state);
        const results = new Map((room.record.results || []).map(result => [result.seat, result.place]));
        $("gameTitle").textContent = definition.name;
        $("seats").replaceChildren(...room.seats.map((seat, index) => el("li", {
            class: `seat${index === turn ? " is-turn" : ""}${index === room.mySeat ? " is-me" : ""}`
        },
            el("span", { class: "seat__name" }, seat.name, seat.bot ? (seat.left ? " (left, bot)" : " (bot)") : ""),
            el("span", { class: "muted" },
                results.has(index) ? `#${results.get(index)}`
                    : view.finished?.includes(index) ? `Out #${view.finished.indexOf(index) + 1}`
                        : view.cardCounts ? `${view.cardCounts[index]} cards` : ""))));
        $("tableLabel").textContent = view.tableLabel || "";
        $("tableCards").replaceChildren(...(view.table || []).map(card => cardFace(card)));
        $("gameLog").replaceChildren(...(view.log || []).slice(-8).map(line => el("li", {}, line)));

        const hand = view.hand || [];
        selected = new Set([...selected].filter(card => hand.includes(card)));
        const actions = room.legalActions;
        const myTurn = actions.length > 0;
        $("hand").replaceChildren(...hand.map(card => cardFace(card, {
            selectable: true, isSelected: selected.has(card),
            onclick: () => {
                if (selected.has(card)) { selected.delete(card); } else { selected.add(card); }
                renderGame();
            }
        })));
        $("handSection").hidden = room.mySeat == null;
        const matching = actions.find(action => action.cards &&
            action.cards.length == selected.size && action.cards.every(card => selected.has(card)));
        const playButton = el("button", { type: "button", class: "primary", disabled: !matching,
            onclick: attempt(async () => { await room.act(matching); selected.clear(); }) },
        matching ? matching.label : "Select cards to play");
        $("actions").replaceChildren(
            actions.some(action => action.cards) ? playButton : null,
            ...actions.filter(action => !action.cards).map(action =>
                el("button", { type: "button", onclick: attempt(() => room.act(action)) }, action.label)));
        const finished = room.status == "finished";
        $("turnHint").textContent = finished ? "Game over."
            : myTurn ? "Your turn." : turn == null ? "" : `Waiting for ${room.seats[turn]?.name}.`;
        $("finishedActions").hidden = !finished;
        $("playAgainButton").hidden = !room.isHost;
    }

    // Startup --------------------------------------------------------------------------------------

    async function start() {
        document.title = OCG.config?.title || document.title;
        $("appTitle").textContent = OCG.config?.title || "OCG Engine";
        $("playerName").value = OCG.storage.get("name", "");
        const games = OCG.games.list();
        $("gameSelect").replaceChildren(...games.map(game => el("option", { value: game.id }, game.name)));
        $("gameSelect").value = OCG.config?.defaultGame || games[0].id;
        $("gamePicker").hidden = games.length < 2;

        const params = new URLSearchParams(location.search);
        try {
            db = await OCG.db.connect({ forceLocal: params.has("local") });
        } catch (error) {
            console.error(error);
            $("connection").textContent = "Offline";
            toast("Could not sign in to Firebase. Is Anonymous Authentication enabled? Add ?local to play offline.");
            return;
        }
        $("connection").textContent = db.kind == "memory" ? "Local mode" : "Online";
        $("connection").title = db.kind == "memory"
            ? "In-memory database: this tab only. Add your Firebase config in js/config.js to play online."
            : "Connected to Firebase";
        document.body.dataset.ready = "true";

        $("createPublicButton").addEventListener("click", attempt(() => createRoom(true)));
        $("createPrivateButton").addEventListener("click", attempt(() => createRoom(false)));
        $("joinForm").addEventListener("submit", attempt(async event => {
            event.preventDefault();
            await enterRoom($("joinCode").value.trim(), true);
        }));
        $("joinRoomButton").addEventListener("click", attempt(() => room.join({ name: playerName(), playerKey: OCG.storage.playerKey() })));
        $("addBotButton").addEventListener("click", attempt(() => room.addBot()));
        $("startButton").addEventListener("click", attempt(() => room.start()));
        $("playAgainButton").addEventListener("click", attempt(() => room.backToLobby()));
        for (const button of document.querySelectorAll("[data-leave]")) {
            button.addEventListener("click", attempt(leaveRoom));
        }
        $("copyInviteButton").addEventListener("click", attempt(async () => {
            await navigator.clipboard.writeText(location.href);
            toast("Invite link copied.");
        }));
        stopLobbies = OCG.Room.watchLobbies(db, renderLobbies);

        const invited = params.get("room");
        if (invited && /^[1-9][0-9]{5}$/.test(invited)) {
            await attempt(() => enterRoom(invited, true))();
        }
    }

    OCG.app = { start, get room() { return room; }, get db() { return db; } };
    window.addEventListener("pagehide", () => {
        if (stopLobbies) { stopLobbies(); }
        if (room) { room.close(); }
    });
})(globalThis.OCG ??= {});
