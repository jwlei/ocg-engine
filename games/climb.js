// Climb: an example shedding game for 2-4 players that shows the game contract.
// Lead a single card or a set of equal rank; others must play the same number of cards of a
// higher rank, or pass. When everyone else passes, the last player to play leads again.
// Players drop out as they empty their hands; finishing order is the result.
(function (OCG) {
    "use strict";

    const { cards } = OCG;

    function activeSeats(state) {
        return state.hands.map((hand, seat) => seat).filter(seat => !state.finished.includes(seat));
    }

    function nextActiveSeat(state, seat) {
        for (let step = 1; step <= state.hands.length; step++) {
            const candidate = (seat + step) % state.hands.length;
            if (!state.finished.includes(candidate)) { return candidate; }
        }
        return null;
    }

    // Every subset of `items` with exactly `size` elements.
    function combinations(items, size) {
        if (size == 0) { return [[]]; }
        return items.flatMap((item, index) =>
            combinations(items.slice(index + 1), size - 1).map(rest => [item, ...rest]));
    }

    function describe(cardIds) { return cardIds.map(cards.label).join(" "); }

    function addLog(state, text) {
        state.log = [...state.log, text].slice(-20);
    }

    const climb = {
        id: "climb",
        name: "Climb",
        minPlayers: 2,
        maxPlayers: 4,
        botNames: ["Ada", "Bit", "Cog", "Dot"],

        setup(players, random = Math.random) {
            const hands = cards.deal(cards.shuffle(cards.standardDeck(), random), players.length);
            // Whoever holds the lowest card leads.
            const lowest = cards.sort(hands.flat())[0];
            const turn = hands.findIndex(hand => hand.includes(lowest));
            return {
                names: players.map(player => player.name),
                hands, turn, pile: null, trick: [], passed: [], finished: [],
                log: [`${players[turn].name} holds ${cards.label(lowest)} and leads.`]
            };
        },

        currentSeat(state) {
            return state.finished.length >= state.hands.length ? null : state.turn;
        },

        legalActions(state, seat) {
            if (seat !== state.turn || state.finished.includes(seat)) { return []; }
            const byRank = new Map();
            for (const card of state.hands[seat]) {
                const rank = cards.parse(card).rank;
                byRank.set(rank, [...(byRank.get(rank) || []), card]);
            }
            const actions = [];
            for (const [rank, sameRank] of byRank) {
                const sizes = state.pile ? [state.pile.count] : sameRank.map((_, index) => index + 1);
                if (state.pile && rank <= state.pile.rank) { continue; }
                for (const size of sizes) {
                    for (const set of combinations(sameRank, size)) {
                        actions.push({ id: `play:${set.join(",")}`, type: "play", cards: set,
                            label: `Play ${describe(set)}` });
                    }
                }
            }
            if (state.pile) { actions.push({ id: "pass", type: "pass", label: "Pass" }); }
            return actions;
        },

        applyAction(previous, seat, action) {
            const state = structuredClone(previous);
            const name = state.names[seat];
            if (action.type == "pass") {
                state.passed.push(seat);
                addLog(state, `${name} passes.`);
                const waiting = activeSeats(state).filter(other =>
                    other != state.pile.seat && !state.passed.includes(other));
                if (waiting.length == 0) {
                    // Everyone else passed: the last player to play leads, or the next seat if they went out.
                    const leader = state.finished.includes(state.pile.seat)
                        ? nextActiveSeat(state, state.pile.seat) : state.pile.seat;
                    state.pile = null;
                    state.trick = [];
                    state.passed = [];
                    state.turn = leader;
                    addLog(state, `${state.names[leader]} leads.`);
                } else {
                    state.turn = nextActiveSeat(state, seat);
                }
                return state;
            }
            const hand = state.hands[seat];
            state.hands[seat] = hand.filter(card => !action.cards.includes(card));
            state.pile = { seat, rank: cards.parse(action.cards[0]).rank, count: action.cards.length,
                cards: action.cards };
            state.trick.push({ seat, cards: action.cards });
            state.passed = [];
            addLog(state, `${name} plays ${describe(action.cards)}.`);
            if (state.hands[seat].length == 0) {
                state.finished.push(seat);
                addLog(state, `${name} is out in place ${state.finished.length}.`);
                const remaining = activeSeats(state);
                if (remaining.length == 1) {
                    state.finished.push(remaining[0]);
                    state.pile = null;
                    return state;
                }
            }
            state.turn = nextActiveSeat(state, seat);
            return state;
        },

        isOver(state) { return state.finished.length >= state.hands.length; },

        results(state) {
            return state.finished.map((seat, index) => ({ seat, place: index + 1 }));
        },

        // What a seat may see. Spectators (seat null) see no hand. The table shows this trick's plays.
        view(state, seat) {
            return {
                hand: seat == null ? [] : state.hands[seat],
                table: state.trick,
                tableLabel: state.pile ? `${state.names[state.pile.seat]} played` : "New trick",
                cardCounts: state.hands.map(hand => hand.length),
                finished: state.finished,
                log: state.log
            };
        },

        // Simple strategy: play the lowest rank possible using the fewest cards; pass only when forced.
        chooseBotAction(state, seat, actions) {
            const plays = actions.filter(action => action.type == "play");
            if (plays.length == 0) { return actions[0]; }
            return plays.slice().sort((a, b) =>
                cards.parse(a.cards[0]).rank - cards.parse(b.cards[0]).rank ||
                a.cards.length - b.cards.length)[0];
        }
    };

    OCG.games.register(climb);
})(globalThis.OCG ??= {});
