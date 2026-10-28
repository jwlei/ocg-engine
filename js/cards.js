// Standard playing cards as compact string IDs ("S14" = ace of spades), so game state stays plain JSON.
(function (OCG) {
    "use strict";

    const SUITS = [
        { code: "C", symbol: "♣", name: "clubs", red: false },
        { code: "D", symbol: "♦", name: "diamonds", red: true },
        { code: "H", symbol: "♥", name: "hearts", red: true },
        { code: "S", symbol: "♠", name: "spades", red: false }
    ];
    const RANK_LABELS = { 11: "J", 12: "Q", 13: "K", 14: "A" };

    function id(suit, rank) { return `${suit}${rank}`; }

    function parse(cardId) {
        const match = /^([CDHS])(\d{1,2})$/.exec(cardId);
        if (!match) { throw new Error(`Invalid card: ${cardId}`); }
        const suit = SUITS.find(entry => entry.code == match[1]);
        return { id: cardId, suit: suit.code, rank: Number(match[2]), symbol: suit.symbol, red: suit.red };
    }

    function rankLabel(rank) { return RANK_LABELS[rank] || String(rank); }

    function label(cardId) {
        const card = parse(cardId);
        return `${rankLabel(card.rank)}${card.symbol}`;
    }

    // Ranks 2-14 (ace high) in every suit.
    function standardDeck() {
        return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, index) => id(suit.code, index + 2)));
    }

    // Fisher-Yates with an injectable random source, so tests can be deterministic.
    function shuffle(cards, random = Math.random) {
        const result = cards.slice();
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    function compare(a, b) {
        const left = parse(a);
        const right = parse(b);
        return left.rank - right.rank || SUITS.findIndex(suit => suit.code == left.suit) -
            SUITS.findIndex(suit => suit.code == right.suit);
    }

    function sort(cards) { return cards.slice().sort(compare); }

    // Deals one card at a time around the table; returns one hand per player.
    function deal(cards, playerCount) {
        const hands = Array.from({ length: playerCount }, () => []);
        cards.forEach((card, index) => hands[index % playerCount].push(card));
        return hands.map(sort);
    }

    OCG.cards = { SUITS, id, parse, rankLabel, label, standardDeck, shuffle, compare, sort, deal };
})(globalThis.OCG ??= {});
