const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OCG, seeded, until } = require("./load.cjs");

const { MemoryBackend, MemoryStore } = OCG.db;
const fast = { botDelayMs: 0, hostTimeoutMs: 30 };

async function setup({ isPublic = true, clients = ["ann", "bo"] } = {}) {
    const store = new MemoryStore();
    const dbs = clients.map(uid => new MemoryBackend({ uid, store }));
    const created = await OCG.Room.create(dbs[0], { game: "climb", name: "Ann", playerKey: "key-ann", isPublic });
    const rooms = dbs.map(db => new OCG.Room(db, created.id, { ...fast, random: seeded(3) }).open());
    await until(() => rooms.every(room => room.loaded && room.presence !== undefined));
    return { store, dbs, rooms, host: rooms[0], id: created.id };
}

// Plays every human seat with its first legal action until the game ends; the host plays bots.
async function playOut(rooms) {
    await until(() => {
        for (const room of rooms) {
            const actions = room.legalActions;
            if (actions.length > 0 && !room.acting) {
                room.acting = true;
                room.act(actions[0]).catch(() => { }).finally(() => { room.acting = false; });
            }
        }
        return rooms[0].status == "finished";
    }, 10000);
}

test("creating a room never overwrites an existing room code", async () => {
    const store = new MemoryStore();
    const ann = new MemoryBackend({ uid: "ann", store });
    const bo = new MemoryBackend({ uid: "bo", store });
    const first = await OCG.Room.create(ann, { game: "climb", name: "Ann", playerKey: "a", random: () => 0.5 });
    const values = [0.5, 0.25];
    const second = await OCG.Room.create(bo, { game: "climb", name: "Bo", playerKey: "b", random: () => values.shift() });
    assert.equal(first.id, "550000");
    assert.equal(second.id, "325000");
    assert.equal((await ann.get(`rooms/${first.id}`)).hostUid, "ann");
});

test("public lobbies are listed for others to join and unlisted once the game starts", async () => {
    const { dbs, rooms, host, id } = await setup();
    let listings = [];
    OCG.Room.watchLobbies(dbs[1], value => { listings = value; });
    await until(() => listings.length == 1);
    assert.deepEqual({ ...listings[0], updatedAt: 0 }, { id, game: "climb", host: "Ann", players: 1, maxPlayers: 4, updatedAt: 0 });
    assert.equal(await rooms[1].join({ name: "Bo<script>", playerKey: "key-bo" }), "player");
    await until(() => listings[0]?.players == 2);
    assert.equal(rooms[1].members[1].name, "Boscript", "Names are cleaned");
    await host.start();
    await until(() => listings.length == 0);
});

test("private rooms are not listed", async () => {
    const { dbs } = await setup({ isPublic: false });
    assert.equal(await dbs[1].get("lobbies"), null);
});

test("only the host can add bots and start, and only with enough seats", async () => {
    const { rooms, host } = await setup();
    await rooms[1].join({ name: "Bo", playerKey: "key-bo" });
    await assert.rejects(rooms[1].addBot());
    await assert.rejects(rooms[1].start());
    await host.addBot();
    await host.addBot();
    await assert.rejects(host.addBot(), /No free seat/);
    await until(() => host.bots.length == 2);
    assert.deepEqual(host.bots.map(bot => bot.name), ["Ada", "Bit"]);
    const third = new OCG.Room(new MemoryBackend({ uid: "cy", store: host.db.store }), host.id);
    await assert.rejects(third.join({ name: "Cy", playerKey: "c" }), /full/);
});

test("a full game with humans and bots runs to the end and can be replayed", async () => {
    const { rooms, host } = await setup();
    await rooms[1].join({ name: "Bo", playerKey: "key-bo" });
    await host.addBot();
    await until(() => host.members.length == 2 && host.bots.length == 1);
    await host.start();
    await until(() => rooms.every(room => room.status == "playing"));
    assert.deepEqual(host.seats.map(seat => [seat.id, seat.bot]), [["ann", false], ["bo", false], [host.bots[0].id, true]]);
    assert.equal(rooms[1].mySeat, 1);
    assert.equal(rooms[1].view.hand.length, 17, "Each player sees their own hand");
    await assert.rejects(rooms[1].act({ id: "not-a-move" }));
    assert.equal(host.record.lastMove, undefined);
    await playOut(rooms);
    const move = host.record.lastMove;
    assert.ok(move && Number.isInteger(move.seat) && move.version == host.record.version);
    assert.equal(typeof host.record.startedAt, "number");
    assert.equal(host.record.results.length, 3);
    await assert.rejects(rooms[1].backToLobby());
    await host.backToLobby();
    await until(() => rooms.every(room => room.status == "lobby"));
    assert.equal(host.state, null);
    assert.equal(host.members.length, 2);
});

