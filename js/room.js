// A room: lobby, seats, bots, turn-by-turn play through database transactions, presence,
// host handoff and the public lobby listing. Game rules come from an OCG.games definition.
//
// Database layout (see database.rules.json):
//   rooms/$roomId      { game, hostUid, status, isPublic, createdAt, updatedAt, version,
//                        members/$uid { name, playerKey, joinedAt }, bots/$botId { name, addedAt },
//                        seats [{ id, name, bot, left? }], state "<JSON>", results [{ seat, place }],
//                        startedAt, lastMove { seat, actionId, cards?, motion?, version } }
//   presence/$roomId/$uid { at }      removed automatically when the browser disconnects
//   lobbies/$roomId    { game, host, players, maxPlayers, updatedAt }   public rooms waiting for players
(function (OCG) {
    "use strict";

    const BOT_DELAY_MS = 700;
    const HOST_TIMEOUT_MS = 15000;
    const LISTING_STALE_MS = 10 * 60 * 1000;
    const NAME_LIMIT = 24;

    function cleanName(name) {
        const cleaned = String(name ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "")
            .replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
        return cleaned || "Player";
    }

    function members(record) {
        return Object.entries(record?.members || {}).map(([uid, member]) => ({ uid, ...member }))
            .sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
    }

    function bots(record) {
        return Object.entries(record?.bots || {}).map(([id, bot]) => ({ id, ...bot }))
            .sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
    }

    function seatCount(record) { return members(record).length + bots(record).length; }

    // Applies one legal action for `seat` to a room record; undefined aborts the transaction.
    // `motion` is how the cards were thrown (see OCG.gestures.throwMotion); every client uses it
    // to animate the same flight and landing.
    function applyToRecord(record, definition, seat, actionId, now, motion = null) {
        const state = JSON.parse(record.state);
        if (definition.currentSeat(state) !== seat) { return undefined; }
        const action = definition.legalActions(state, seat).find(candidate => candidate.id === actionId);
        if (!action) { return undefined; }
        const next = definition.applyAction(state, seat, action);
        const over = definition.isOver(next);
        const version = (record.version || 0) + 1;
        return {
            ...record, state: JSON.stringify(next), status: over ? "finished" : "playing",
            results: over ? definition.results(next) : null,
            lastMove: { seat, actionId: action.id, cards: action.cards || null, version,
                motion: action.cards ? OCG.gestures.normalizeMotion(motion) : null },
            updatedAt: now, version
        };
    }

    class Room {
        static path(id) { return `rooms/${id}`; }

        // Allocates an unused 6-digit code with a transaction, so an existing room is never overwritten.
        static async create(db, { game, name, playerKey, isPublic = false, random = Math.random }) {
            const definition = OCG.games.get(game);
            for (let attempt = 0; attempt < 10; attempt++) {
                const id = String(100000 + Math.floor(random() * 900000));
                const now = db.now();
                const result = await db.transaction(Room.path(id), current => current === null ? {
                    game: definition.id, hostUid: db.uid, status: "lobby", isPublic: isPublic === true,
                    createdAt: now, updatedAt: now, version: 1,
                    members: { [db.uid]: { name: cleanName(name), playerKey, joinedAt: now } }
                } : undefined);
                if (result.committed && result.value?.hostUid === db.uid && result.value.createdAt === now) {
                    return new Room(db, id);
                }
            }
            throw new Error("Could not create a room. Try again.");
        }

        // Calls back with public rooms waiting for players, newest first.
        static watchLobbies(db, callback) {
            return db.subscribe("lobbies", listings => {
                const now = db.now();
                callback(Object.entries(listings || {}).map(([id, listing]) => ({ id, ...listing }))
                    .filter(listing => now - listing.updatedAt < LISTING_STALE_MS)
                    .sort((a, b) => b.updatedAt - a.updatedAt));
            });
        }

        constructor(db, id, { random = Math.random, botDelayMs = BOT_DELAY_MS, hostTimeoutMs = HOST_TIMEOUT_MS } = {}) {
            if (!/^[1-9][0-9]{5}$/.test(String(id))) { throw new Error("Room codes have 6 digits."); }
            this.db = db;
            this.id = String(id);
            this.random = random;
            this.botDelayMs = botDelayMs;
            this.hostTimeoutMs = hostTimeoutMs;
            this.record = undefined;
            this.presence = undefined;
            this.stops = [];
            this.timers = new Set();
        }

        get path() { return Room.path(this.id); }
        get loaded() { return this.record !== undefined; }
        get exists() { return this.record != null; }
        get definition() { return this.exists ? OCG.games.get(this.record.game) : null; }
        get status() { return this.record?.status ?? null; }
        get members() { return members(this.record); }
        get bots() { return bots(this.record); }
        get seats() { return this.record?.seats || []; }
        get isMember() { return Boolean(this.record?.members?.[this.db.uid]); }
        get isHost() { return this.exists && this.record.hostUid === this.db.uid && this.isMember; }
        get mySeat() {
            const seat = this.seats.findIndex(entry => entry.id === this.db.uid && !entry.bot);
            return seat < 0 ? null : seat;
        }
        get state() {
            if (!this.record?.state) { return null; }
            if (this.parsedFrom !== this.record.state) {
                this.parsedFrom = this.record.state;
                this.parsedState = JSON.parse(this.record.state);
            }
            return this.parsedState;
        }
        get view() { return this.state ? this.definition.view(this.state, this.mySeat) : null; }
        get legalActions() {
            const seat = this.mySeat;
            return this.state && seat != null && this.status == "playing"
                ? this.definition.legalActions(this.state, seat) : [];
        }
        isOnline(uid) { return Boolean(this.presence?.[uid]); }

        open(onChange = () => { }) {
            this.onChange = onChange;
            this.stops.push(
                this.db.subscribe(this.path, record => { this.record = record; this.afterChange(); }),
                this.db.subscribe(`presence/${this.id}`, presence => { this.presence = presence || {}; this.afterChange(); })
            );
            return this;
        }

        close() {
            this.stops.forEach(stop => stop());
            this.stops = [];
            this.timers.forEach(clearTimeout);
            this.timers.clear();
            if (this.present) {
                this.present = false;
                this.db.remove(`presence/${this.id}/${this.db.uid}`).catch(() => { });
            }
        }

        // Joins the lobby as a player. Returns "player", or "spectator" when the game has started.
        async join({ name, playerKey }) {
            const record = await this.db.get(this.path);
            if (!record) { throw new Error("Room not found."); }
            if (record.members?.[this.db.uid]) { return "player"; }
            if (record.status != "lobby") { return "spectator"; }
            if (seatCount(record) >= OCG.games.get(record.game).maxPlayers) { throw new Error("The room is full."); }
            await this.db.set(`${this.path}/members/${this.db.uid}`,
                { name: cleanName(name), playerKey, joinedAt: this.db.now() });
            return "player";
        }

        async start() {
            await this.change(record => {
                if (record.hostUid !== this.db.uid || record.status != "lobby") { return; }
                const definition = OCG.games.get(record.game);
                const seats = [
                    ...members(record).map(member => ({ id: member.uid, name: member.name, bot: false })),
                    ...bots(record).map(bot => ({ id: bot.id, name: bot.name, bot: true }))
                ].slice(0, definition.maxPlayers);
                if (seats.length < definition.minPlayers) { return; }
                const state = definition.setup(
                    seats.map((seat, index) => ({ seat: index, name: seat.name, bot: seat.bot })), this.random);
                return { ...record, status: "playing", seats, state: JSON.stringify(state), results: null,
                    lastMove: null, startedAt: this.db.now() };
            }, "The game could not be started.");
        }

        // Plays one of `legalActions`. Pass { motion } from a drag or flick so others see the same throw.
        async act(action, { motion = null } = {}) {
            const actionId = typeof action == "string" ? action : action.id;
            await this.change(record => {
                if (record.status != "playing") { return; }
                const seat = (record.seats || []).findIndex(entry => entry.id === this.db.uid && !entry.bot);
                return seat < 0 ? undefined
                    : applyToRecord(record, OCG.games.get(record.game), seat, actionId, this.db.now(), motion);
            }, "That move is no longer possible.");
        }

        async addBot() {
            await this.change(record => {
                const definition = OCG.games.get(record.game);
                if (record.hostUid !== this.db.uid || record.status != "lobby" ||
                    seatCount(record) >= definition.maxPlayers) { return; }
                const taken = new Set([...members(record), ...bots(record)].map(entry => entry.name));
                const name = definition.botNames.find(candidate => !taken.has(candidate)) ||
                    Array.from({ length: 99 }, (_, index) => `Bot ${index + 1}`).find(candidate => !taken.has(candidate));
                const id = `bot-${OCG.db.randomId(8)}`;
                // Strictly later than every existing bot, so bots keep the order they were added in.
                const addedAt = Math.max(this.db.now(), ...bots(record).map(bot => bot.addedAt + 1));
                return { ...record, bots: { ...record.bots, [id]: { name, addedAt } } };
            }, "No free seat for a bot.");
        }

        async removeBot(botId) {
            await this.change(record => {
                if (record.hostUid !== this.db.uid || record.status != "lobby" || !record.bots?.[botId]) { return; }
                const remaining = { ...record.bots };
                delete remaining[botId];
                return { ...record, bots: remaining };
            });
        }

        async kick(uid) {
            await this.change(record => {
                if (record.hostUid !== this.db.uid || uid === this.db.uid || record.status != "lobby" ||
                    !record.members?.[uid]) { return; }
                const remaining = { ...record.members };
                delete remaining[uid];
                return { ...record, members: remaining };
            });
        }

        async backToLobby() {
            await this.change(record => {
                if (record.hostUid !== this.db.uid || record.status != "finished") { return; }
                return { ...record, status: "lobby", seats: null, state: null, results: null, lastMove: null, startedAt: null };
            });
        }

        // Leaves the room. A seat in a running game is handed to a bot; the host role passes on.
        async leave() {
            const wasHost = this.isHost;
            if (wasHost) { await this.db.remove(`lobbies/${this.id}`).catch(() => { }); }
            await this.db.transaction(this.path, record => {
                if (!record || !record.members?.[this.db.uid]) { return; }
                const remaining = { ...record.members };
                delete remaining[this.db.uid];
                const next = { ...record, members: remaining, updatedAt: this.db.now(), version: (record.version || 0) + 1 };
                const others = members(next);
                if (others.length == 0) { return null; }
                if (record.hostUid === this.db.uid) { next.hostUid = others[0].uid; }
                if (record.status == "playing") {
                    next.seats = (record.seats || []).map(seat =>
                        seat.id === this.db.uid ? { ...seat, bot: true, left: true } : seat);
                }
                return next;
            }, { requireExisting: true });
            this.close();
        }

        // Runs a room update in a transaction and bumps the version; throws `failure` if it aborts.
        async change(update, failure = "The room changed. Try again.") {
            const result = await this.db.transaction(this.path, record => {
                if (!record || !record.members?.[this.db.uid]) { return; }
                const next = update(record);
                return next === undefined || next === null ? undefined
                    : { ...next, updatedAt: this.db.now(), version: (record.version || 0) + 1 };
            }, { requireExisting: true });
            if (!result.committed) { throw new Error(failure); }
            return result.value;
        }

        afterChange() {
            if (this.exists && this.isMember && !this.present) {
                this.present = true;
                const path = `presence/${this.id}/${this.db.uid}`;
                Promise.resolve(this.db.onDisconnectRemove(path))
                    .then(() => this.db.set(path, { at: this.db.serverTimestamp() }))
                    .catch(error => console.error("Could not register presence.", error));
            }
            this.watchHost();
            this.syncListing();
            this.scheduleBot();
            this.onChange(this);
        }

        later(callback, delay) {
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                callback();
            }, delay);
            this.timers.add(timer);
            return timer;
        }

        // When the host has been offline for a while, the earliest online member takes over.
        watchHost() {
            if (!this.exists || this.presence === undefined || !this.isMember || this.isHost ||
                this.isOnline(this.record.hostUid)) {
                this.hostMissingSince = null;
                return;
            }
            const successor = members(this.record).find(member =>
                member.uid !== this.record.hostUid && this.isOnline(member.uid));
            if (!successor || successor.uid !== this.db.uid) { return; }
            if (this.hostMissingSince == null) {
                this.hostMissingSince = this.db.now();
                this.later(() => this.watchHost(), this.hostTimeoutMs + 50);
                return;
            }
            if (this.db.now() - this.hostMissingSince < this.hostTimeoutMs) { return; }
            const absentHost = this.record.hostUid;
            this.hostMissingSince = null;
            this.change(record => record.hostUid === absentHost ? { ...record, hostUid: this.db.uid } : undefined)
                .catch(() => { });
        }

        syncListing() {
            if (!this.isHost) {
                this.lastListing = undefined;
                return;
            }
            const record = this.record;
            const definition = this.definition;
            const host = record.members[record.hostUid];
            const listed = record.isPublic === true && record.status == "lobby";
            const listing = listed ? { game: definition.id, host: host.name, players: seatCount(record),
                maxPlayers: definition.maxPlayers } : null;
            const key = JSON.stringify(listing);
            if (key === this.lastListing) { return; }
            this.lastListing = key;
            const path = `lobbies/${this.id}`;
            const write = listing
                ? Promise.resolve(this.db.onDisconnectRemove(path))
                    .then(() => this.db.set(path, { ...listing, updatedAt: this.db.now() }))
                : this.db.remove(path);
            write.catch(error => console.error("Could not update the public lobby.", error));
        }

        // The host plays for bot seats, one move per room version, after a short delay.
        scheduleBot() {
            if (!this.isHost || this.status != "playing" || !this.state) { return; }
            const seat = this.definition.currentSeat(this.state);
            const version = this.record.version;
            if (seat == null || !this.seats[seat]?.bot || this.scheduledBotVersion === version) { return; }
            this.scheduledBotVersion = version;
            this.later(() => {
                this.change(record => {
                    if (record.version !== version || record.status != "playing" || record.hostUid !== this.db.uid) { return; }
                    const definition = OCG.games.get(record.game);
                    const state = JSON.parse(record.state);
                    const current = definition.currentSeat(state);
                    if (current == null || !record.seats[current]?.bot) { return; }
                    const action = OCG.games.chooseBotAction(definition, state, current, this.random);
                    return action ? applyToRecord(record, definition, current, action.id, this.db.now(),
                        OCG.gestures.botMotion(this.random)) : undefined;
                }).catch(() => { });
            }, this.botDelayMs);
        }
    }

    OCG.Room = Room;
    OCG.rooms = { cleanName, applyToRecord, LISTING_STALE_MS };
})(globalThis.OCG ??= {});
