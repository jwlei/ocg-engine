// Database access behind one small interface, with two backends:
// - FirebaseBackend: Firebase Realtime Database, connected after an anonymous sign-in.
// - MemoryBackend: an in-memory database for local play (one tab) and tests.
(function (OCG) {
    "use strict";

    function randomId(length = 12) {
        const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
        return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
    }

    function segments(path) {
        return String(path).split("/").filter(Boolean);
    }

    // Mirrors how Firebase stores JSON: no undefined, and empty objects or arrays disappear.
    function normalize(value) {
        if (value === undefined || value === null) { return null; }
        if (Array.isArray(value)) {
            const items = value.map(normalize);
            return items.length == 0 ? null : items;
        }
        if (typeof value == "object") {
            const result = {};
            for (const [key, child] of Object.entries(value)) {
                const normalized = normalize(child);
                if (normalized !== null) { result[key] = normalized; }
            }
            return Object.keys(result).length == 0 ? null : result;
        }
        return value;
    }

    function clone(value) {
        return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
    }

    function related(a, b) {
        const left = segments(a);
        const right = segments(b);
        const length = Math.min(left.length, right.length);
        for (let i = 0; i < length; i++) {
            if (left[i] != right[i]) { return false; }
        }
        return true;
    }

    // In-memory JSON tree with value listeners. Several MemoryBackends (clients) can share one store.
    class MemoryStore {
        constructor() {
            this.root = null;
            this.listeners = new Set();
            this.dirty = new Set();
        }
        read(path) {
            let node = this.root;
            for (const key of segments(path)) {
                if (node === null || typeof node != "object") { return null; }
                node = node[key] ?? null;
            }
            return clone(node);
        }
        write(path, value) {
            const keys = segments(path);
            if (keys.length == 0) {
                this.root = normalize(value);
            } else {
                const root = clone(this.root) || {};
                let node = root;
                for (const key of keys.slice(0, -1)) {
                    if (node[key] === null || typeof node[key] != "object") { node[key] = {}; }
                    node = node[key];
                }
                node[keys.at(-1)] = clone(value);
                this.root = normalize(root);
            }
            for (const listener of this.listeners) {
                if (related(listener.path, path)) { this.dirty.add(listener); }
            }
            this.flushSoon();
        }
        flushSoon() {
            if (this.flushPending) { return; }
            this.flushPending = true;
            queueMicrotask(() => {
                this.flushPending = false;
                const listeners = Array.from(this.dirty);
                this.dirty.clear();
                for (const listener of listeners) {
                    if (this.listeners.has(listener)) { listener.callback(this.read(listener.path)); }
                }
            });
        }
        subscribe(path, callback) {
            const listener = { path, callback };
            this.listeners.add(listener);
            this.dirty.add(listener);
            this.flushSoon();
            return () => this.listeners.delete(listener);
        }
    }

    // One client of a MemoryStore. disconnect() simulates the browser going away.
    class MemoryBackend {
        constructor({ uid = `local-${randomId(8)}`, store = new MemoryStore() } = {}) {
            this.kind = "memory";
            this.uid = uid;
            this.store = store;
            this.disconnectRemovals = new Set();
        }
        now() { return Date.now(); }
        serverTimestamp() { return Date.now(); }
        async get(path) { return this.store.read(path); }
        async set(path, value) { this.store.write(path, value); }
        async update(path, values) {
            for (const [key, value] of Object.entries(values)) { this.store.write(`${path}/${key}`, value); }
        }
        async remove(path) { this.store.write(path, null); }
        async push(path, value) {
            const key = `${Date.now().toString(36)}${randomId(6)}`;
            this.store.write(`${path}/${key}`, value);
            return key;
        }
        async transaction(path, update, { requireExisting = false } = {}) {
            const current = this.store.read(path);
            if (requireExisting && current === null) { return { committed: false, value: null }; }
            const next = update(current);
            if (next === undefined) { return { committed: false, value: current }; }
            this.store.write(path, next);
            return { committed: true, value: this.store.read(path) };
        }
        subscribe(path, callback) { return this.store.subscribe(path, callback); }
        async onDisconnectRemove(path) { this.disconnectRemovals.add(path); }
        disconnect() {
            this.disconnectRemovals.forEach(path => this.store.write(path, null));
            this.disconnectRemovals.clear();
        }
    }

    class FirebaseBackend {
        constructor(firebase, user) {
            this.kind = "firebase";
            this.firebase = firebase;
            this.database = firebase.database();
            this.uid = user.uid;
            this.serverOffset = 0;
            this.database.ref(".info/serverTimeOffset").on("value", snapshot => {
                this.serverOffset = snapshot.val() || 0;
            });
        }
        now() { return Date.now() + this.serverOffset; }
        serverTimestamp() { return this.firebase.database.ServerValue.TIMESTAMP; }
        ref(path) { return this.database.ref(path); }
        async get(path) { return (await this.ref(path).once("value")).val(); }
        set(path, value) { return this.ref(path).set(normalize(value)); }
        update(path, values) { return this.ref(path).update(values); }
        remove(path) { return this.ref(path).remove(); }
        async push(path, value) {
            const ref = this.ref(path).push();
            await ref.set(normalize(value));
            return ref.key;
        }
        async transaction(path, update, { requireExisting = false } = {}) {
            const result = await this.ref(path).transaction(current => {
                // Firebase may first run with an empty local cache. Returning null makes it
                // compare with the server and retry with the real value instead of aborting.
                if (requireExisting && current === null) { return null; }
                const next = update(current);
                return next === undefined ? undefined : normalize(next);
            }, undefined, false);
            const value = result.snapshot.val();
            return { committed: result.committed && !(requireExisting && value === null), value };
        }
        subscribe(path, callback) {
            const ref = this.ref(path);
            const handler = snapshot => callback(snapshot.val());
            ref.on("value", handler, error => console.error(`Lost access to ${path}.`, error));
            return () => ref.off("value", handler);
        }
        onDisconnectRemove(path) { return this.ref(path).onDisconnect().remove(); }
    }

    // Signs in anonymously before going online, so database rules can rely on auth.uid.
    async function connectFirebase(firebase, config) {
        firebase.initializeApp(config);
        const database = firebase.database();
        database.goOffline();
        const auth = firebase.auth();
        const user = auth.currentUser || await new Promise((resolve, reject) => {
            const stop = auth.onAuthStateChanged(user => {
                if (user) {
                    stop();
                    resolve(user);
                }
            });
            auth.signInAnonymously().catch(error => {
                stop();
                reject(error);
            });
        });
        database.goOnline();
        return new FirebaseBackend(firebase, user);
    }

    function isConfigured(config) {
        return Boolean(config && config.apiKey && config.databaseURL && !/REPLACE_ME/.test(config.apiKey));
    }

    async function connect({ firebase = globalThis.firebase, config = OCG.config && OCG.config.firebase,
        forceLocal = false } = {}) {
        if (forceLocal || !firebase || !isConfigured(config)) { return new MemoryBackend(); }
        return connectFirebase(firebase, config);
    }

    OCG.db = { MemoryStore, MemoryBackend, FirebaseBackend, connect, isConfigured, normalize, randomId };
})(globalThis.OCG ??= {});