test("moves record how cards were thrown so every client animates the same landing", async () => {
    const { rooms, host } = await setup();
    await host.addBot();
    await until(() => host.bots.length == 1);
    await host.start();
    await until(() => host.status == "playing");
    const thrown = { x: 0.25, y: -0.5, power: 0.75, spin: 4, pitch: 30, yaw: -6 };
    const plays = { human: null, bot: null };
    host.onChange = room => {
        const move = room.record?.lastMove;
        if (move && move.cards) { plays[room.seats[move.seat].bot ? "bot" : "human"] = move; }
    };
    // The human always plays cards when possible (passing otherwise); the host plays the bot.
    await until(() => {
        const actions = host.legalActions;
        if (actions.length && !host.acting) {
            const play = actions.find(action => action.cards);
            host.acting = true;
            host.act(play || actions[0], { motion: thrown }).finally(() => { host.acting = false; });
        }
        return (plays.human && plays.bot) || host.status == "finished";
    }, 10000);
    assert.deepEqual(plays.human.motion, { ...thrown, pitch: 18 }, "The thrower's motion is clamped and shared");
    assert.ok(plays.bot, "The bot played cards");
    assert.deepEqual(OCG.gestures.normalizeMotion(plays.bot.motion), plays.bot.motion, "Bots throw too");
    rooms.forEach(room => room.close());
});

test("passing records the move without a throw", async () => {
    const definition = OCG.games.get("climb");
    const state = { names: ["A", "B"], hands: [["C5"], ["D6"]], turn: 0, trick: [{ seat: 1, cards: ["S4"] }],
        pile: { seat: 1, rank: 4, count: 1, cards: ["S4"] }, passed: [], finished: [], log: [] };
    const record = { status: "playing", state: JSON.stringify(state), version: 4 };
    const next = OCG.rooms.applyToRecord(record, definition, 0, "pass", 1, { x: 0, y: 0, power: 1, spin: 0, pitch: 0, yaw: 0 });
    assert.deepEqual(next.lastMove, { seat: 0, actionId: "pass", cards: null, version: 5, motion: null });
});

test("late joiners spectate without a hand", async () => {
    const { rooms, host, store } = await setup();
    await host.addBot();
    await until(() => host.bots.length == 1);
    await host.start();
    const watcher = new OCG.Room(new MemoryBackend({ uid: "cy", store }), host.id, fast).open();
    assert.equal(await watcher.join({ name: "Cy", playerKey: "c" }), "spectator");
    await until(() => watcher.state != null);
    assert.equal(watcher.mySeat, null);
    assert.deepEqual(watcher.view.hand, []);
    assert.deepEqual(watcher.legalActions, []);
    rooms.forEach(room => room.close());
    watcher.close();
});

test("a player who leaves mid-game is replaced by a bot and the game still finishes", async () => {
    const { rooms, host } = await setup();
    await rooms[1].join({ name: "Bo", playerKey: "key-bo" });
    await until(() => host.members.length == 2);
    await host.start();
    await until(() => rooms[1].status == "playing");
    await rooms[1].leave();
    await until(() => host.seats[1]?.bot === true);
    assert.equal(host.seats[1].left, true);
    assert.equal(host.members.length, 1);
    await playOut([host]);
    assert.equal(host.status, "finished");
});

test("when the host leaves or disconnects, another member becomes host", async () => {
    const { dbs, rooms, host } = await setup();
    await rooms[1].join({ name: "Bo", playerKey: "key-bo" });
    await until(() => host.members.length == 2 && rooms[1].isOnline("bo"));
    dbs[0].disconnect();
    await until(() => rooms[1].isHost, 2000);
    assert.equal(rooms[1].record.hostUid, "bo");

    const second = await setup();
    await second.rooms[1].join({ name: "Bo", playerKey: "key-bo" });
    await until(() => second.host.members.length == 2);
    await second.host.leave();
    await until(() => second.rooms[1].isHost);
    await second.rooms[1].leave();
    assert.equal(await second.dbs[1].get(`rooms/${second.id}`), null, "The last member leaving deletes the room");
});
