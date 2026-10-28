// Card movement in the DOM: dragging and flicking cards out of the hand, throwing them onto the
// table with a landing slide, sweeping a finished trick away and dealing a new hand.
// Card elements carry data-card="<card id>". Everything respects prefers-reduced-motion.
(function (OCG) {
    "use strict";

    const durations = { play: 560, stagger: 55, returnGlide: 320, clear: 720, clearStagger: 12, deal: 380, dealStagger: 22 };
    const DRAG_SCALE = 1.12;
    const MAX_TILT = 18;

    function reducedMotion() {
        return Boolean(globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function canAnimate() {
        return !reducedMotion() && !document.hidden && typeof Element.prototype.animate == "function";
    }

    // A card's own layout box (getBoundingClientRect grows with rotation; flights rotate themselves).
    function unrotatedRect(element) {
        const bounds = element.getBoundingClientRect();
        const width = element.offsetWidth || bounds.width;
        const height = element.offsetHeight || bounds.height;
        return { left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2, width, height };
    }

    // Card id → layout box for every card element inside `container`.
    function cardRects(container) {
        const rects = new Map();
        if (!container) { return rects; }
        container.querySelectorAll("[data-card]").forEach(card => rects.set(card.dataset.card, unrotatedRect(card)));
        return rects;
    }

    // Stable pseudo-random offsets for a card on the table: the same play lands the same way on every
    // client and across redraws. Groups keep a readable fan with a little per-card splay.
    function jitter(seedText, cardIndex, count, motion = null, seatBias = 0) {
        let seed = 2166136261;
        for (let i = 0; i < seedText.length; i++) { seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619) >>> 0; }
        const unit = (shift, value = seed) => (((value >>> shift) & 255) / 255) - 0.5;
        const cardSeed = Math.imul(seed ^ (cardIndex * 2654435761), 2246822519) >>> 0;
        const splay = count > 1;
        const power = motion ? motion.power : 0;
        const centre = cardIndex - (count - 1) / 2;
        return {
            angle: Math.round(Math.max(-30, Math.min(30, seatBias + unit(0) * 20 + centre * (6 + power * 4) +
                (splay ? unit(0, cardSeed) * 4 : 0) + (motion ? motion.spin : 0))) * 10) / 10,
            x: Math.round(unit(8) * 14 + centre * power * 8 + (splay ? unit(8, cardSeed) * 6 : 0)),
            y: Math.round(unit(16) * 10 + Math.abs(centre) * (3 + power * 4) + (splay ? unit(16, cardSeed) * 10 : 0)),
            // Landing spot (-1..1 of the free table space) when the play carries no throw.
            landX: unit(24) * 0.5,
            landY: unit(4, cardSeed) * 0.4
        };
    }

    // Drag preview -----------------------------------------------------------------------------------

    function startDrag(cards, startX, startY) {
        const layer = document.createElement("div");
        layer.className = "card-drag-layer";
        layer.setAttribute("aria-hidden", "true");
        const rects = cards.map(card => unrotatedRect(card));
        const previews = cards.map((card, index) => {
            const preview = card.cloneNode(true);
            preview.removeAttribute("id");
            preview.classList.add("card-drag-preview");
            preview.classList.remove("is-selected");
            preview.tabIndex = -1;
            Object.assign(preview.style, {
                left: `${rects[index].left}px`, top: `${rects[index].top}px`,
                width: `${rects[index].width}px`, height: `${rects[index].height}px`
            });
            layer.appendChild(preview);
            card.classList.add("is-drag-source");
            return preview;
        });
        document.body.appendChild(layer);
        return { layer, cards, previews, startX, startY, pointerX: startX, pointerY: startY,
            sampledX: startX, sampledY: startY, pitch: 0, yaw: 0, targetPitch: 0, targetYaw: 0,
            frame: null, lastFrameTime: null, pending: null, returning: false };
    }

    function moveDrag(drag, pointerX, pointerY) {
        drag.pointerX = pointerX;
        drag.pointerY = pointerY;
        drag.pending = { x: pointerX - drag.startX, y: pointerY - drag.startY };
        if (reducedMotion()) {
            applyDragPosition(drag);
        } else if (drag.frame == null) {
            drag.frame = requestAnimationFrame(time => animateDrag(drag, time));
        }
    }

    function applyDragPosition(drag) {
        if (!drag.pending) { return; }
        const { x, y } = drag.pending;
        drag.pending = null;
        const scale = reducedMotion() ? "1" : String(DRAG_SCALE);
        drag.previews.forEach(preview => {
            preview.style.setProperty("--drag-x", `${x}px`);
            preview.style.setProperty("--drag-y", `${y}px`);
            preview.style.setProperty("--drag-scale", scale);
        });
    }

    // Tilts the dragged cards with their recent velocity and eases back when they slow down.
    function animateDrag(drag, time) {
        drag.frame = null;
        applyDragPosition(drag);
        const elapsed = drag.lastFrameTime == null ? 16 : Math.max(1, time - drag.lastFrameTime);
        drag.lastFrameTime = time;
        const velocityX = (drag.pointerX - drag.sampledX) / Math.max(16, elapsed);
        const velocityY = (drag.pointerY - drag.sampledY) / Math.max(16, elapsed);
        drag.sampledX = drag.pointerX;
        drag.sampledY = drag.pointerY;
        const targetPitch = drag.returning ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, velocityY * 720)) * 0.7;
        const targetYaw = drag.returning ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, -velocityX * 720));
        const targetBlend = 1 - Math.exp(-elapsed / 100);
        drag.targetPitch += (targetPitch - drag.targetPitch) * targetBlend;
        drag.targetYaw += (targetYaw - drag.targetYaw) * targetBlend;
        const blend = 1 - Math.exp(-elapsed / 120);
        drag.pitch += (drag.targetPitch - drag.pitch) * blend;
        drag.yaw += (drag.targetYaw - drag.yaw) * blend;
        const settled = [drag.pitch, drag.yaw, drag.targetPitch, drag.targetYaw].every(value => Math.abs(value) < 0.02) &&
            targetPitch == 0 && targetYaw == 0;
        if (settled) { drag.pitch = drag.yaw = drag.targetPitch = drag.targetYaw = 0; }
        drag.previews.forEach((preview, index) => {
            const scale = drag.previews.length == 1 ? 1 : 0.9 + 0.2 * index / (drag.previews.length - 1);
            preview.style.setProperty("--tilt-x", `${Math.max(-MAX_TILT, Math.min(MAX_TILT, drag.pitch * scale)).toFixed(2)}deg`);
            preview.style.setProperty("--tilt-y", `${drag.yaw.toFixed(2)}deg`);
        });
        if (!settled) {
            drag.frame = requestAnimationFrame(next => animateDrag(drag, next));
        } else {
            drag.lastFrameTime = null;
        }
    }

    function removeDrag(drag) {
        if (drag.frame != null) { cancelAnimationFrame(drag.frame); }
        drag.frame = null;
        clearTimeout(drag.returnTimer);
        drag.cards.forEach(card => card.classList.remove("is-drag-source"));
        drag.layer.remove();
    }

    // Glides the dragged cards back into the hand.
    function returnDrag(drag) {
        applyDragPosition(drag);
        if (reducedMotion()) {
            removeDrag(drag);
            return;
        }
        drag.returning = true;
        if (drag.frame != null) { cancelAnimationFrame(drag.frame); drag.frame = null; }
        drag.previews.forEach(preview => preview.getBoundingClientRect());
        drag.previews.forEach(preview => {
            preview.classList.add("is-returning");
            for (const name of ["--drag-x", "--drag-y", "--tilt-x", "--tilt-y"]) {
                preview.style.setProperty(name, name.startsWith("--tilt") ? "0deg" : "0px");
            }
            preview.style.setProperty("--drag-scale", "1");
        });
        drag.returnTimer = setTimeout(() => removeDrag(drag), durations.returnGlide + 20);
    }

    // Where each dragged card is now, for the flight to continue from there.
    function dragOrigins(drag) {
        applyDragPosition(drag);
        const origins = new Map();
        drag.previews.forEach((preview, index) => {
            const bounds = preview.getBoundingClientRect();
            const width = preview.offsetWidth * DRAG_SCALE || bounds.width;
            const height = preview.offsetHeight * DRAG_SCALE || bounds.height;
            origins.set(drag.cards[index].dataset.card, {
                left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2,
                width, height, pitch: drag.pitch, yaw: drag.yaw
            });
        });
        return origins;
    }

    // Hand gestures ----------------------------------------------------------------------------------

    // Lets cards be dragged onto `table` or flicked upward to play. Options:
    //   cardsFor(cardId)  → the card ids a press on this card would play, or null when it cannot play
    //   onPlay(cardIds, motion, handoff) → called on a drop or flick. handoff.origins gives the dragged
    //       cards' positions for animatePlay; call handoff.release() once flights start, or
    //       handoff.cancel() to glide the cards back (for example when the move is rejected).
    // Taps still reach normal click handlers. Horizontal touch strokes are left to native scrolling.
    function attachHand(hand, { table, cardsFor, onPlay }) {
        let gesture = null;
        let suppressClick = false;

        function end() {
            if (!gesture) { return; }
            if (gesture.drag) { returnDrag(gesture.drag); }
            gesture = null;
        }

        function onDown(event) {
            if (event.button !== 0 || gesture) { return; }
            const card = event.target instanceof Element ? event.target.closest("[data-card]") : null;
            if (!card || !hand.contains(card)) { return; }
            const time = OCG.gestures.eventTime(event);
            gesture = { pointerId: event.pointerId, mouse: event.pointerType == "mouse", card,
                cards: cardsFor(card.dataset.card), startX: event.clientX, startY: event.clientY,
                axis: null, moved: false, drag: null,
                tracker: new OCG.gestures.FlickTracker(event.clientX, event.clientY, time) };
            try { hand.setPointerCapture(event.pointerId); } catch (error) { }
        }

        function onMove(event) {
            if (!gesture || gesture.pointerId !== event.pointerId) { return; }
            // Browsers merge fast moves into one event per frame; the merged samples keep a short flick intact.
            const samples = typeof event.getCoalescedEvents == "function" ? event.getCoalescedEvents() : [];
            (samples.length ? samples : [event]).forEach(sample =>
                gesture.tracker.record(sample.clientX, sample.clientY, OCG.gestures.eventTime(sample)));
            const dx = event.clientX - gesture.startX;
            const dy = event.clientY - gesture.startY;
            if (gesture.axis == null && Math.max(Math.abs(dx), Math.abs(dy)) >= (gesture.mouse ? 4 : 8)) {
                gesture.axis = gesture.mouse ? "vertical" : OCG.gestures.touchDragAxis(dx, dy);
                gesture.moved = gesture.axis != null;
            }
            if (gesture.axis == "horizontal") {
                end();
                return;
            }
            if (gesture.axis == "vertical" && gesture.cards) {
                if (!gesture.drag) {
                    const elements = gesture.cards.map(id => hand.querySelector(`[data-card="${id}"]`)).filter(Boolean);
                    if (elements.length != gesture.cards.length) { return; }
                    gesture.drag = startDrag(elements, gesture.startX, gesture.startY);
                }
                event.preventDefault();
                moveDrag(gesture.drag, event.clientX, event.clientY);
            }
        }

        function onUp(event) {
            if (!gesture || gesture.pointerId !== event.pointerId) { return; }
            const active = gesture;
            gesture = null;
            const time = OCG.gestures.eventTime(event);
            active.tracker.record(event.clientX, event.clientY, time);
            suppressClick = active.moved;
            const drag = active.drag;
            if (!drag) { return; }
            if (drag.pending == null) { moveDrag(drag, event.clientX, event.clientY); }
            const area = table.getBoundingClientRect();
            const onTable = event.clientX >= area.left && event.clientX <= area.right &&
                event.clientY >= area.top && event.clientY <= area.bottom;
            if (!onTable && !active.tracker.isFlick(time)) {
                returnDrag(drag);
                return;
            }
            const motion = OCG.gestures.throwMotion(active.tracker, { x: event.clientX, y: event.clientY, time },
                area, { pitch: drag.pitch, yaw: drag.yaw });
            let settled = false;
            const handoff = {
                origins: dragOrigins(drag),
                release() { if (!settled) { settled = true; removeDrag(drag); } },
                cancel() { if (!settled) { settled = true; returnDrag(drag); } }
            };
            // If nothing claims the dragged cards (the update never arrives), glide them back.
            setTimeout(() => handoff.cancel(), 4000);
            onPlay(active.cards, motion, handoff);
        }

        function onCancel(event) {
            if (gesture && (event.pointerId == null || gesture.pointerId === event.pointerId)) { end(); }
        }

        function onClick(event) {
            if (suppressClick) {
                suppressClick = false;
                event.stopPropagation();
                event.preventDefault();
            }
        }

        const listeners = [["pointerdown", onDown], ["pointermove", onMove], ["pointerup", onUp],
            ["pointercancel", onCancel], ["lostpointercapture", onCancel], ["click", onClick, true]];
        listeners.forEach(([type, listener, capture]) => hand.addEventListener(type, listener, { capture: Boolean(capture), passive: false }));
        hand.addEventListener("dragstart", event => event.preventDefault());
        return () => {
            end();
            listeners.forEach(([type, listener, capture]) => hand.removeEventListener(type, listener, { capture: Boolean(capture) }));
        };
    }

    // Table animations -------------------------------------------------------------------------------

    function flightFor(target, rect) {
        const flight = target.cloneNode(true);
        flight.removeAttribute("id");
        flight.classList.add("card-flight");
        flight.setAttribute("aria-hidden", "true");
        Object.assign(flight.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        document.body.appendChild(flight);
        return flight;
    }

    function finished(animation) {
        return new Promise(resolve => {
            animation.onfinish = resolve;
            animation.oncancel = resolve;
        });
    }

    // Throws table cards in from where they were played. `origin(cardId)` returns a box to start from
    // (a hand card, a drag preview or the player's seat). The cards lift, arc, touch down at 64% of the
    // flight and slide to rest along the throw. Resolves when every card has landed.
    async function animatePlay(targets, origin, motion = null) {
        if (!canAnimate() || targets.length == 0) { return; }
        const measured = targets.map(target => ({ target, rect: unrotatedRect(target), source: origin(target.dataset.card) }));
        const flights = measured.map(({ target, rect, source }, index) => {
            if (!source || rect.width == 0 || source.width == 0) { return null; }
            const startLeft = source.left + (source.width - rect.width) / 2;
            const startTop = source.top + (source.height - rect.height) / 2;
            const dx = rect.left - startLeft;
            const dy = rect.top - startTop;
            const distance = Math.hypot(dx, dy) || 1;
            const power = motion ? motion.power : 0.55;
            const slide = Math.min(distance * 0.13 * (0.6 + power), rect.height * 0.45);
            const slideX = dx / distance * slide;
            const slideY = dy / distance * slide;
            const restRotation = parseFloat(target.style.getPropertyValue("--rot")) || 0;
            const spin = motion ? motion.spin : (Math.random() - 0.5) * 24;
            const startRotation = motion ? 0 : (Math.random() - 0.5) * 30;
            const pitch = source.pitch ?? (motion ? motion.pitch : 0);
            const yaw = source.yaw ?? (motion ? motion.yaw : 0);
            const startScale = source.width / rect.width;
            const pose = (x, y, rotation, scale, tiltX = 0, tiltY = 0) =>
                `translate(${x}px, ${y}px) perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${rotation}deg) scale(${scale})`;
            const contactRotation = restRotation - spin * 0.3;
            const flight = flightFor(target, { left: startLeft, top: startTop, width: rect.width, height: rect.height });
            target.classList.add("is-landing");
            const animation = flight.animate([
                { offset: 0, transform: pose(0, 0, startRotation, startScale, pitch, yaw), easing: "cubic-bezier(.25,.6,.35,1)" },
                { offset: 0.34, transform: pose((dx - slideX) * 0.5, (dy - slideY) * 0.5 - rect.height * 0.08,
                    startRotation + (contactRotation - startRotation) * 0.55, 1.1 + 0.06 * power, pitch * 0.4, yaw * 0.4),
                    easing: "cubic-bezier(.45,.05,.7,.6)" },
                { offset: 0.64, transform: pose(dx - slideX, dy - slideY, contactRotation, 1), easing: "cubic-bezier(.15,.75,.3,1)" },
                { offset: 1, transform: pose(dx, dy, restRotation, 1) }
            ], { duration: durations.play, delay: index * durations.stagger, fill: "both" });
            return finished(animation).then(() => {
                flight.remove();
                target.classList.remove("is-landing");
            });
        });
        await Promise.all(flights);
    }

    // Lifts a finished trick off the table, spinning and fading. `cards` are { element, rect } snapshots
    // taken before the table was re-rendered.
    async function animateClear(cards) {
        if (!canAnimate() || cards.length == 0) { return; }
        await Promise.all(cards.map(({ element, rect }, index) => {
            if (rect.width == 0) { return null; }
            const rotation = parseFloat(element.style.getPropertyValue("--rot")) || 0;
            const flight = flightFor(element, rect);
            const sideways = ((index % 7) - 3) * 35 + (Math.random() - 0.5) * 24;
            const spin = (index % 2 == 0 ? -1 : 1) * (35 + (index % 5) * 12) + (Math.random() - 0.5) * 50;
            const animation = flight.animate([
                { transform: `rotate(${rotation}deg)`, opacity: 1 },
                { transform: `translate(${sideways}px, ${-Math.max(150, innerHeight * 0.4)}px) rotate(${rotation + spin}deg)`, opacity: 0 }
            ], { duration: durations.clear, delay: index * durations.clearStagger, easing: "cubic-bezier(.45,0,.8,.4)", fill: "forwards" });
            return finished(animation).then(() => flight.remove());
        }));
    }

    // Deals the hand's cards from `from` (usually the table centre) into place, one after another.
    async function animateDeal(cards, from) {
        if (!canAnimate() || cards.length == 0 || !from) { return; }
        await Promise.all(cards.map((card, index) => {
            const rect = unrotatedRect(card);
            const dx = from.left + from.width / 2 - (rect.left + rect.width / 2);
            const dy = from.top + from.height / 2 - (rect.top + rect.height / 2);
            const animation = card.animate([
                { transform: `translate(${dx}px, ${dy}px) rotate(${(index % 2 ? 1 : -1) * 12}deg) scale(.85)`, opacity: 0 },
                { transform: "none", opacity: 1 }
            ], { duration: durations.deal, delay: index * durations.dealStagger, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" });
            return finished(animation);
        }));
    }

    OCG.cardMotion = { durations, reducedMotion, unrotatedRect, cardRects, jitter, attachHand, animatePlay, animateClear, animateDeal };
})(globalThis.OCG ??= {});
