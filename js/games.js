// Registry of game definitions. A game is a set of pure functions over a JSON state;
// see docs/creating-a-game.md for the full contract.
(function (OCG) {
    "use strict";

    const REQUIRED = ["setup", "legalActions", "applyAction", "currentSeat", "isOver", "results", "view"];
    const definitions = new Map();

    function register(definition) {
        if (!definition || !/^[a-z][a-z0-9-]*$/.test(definition.id || "")) {
            throw new Error("A game needs a lowercase id.");
        }
        for (const name of REQUIRED) {
            if (typeof definition[name] != "function") {
                throw new Error(`Game "${definition.id}" is missing ${name}().`);
            }
        }
        if (!(definition.minPlayers >= 1 && definition.maxPlayers >= definition.minPlayers)) {
            throw new Error(`Game "${definition.id}" needs minPlayers and maxPlayers.`);
        }
        definitions.set(definition.id, Object.freeze({ name: definition.id, botNames: [], ...definition }));
        return definitions.get(definition.id);
    }

    function get(id) {
        const definition = definitions.get(id);
        if (!definition) { throw new Error(`Unknown game "${id}".`); }
        return definition;
    }

    function list() { return Array.from(definitions.values()); }

    // Picks a bot move: the game's own strategy if it has one, otherwise a random legal action.
    function chooseBotAction(definition, state, seat, random = Math.random) {
        const actions = definition.legalActions(state, seat);
        if (actions.length == 0) { return null; }
        if (typeof definition.chooseBotAction == "function") {
            const chosen = definition.chooseBotAction(state, seat, actions, random);
            if (chosen && actions.some(action => action.id == chosen.id)) { return chosen; }
        }
        return actions[Math.floor(random() * actions.length)];
    }

    OCG.games = { register, get, list, chooseBotAction };
})(globalThis.OCG ??= {});
