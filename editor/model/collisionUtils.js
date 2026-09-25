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
