// Flick and drag recognition for playing cards, independent of the DOM so it can be unit tested.
// Ported from Boms og President's tuned hand input.
(function (OCG) {
    "use strict";

    // Input tuning: degrees, pixels, pixels per millisecond, then milliseconds.
    const tuning = {
        pickupCone: 140,            // upward cone (degrees) that picks up a card on touch and counts as a flick
        flickMinDistance: 2,        // px of recent movement a flick needs
        flickMinVelocity: 0.15,     // px/ms over the recent stroke
        flickReleaseGraceMs: 200,   // how long a recognized flick stays valid before release
        flickRecoilTolerance: 3,    // px of lift-off recoil that does not cancel a flick
        sampleWindowMs: 80,         // only the recent finish of a stroke counts
        touchIntentDistance: 8,     // px before a touch decides between pickup and scrolling
        horizontalScrollDistance: 12
    };

    // True when (x, y) points upward (y > 0 is up) within the cone.
    function isUpwardFlick(x, y, coneDegrees = tuning.pickupCone) {
        return y > 0 && y + 1e-6 >= Math.abs(x) * Math.tan((180 - coneDegrees) * Math.PI / 360);
    }

    // Decides what a touch stroke from its start means: "vertical" (pick up), "horizontal" (scroll) or null (undecided).
    // x and y are screen offsets (y grows downward).
    function touchDragAxis(x, y) {
        if (Math.max(Math.abs(x), Math.abs(y)) < tuning.touchIntentDistance) { return null; }
        if (isUpwardFlick(x, -y)) { return "vertical"; }
        if (Math.abs(y) <= Math.abs(x) * Math.tan(Math.PI / 12) + 1e-6) {
            return Math.abs(x) >= tuning.horizontalScrollDistance ? "horizontal" : null;
        }
        return Math.abs(y) >= Math.max(tuning.touchIntentDistance, Math.abs(x) * 1.1) ? "vertical" : null;
    }

    // Prefers the event's own timestamp, which reflects when the finger moved, over handler time.
    function eventTime(event, now = globalThis.performance ? performance.now() : Date.now()) {
        const stamp = event ? event.timeStamp : null;
        return typeof stamp == "number" && Number.isFinite(stamp) && stamp > 0 &&
            stamp <= now + 1 && now - stamp < 1000 ? stamp : now;
    }

    // Tracks one pointer stroke: velocity for throws, and the most recent upward flick.
    class FlickTracker {
        constructor(x, y, time) {
            this.lastPointerX = x;
            this.lastPointerY = y;
            this.lastPointerMoveTime = time;
            this.velocityX = 0;
            this.velocityY = 0;
            this.lastMotionTime = time;
            this.flickDirection = 0;
            this.flickSamples = [];
            this.flickExtremeY = null;
            this.lastFlickX = 0;
            this.lastFlickY = 0;
            this.lastFlickDistance = 0;
            this.lastFlickVelocity = 0;
            this.lastFlickMoveTime = null;
            this.flickIntent = null;
        }

        record(pointerX, pointerY, moveTime) {
            const deltaX = pointerX - this.lastPointerX;
            const deltaY = pointerY - this.lastPointerY;
            const intent = this.flickIntent;
            if (intent) {
                const finishX = pointerX - intent.endX;
                const finishY = pointerY - intent.endY;
                const reverseDistance = -(finishX * intent.x - finishY * intent.y) / intent.distance;
                if (moveTime - intent.time > tuning.flickReleaseGraceMs ||
                    finishY > tuning.flickRecoilTolerance ||
                    reverseDistance > tuning.flickRecoilTolerance ||
                    (Math.hypot(finishX, finishY) >= tuning.flickMinDistance && !isUpwardFlick(finishX, -finishY))) {
                    this.flickIntent = null;
                }
            }
            if (deltaX == 0 && deltaY == 0 && moveTime - this.lastPointerMoveTime > tuning.sampleWindowMs) {
                this.flickSamples = [];
                this.flickDirection = 0;
                this.flickExtremeY = pointerY;
            }
            if (deltaX != 0 || deltaY != 0) {
                const elapsed = Math.max(1, moveTime - this.lastPointerMoveTime);
                this.velocityX = this.velocityX * 0.35 + deltaX / elapsed * 0.65;
                this.velocityY = this.velocityY * 0.35 + deltaY / elapsed * 0.65;
                this.lastMotionTime = moveTime;
            }
            const distance = this.lastPointerY - pointerY;
            if (deltaX != 0 || distance != 0) {
                const direction = Math.sign(distance) || this.flickDirection;
                let extremeY = this.flickExtremeY ?? this.lastPointerY;
                // Sub-threshold recoil must not split a short, not-yet-recognized stroke.
                if (direction != this.flickDirection && (this.flickDirection == 0 ||
                    (pointerY - extremeY) * this.flickDirection > tuning.flickRecoilTolerance)) {
                    this.flickDirection = direction;
                    this.flickSamples = [];
                    extremeY = this.lastPointerY;
                }
                this.flickExtremeY = this.flickDirection > 0 ? Math.min(extremeY, pointerY) : Math.max(extremeY, pointerY);
                const samples = this.flickSamples;
                if (samples.length == 0) {
                    samples.push({ x: this.lastPointerX, y: this.lastPointerY, time: this.lastPointerMoveTime });
                }
                samples.push({ x: pointerX, y: pointerY, time: moveTime });
                // Only the recent finish matters, not a slow pickup or the earlier part of a curve.
                const cutoff = moveTime - tuning.sampleWindowMs;
                while (samples.length > 2 && samples[1].time <= cutoff) { samples.shift(); }
                const first = samples[0];
                const next = samples[1];
                let startTime = Math.max(first.time, cutoff);
                const fraction = next.time > first.time
                    ? Math.max(0, Math.min(1, (startTime - first.time) / (next.time - first.time))) : 0;
                let startX = first.x + (next.x - first.x) * fraction;
                let startY = first.y + (next.y - first.y) * fraction;
                for (let i = samples.length - 2; i >= 0; i--) {
                    const sample = samples[i];
                    if (sample.time < cutoff) { break; }
                    if (Math.hypot(pointerX - sample.x, pointerY - sample.y) >= tuning.flickMinDistance) {
                        startX = sample.x;
                        startY = sample.y;
                        startTime = sample.time;
                        break;
                    }
                }
                this.lastFlickX = pointerX - startX;
                this.lastFlickY = startY - pointerY;
                this.lastFlickDistance = Math.hypot(this.lastFlickX, this.lastFlickY);
                this.lastFlickVelocity = this.lastFlickDistance / Math.max(1, moveTime - startTime);
                this.lastFlickMoveTime = moveTime;
                if (distance > 0 && pointerY <= extremeY && isUpwardFlick(this.lastFlickX, this.lastFlickY) &&
                    this.lastFlickDistance >= tuning.flickMinDistance &&
                    this.lastFlickVelocity >= tuning.flickMinVelocity) {
                    // Keep a recognized flick through tiny lift-off recoil, not a deliberate reversal.
                    this.flickIntent = {
                        x: this.lastFlickX, y: this.lastFlickY, distance: this.lastFlickDistance,
                        velocity: this.lastFlickVelocity, time: moveTime, endX: pointerX, endY: pointerY
                    };
                }
            }
            this.lastPointerX = pointerX;
            this.lastPointerY = pointerY;
            this.lastPointerMoveTime = moveTime;
        }

        // Whether releasing now counts as an upward flick.
        isFlick(releaseTime) {
            const flick = this.flickIntent;
            const x = flick ? flick.x : this.lastFlickX;
            const y = flick ? flick.y : this.lastFlickY;
            return isUpwardFlick(x, y) &&
                (flick ? flick.distance : this.lastFlickDistance) >= tuning.flickMinDistance &&
                (flick ? flick.velocity : this.lastFlickVelocity) >= tuning.flickMinVelocity &&
                (flick ? releaseTime - flick.time <= tuning.flickReleaseGraceMs
                    : this.lastFlickMoveTime == null || releaseTime - this.lastFlickMoveTime <= tuning.flickReleaseGraceMs);
        }
    }

    const MOTION_LIMITS = { x: 1, y: 1, power: 1, spin: 20, pitch: 18, yaw: 18 };

    // Clamps a throw to known ranges; returns null for anything malformed.
    function normalizeMotion(motion) {
        if (!motion || typeof motion != "object") { return null; }
        const result = {};
        for (const [key, limit] of Object.entries(MOTION_LIMITS)) {
            if (!Number.isFinite(motion[key])) { return null; }
            const value = Math.max(key == "power" ? 0 : -limit, Math.min(limit, motion[key]));
            result[key] = Math.round(value * 1000) / 1000;
        }
        return result;
    }

    // Where and how hard a released card was thrown, relative to the table:
    // x/y in -1..1 from the table centre (projected 160 ms ahead), power 0..1, spin and tilt in degrees.
    function throwMotion(tracker, release, table, tilt = { pitch: 0, yaw: 0 }) {
        const decay = Math.exp(-Math.max(0, release.time - tracker.lastMotionTime) / 90);
        const velocityX = tracker.velocityX * decay;
        const velocityY = tracker.velocityY * decay;
        return normalizeMotion({
            x: (release.x + velocityX * 160 - table.left - table.width / 2) / Math.max(1, table.width / 2),
            y: (release.y + velocityY * 160 - table.top - table.height / 2) / Math.max(1, table.height / 2),
            power: Math.hypot(velocityX, velocityY) / 2.5,
            spin: velocityX * 5,
            pitch: tilt.pitch || 0,
            yaw: tilt.yaw || 0
        });
    }

    // A plausible throw for bots, so their cards land with the same variety as players'.
    function botMotion(random = Math.random) {
        const direction = random() * Math.PI * 2;
        const power = 0.2 + random() * 0.7;
        const reach = Math.sqrt(random()) * (0.35 + power * 0.5);
        const spin = (random() - 0.5) * 32;
        return normalizeMotion({
            x: Math.cos(direction) * reach, y: Math.sin(direction) * reach * 0.8, power, spin,
            pitch: (random() - 0.5) * 30, yaw: spin * 0.65 + (random() - 0.5) * 12
        });
    }

    OCG.gestures = { tuning, isUpwardFlick, touchDragAxis, eventTime, FlickTracker, normalizeMotion, throwMotion, botMotion };
})(globalThis.OCG ??= {});
