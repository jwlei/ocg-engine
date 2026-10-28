const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OCG } = require("./load.cjs");

const { tuning, isUpwardFlick, touchDragAxis, FlickTracker, throwMotion, normalizeMotion, botMotion } = OCG.gestures;
const HALF_CONE = tuning.pickupCone / 2;

// Moves from (x, y) along screen offsets [time, dx, dy] and releases at the last sample.
function stroke(points, start = { x: 200, y: 500, time: 1000 }) {
    const tracker = new FlickTracker(start.x, start.y, start.time);
    let last = start;
    for (const [time, x, y] of points) {
        last = { x: start.x + x, y: start.y + y, time };
        tracker.record(last.x, last.y, time);
    }
    return { tracker, release: last };
}

const polar = (angle, distance) => [Math.sin(angle * Math.PI / 180) * distance, -Math.cos(angle * Math.PI / 180) * distance];

test("the upward cone accepts its edges and rejects anything wider or downward", () => {
    for (const angle of [0, 45, HALF_CONE - 0.1, -(HALF_CONE - 0.1)]) {
        const [x, y] = polar(angle, 20);
        assert.equal(isUpwardFlick(x, -y), true, `${angle}`);
    }
    for (const angle of [HALF_CONE + 1, -(HALF_CONE + 1), 90, 180]) {
        const [x, y] = polar(angle, 20);
        assert.equal(isUpwardFlick(x, -y), false, `${angle}`);
    }
});

test("touch strokes pick up upward, scroll near horizontal and wait in between", () => {
    assert.equal(touchDragAxis(2, -5), null, "Below the intent distance");
    assert.equal(touchDragAxis(...polar(0, 20)), "vertical");
    assert.equal(touchDragAxis(...polar(HALF_CONE - 1, 20)), "vertical");
    assert.equal(touchDragAxis(...polar(90, 20)), "horizontal");
    assert.equal(touchDragAxis(...polar(-80, 20)), "horizontal");
    if (HALF_CONE + 1 < 74) { assert.equal(touchDragAxis(...polar(HALF_CONE + 1, 20)), null); }
});

test("a quick upward stroke is a flick; slow, short, sideways or held strokes are not", () => {
    let { tracker, release } = stroke([[1010, 0, -10], [1020, 0, -20], [1030, 0, -30]]);
    assert.equal(tracker.isFlick(release.time), true);
    assert.equal(tracker.isFlick(release.time + tuning.flickReleaseGraceMs), true);
    assert.equal(tracker.isFlick(release.time + tuning.flickReleaseGraceMs + 1), false, "Held too long");

    const slowDuration = 30 / (tuning.flickMinVelocity / 2);
    ({ tracker, release } = stroke([[1000 + slowDuration / 2, 0, -15], [1000 + slowDuration, 0, -30]]));
    assert.equal(tracker.isFlick(release.time), false, "Too slow");

    ({ tracker, release } = stroke([[1010, 0, -tuning.flickMinDistance / 2]]));
    assert.equal(tracker.isFlick(release.time), false, "Too short");

    ({ tracker, release } = stroke([[1010, ...polar(HALF_CONE + 10, 10)], [1020, ...polar(HALF_CONE + 10, 20)]]));
    assert.equal(tracker.isFlick(release.time), false, "Outside the cone");
});

test("tiny lift-off recoil keeps a flick, a deliberate reversal cancels it", () => {
    // Recoil shorter than the minimum flick distance is ignored (1 px with the default tuning).
    let { tracker, release } = stroke([[1010, 0, -15], [1020, 0, -30], [1036, 0, -30 + tuning.flickMinDistance / 2]]);
    assert.equal(tracker.isFlick(release.time), true);
    ({ tracker, release } = stroke([[1010, 0, -15], [1020, 0, -30], [1040, 0, -22]]));
    assert.equal(tracker.isFlick(release.time), false);
});

test("only the recent finish counts: a slow pickup can end in a flick", () => {
    const { tracker, release } = stroke([[1200, 0, -5], [1400, 0, -10], [1600, 0, -15], [1616, 0, -31], [1632, 0, -47]]);
    assert.equal(tracker.isFlick(release.time), true);
});

test("throw motion is relative to the table and clamped", () => {
    const table = { left: 0, top: 0, width: 400, height: 300 };
    const { tracker, release } = stroke([[1010, 10, -20], [1020, 20, -40]], { x: 200, y: 400, time: 1000 });
    const motion = throwMotion(tracker, release, table, { pitch: 30, yaw: -4 });
    assert.ok(motion.y < 0.9, "Thrown upward toward the table");
    assert.ok(motion.power > 0);
    assert.equal(motion.pitch, 18, "Tilt is clamped");
    assert.equal(motion.yaw, -4);
    for (const value of Object.values(motion)) { assert.ok(Number.isFinite(value)); }
    assert.equal(normalizeMotion({ x: NaN }), null);
    assert.equal(normalizeMotion(null), null);
    assert.deepEqual(normalizeMotion({ x: 5, y: -5, power: -1, spin: 99, pitch: 0, yaw: 0 }),
        { x: 1, y: -1, power: 0, spin: 20, pitch: 0, yaw: 0 });
});

test("bot throws are valid motions", () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
        const motion = botMotion(random);
        assert.deepEqual(normalizeMotion(motion), motion);
    }
});

test("table jitter is stable per play and keeps a readable fan", () => {
    const { jitter } = OCG.cardMotion;
    assert.deepEqual(jitter("g:S9,H9", 1, 2), jitter("g:S9,H9", 1, 2));
    assert.notDeepEqual(jitter("g:S9,H9", 0, 2), jitter("g:S9,H9", 1, 2));
    for (let i = 0; i < 4; i++) {
        const offset = jitter(`seed-${i}`, i, 4, { power: 1, spin: 20, x: 0, y: 0, pitch: 0, yaw: 0 }, 12);
        assert.ok(Math.abs(offset.angle) <= 30);
        assert.ok(Math.abs(offset.landX) <= 0.25 && Math.abs(offset.landY) <= 0.2);
    }
});
