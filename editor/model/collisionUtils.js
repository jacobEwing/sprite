// Collision shapes are stored in-memory as { circles: [{offsetX, offsetY, radius}] }.
// The JSON format also allows a single-circle shorthand which the runtime
// normalises on load; this module mirrors that convention and provides the
// reverse.

export function normaliseCollision(raw) {
	if (!raw || typeof raw !== 'object') return null;

	if (raw.radius != null) {
		return {
			circles: [{
				offsetX: Number(raw.offsetX) || 0,
				offsetY: Number(raw.offsetY) || 0,
				radius:  Number(raw.radius),
			}],
		};
	}

	if (Array.isArray(raw.circles)) {
		const out = [];
		for (const c of raw.circles) {
			if (!c || c.radius == null) continue;
			out.push({
				offsetX: Number(c.offsetX) || 0,
				offsetY: Number(c.offsetY) || 0,
				radius:  Number(c.radius),
			});
		}
		return out.length ? { circles: out } : null;
	}

	return null;
}

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
// image-space already (offset applied); used by the collision tool.
export function circleAt(circles, px, py) {
	for (let i = circles.length - 1; i >= 0; i--) {
		const c = circles[i];
		const dx = px - c.x;
		const dy = py - c.y;
		if (dx * dx + dy * dy <= c.radius * c.radius) return i;
	}
	return -1;
}

// --- frame-vs-sheet resolution -------------------------------------------
//
// A frame is in one of three collision modes:
//   'inherit'  — no collision key on the frame; uses sheet.collision
//   'override' — frame has its own circles
//   'none'     — frame has an empty circles array (explicit no collision)

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

// An empty circles array, used for the 'none' state.
export function emptyCollision() {
	return { circles: [] };
}
