// Loads the browser scripts into Node in index.html order; they register on globalThis.OCG.
const path = require("node:path");

for (const file of ["js/db.js", "js/storage.js", "js/cards.js", "js/games.js", "games/climb.js", "js/gestures.js", "js/card-motion.js", "js/room.js"]) {
    require(path.join(__dirname, "..", file));
}

// A seeded random source (mulberry32) for deterministic tests.
function seeded(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Resolves when `condition()` is true, polling every few milliseconds.
async function until(condition, timeoutMs = 3000) {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) { throw new Error("Timed out waiting for condition."); }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

module.exports = { OCG: globalThis.OCG, seeded, until };
