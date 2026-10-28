const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OCG, seeded } = require("./load.cjs");

const { cards } = OCG;

test("a standard deck has 52 unique cards with ranks 2 to 14", () => {
    const deck = cards.standardDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52);
    assert.deepEqual([...new Set(deck.map(card => cards.parse(card).rank))].sort((a, b) => a - b),
        Array.from({ length: 13 }, (_, index) => index + 2));
});

test("cards parse, label and sort by rank, then suit", () => {
    assert.deepEqual(cards.parse("H12"), { id: "H12", suit: "H", rank: 12, symbol: "♥", red: true });
    assert.equal(cards.label("S14"), "A♠");
    assert.equal(cards.label("D10"), "10♦");
    assert.deepEqual(cards.sort(["S2", "C14", "H2", "C2"]), ["C2", "H2", "S2", "C14"]);
    assert.throws(() => cards.parse("X5"));
});

test("shuffling is a deterministic permutation for a seeded random source", () => {
    const deck = cards.standardDeck();
    const first = cards.shuffle(deck, seeded(7));
    assert.deepEqual(first, cards.shuffle(deck, seeded(7)));
    assert.notDeepEqual(first, deck);
    assert.deepEqual(cards.sort(first), cards.sort(deck));
});

test("dealing spreads cards evenly and sorts each hand", () => {
    const hands = cards.deal(cards.standardDeck(), 3);
    assert.deepEqual(hands.map(hand => hand.length), [18, 17, 17]);
    assert.equal(new Set(hands.flat()).size, 52);
    for (const hand of hands) { assert.deepEqual(hand, cards.sort(hand)); }
});
