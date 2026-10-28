const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OCG } = require("./load.cjs");

const { MemoryBackend, MemoryStore, normalize } = OCG.db;

test("values are stored like Firebase: no undefined, empty objects and arrays disappear", () => {
    assert.deepEqual(normalize({ a: undefined, b: {}, c: [], d: { e: null, f: 1 }, g: [1, 2] }), { d: { f: 1 }, g: [1, 2] });
    assert.equal(normalize({}), null);
});

test("subscribers get the initial value and later changes to their path, ancestors or children", async () => {
    const db = new MemoryBackend();
    const seen = { room: [], member: [], other: [] };
    db.subscribe("rooms/1", value => seen.room.push(value));
    db.subscribe("rooms/1/members/a", value => seen.member.push(value));
    db.subscribe("lobbies", value => seen.other.push(value));
    await Promise.resolve();
    await db.set("rooms/1", { members: { a: { name: "Ann" } } });
    await db.update("rooms/1", { "members/b": { name: "Bo" } });
    await Promise.resolve();
    assert.deepEqual(seen.room.at(-1), { members: { a: { name: "Ann" }, b: { name: "Bo" } } });
    assert.deepEqual(seen.member, [null, { name: "Ann" }]);
    assert.deepEqual(seen.other, [null], "Unrelated paths are not notified");
});

test("transactions commit, abort on undefined and can require an existing value", async () => {
    const db = new MemoryBackend();
    assert.deepEqual(await db.transaction("x", () => undefined), { committed: false, value: null });
    assert.deepEqual(await db.transaction("x", () => 1, { requireExisting: true }), { committed: false, value: null });
    assert.deepEqual(await db.transaction("x", current => (current || 0) + 1), { committed: true, value: 1 });
    assert.deepEqual(await db.transaction("x", current => current + 1, { requireExisting: true }), { committed: true, value: 2 });
});

test("clients share a store and disconnecting removes their onDisconnect paths", async () => {
    const store = new MemoryStore();
    const ann = new MemoryBackend({ uid: "ann", store });
    const bo = new MemoryBackend({ uid: "bo", store });
    await ann.onDisconnectRemove("presence/1/ann");
    await ann.set("presence/1/ann", { at: 1 });
    assert.deepEqual(await bo.get("presence/1"), { ann: { at: 1 } });
    ann.disconnect();
    assert.equal(await bo.get("presence/1"), null);
});

test("without a Firebase config the game connects to the in-memory database", async () => {
    const db = await OCG.db.connect({ firebase: undefined, config: { apiKey: "REPLACE_ME" } });
    assert.equal(db.kind, "memory");
    assert.equal(OCG.db.isConfigured({ apiKey: "REPLACE_ME", databaseURL: "x" }), false);
    assert.equal(OCG.db.isConfigured({ apiKey: "AIza", databaseURL: "https://x" }), true);
});
