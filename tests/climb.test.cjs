const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OCG, seeded } = require("./load.cjs");

const climb = OCG.games.get("climb");
const players = count => Array.from({ length: count }, (_, seat) => ({ seat, name: `P${seat}`, bot: true }));

function stateWith(overrides) {
    return { names: ["A", "B", "C"], hands: [["C5", "H5", "S9"], ["D6", "C7"], ["H3", "S13"]], turn: 0,
        pile: null, trick: [], passed: [], finished: [], log: [], ...overrides };
}

test("setup deals the whole deck and the holder of the lowest card leads", () => {
    for (const count of [2, 3, 4]) {
        const state = climb.setup(players(count), seeded(count));
        assert.equal(state.hands.flat().length, 52);
        assert.ok(state.hands[state.turn].includes("C2"));
        assert.equal(climb.currentSeat(state), state.turn);
    }
});

test("a leader may play any single or same-rank set; followers must match the count and beat the rank", () => {
    const lead = climb.legalActions(stateWith({}), 0).map(action => action.id);
    assert.deepEqual(lead.sort(), ["play:C5", "play:C5,H5", "play:H5", "play:S9"]);
    assert.deepEqual(climb.legalActions(stateWith({}), 1), [], "Only the current seat may act");

    const pile = { seat: 2, rank: 6, count: 1, cards: ["D6"] };
    const follow = climb.legalActions(stateWith({ pile }), 0).map(action => action.id);
    assert.deepEqual(follow, ["play:S9", "pass"]);
    const pairPile = { seat: 2, rank: 4, count: 2, cards: ["C4", "D4"] };
    assert.deepEqual(climb.legalActions(stateWith({ pile: pairPile }), 0).map(action => action.id),
        ["play:C5,H5", "pass"]);
});

test("when everyone else passes, the last player to play leads a new trick", () => {
    let state = stateWith({});
    state = climb.applyAction(state, 0, { id: "play:S9", type: "play", cards: ["S9"] });
    assert.equal(state.turn, 1);
    assert.deepEqual(climb.view(state, 1).table, [{ seat: 0, cards: ["S9"] }], "The table shows the trick's plays");
    state = climb.applyAction(state, 1, { id: "pass", type: "pass" });
    assert.equal(state.turn, 2);
    state = climb.applyAction(state, 2, { id: "pass", type: "pass" });
    assert.equal(state.pile, null);
    assert.deepEqual(state.trick, [], "A cleared trick leaves the table");
    assert.equal(state.turn, 0);
});

test("going out passes the lead on, and the last player left finishes last", () => {
    let state = stateWith({ hands: [["S9"], ["D6", "C7"], ["H3", "S13"]] });
    state = climb.applyAction(state, 0, { id: "play:S9", type: "play", cards: ["S9"] });
    assert.deepEqual(state.finished, [0]);
    state = climb.applyAction(state, 1, { id: "pass", type: "pass" });
    state = climb.applyAction(state, 2, { id: "pass", type: "pass" });
    assert.equal(state.pile, null);
    assert.equal(state.turn, 1, "The seat after the finished leader leads");
    state = climb.applyAction(state, 1, { id: "play:D6", type: "play", cards: ["D6"] });
    state = climb.applyAction(state, 2, { id: "play:S13", type: "play", cards: ["S13"] });
    state = climb.applyAction(state, 1, { id: "pass", type: "pass" });
    state = climb.applyAction(state, 2, { id: "play:H3", type: "play", cards: ["H3"] });
    assert.equal(climb.isOver(state), true);
    assert.deepEqual(climb.results(state), [{ seat: 0, place: 1 }, { seat: 2, place: 2 }, { seat: 1, place: 3 }]);
    assert.equal(climb.currentSeat(state), null);
});

test("random and strategic bots always finish games without losing or inventing cards", () => {
    for (const count of [2, 3, 4]) {
        for (let seed = 1; seed <= 25; seed++) {
            const random = seeded(seed * 10 + count);
            let state = climb.setup(players(count), random);
            for (let moves = 0; !climb.isOver(state); moves++) {
                assert.ok(moves < 2000, "Game terminates");
                const seat = climb.currentSeat(state);
                const action = seed % 2 ? OCG.games.chooseBotAction(climb, state, seat, random)
                    : climb.legalActions(state, seat)[Math.floor(random() * climb.legalActions(state, seat).length)];
                const before = state.hands.flat().length;
                state = climb.applyAction(state, seat, action);
                assert.equal(state.hands.flat().length, before - (action.cards?.length || 0));
                assert.ok(JSON.parse(JSON.stringify(state)), "State stays plain JSON");
            }
            const places = climb.results(state);
            assert.deepEqual(places.map(entry => entry.seat).sort(), Array.from({ length: count }, (_, seat) => seat));
        }
    }
});

test("the view hides other hands and spectators see none", () => {
    const state = stateWith({});
    assert.deepEqual(climb.view(state, 1).hand, ["D6", "C7"]);
    assert.deepEqual(climb.view(state, null).hand, []);
    assert.deepEqual(climb.view(state, null).cardCounts, [3, 2, 2]);
});
