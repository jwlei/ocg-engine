// Per-browser preferences in localStorage. Storage can throw (private mode, blocked site data),
// so every access falls back to an in-memory copy.
(function (OCG) {
    "use strict";

    const PREFIX = "ocg:";
    const memory = new Map();

    function get(key, fallback = null) {
        try {
            const value = globalThis.localStorage.getItem(PREFIX + key);
            if (value !== null) { return value; }
        } catch (error) { }
        return memory.has(key) ? memory.get(key) : fallback;
    }

    function set(key, value) {
        memory.set(key, String(value));
        try { globalThis.localStorage.setItem(PREFIX + key, String(value)); } catch (error) { }
    }

    // A stable, random per-browser key that identifies the player across rooms (not a secret).
    function playerKey() {
        let key = get("playerKey");
        if (!/^[a-z0-9]{12}$/.test(key || "")) {
            key = OCG.db.randomId(12);
            set("playerKey", key);
        }
        return key;
    }

    OCG.storage = { get, set, playerKey };
})(globalThis.OCG ??= {});
