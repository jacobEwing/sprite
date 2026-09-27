// Collision data helpers, plus the frame-vs-sheet resolution logic.
//
// The on-disk shape mirrors what sprite.js's parseCollision() accepts: a
// single-circle shorthand { radius, offsetX, offsetY } when there's one
// circle, or { circles: [...] } otherwise. The runtime normalises on load;
// this module provides the reverse for serialisation.
//
// A frame's collision is one of three states:
//   'inherit'  — no collision key on the frame; uses sheet.collision
//   'override' — frame has its own circles
//   'none'     — frame has an empty circles array (explicit no collision)

// Serialise form. Single circles collapse to the shorthand so the JSON
// stays readable, matching how the game's sheets are hand-authored.
export function serialiseCollision(collision) {
	if (!collision || !collision.circles || collision.circles.length === 0) {
		return null;
	}
	if (collision.circles.length === 1) {
		const c = collision.circles[0];
		return { radius: c.radius, offsetX: c.offsetX, offsetY: c.offsetY };
	}
	return {
		circles: collision.circles.map(c => ({
			offsetX: c.offsetX,
			offsetY: c.offsetY,
			radius:  c.radius,
		})),
	};
}

// Topmost circle whose disc contains (px, py), or -1. `circles` are in
// image space already (offsets applied); used by the collision tool for
// hit-testing.
export function circleAt(circles, px, py) {
	for (let i = circles.length - 1; i >= 0; i--) {
		const c = circles[i];
		const dx = px - c.x;
		const dy = py - c.y;
		if (dx * dx + dy * dy <= c.radius * c.radius) return i;
	}
	return -1;
}

export function collisionMode(frame) {
	if (!frame || !Object.prototype.hasOwnProperty.call(frame, 'collision')) {
		return 'inherit';
	}
	const c = frame.collision;
	if (!c || !c.circles || c.circles.length === 0) return 'none';
	return 'override';
}

// Resolved collision for a frame, following the same fallback the runtime
// uses. Returns null when neither source has circles.
export function resolvedCollision(frame, sheetCollision) {
	const mode = collisionMode(frame);
	if (mode === 'inherit') return sheetCollision || null;
	if (mode === 'none')    return null;
	return frame.collision;
}
