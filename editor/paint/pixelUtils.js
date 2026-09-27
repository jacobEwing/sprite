// Convert "#rrggbb" or "#rgb" to [r, g, b, a=255]. Returns null on bad input.
export function hexToRGBA(hex, alpha = 255) {
	if (typeof hex !== 'string') return null;
	let h = hex.trim();
	if (h[0] === '#') h = h.slice(1);
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	if (h.length !== 6) return null;
	const n = parseInt(h, 16);
	if (Number.isNaN(n)) return null;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function rgbaToHex(r, g, b) {
	const c = (v) => v.toString(16).padStart(2, '0');
	return '#' + c(r) + c(g) + c(b);
}

// Bresenham line. Calls cb(x, y) for each integer point from (x0,y0) to
// (x1,y1) inclusive. Used by the pencil to fill gaps between pointermove
// samples during fast drags.
export function linePoints(x0, y0, x1, y1, cb) {
	x0 = Math.floor(x0); y0 = Math.floor(y0);
	x1 = Math.floor(x1); y1 = Math.floor(y1);

	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;

	for (;;) {
		cb(x0, y0);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) { err += dy; x0 += sx; }
		if (e2 <= dx) { err += dx; y0 += sy; }
	}
}

// Normalise any reasonable hex form ("fff", "#FFF", "ffffff", "#ffffff")
// to canonical "#rrggbb" lowercase. Returns null on bad input.
export function normalizeHex(hex) {
	if (typeof hex !== 'string') return null;
	let h = hex.trim().toLowerCase();
	if (h[0] === '#') h = h.slice(1);
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	if (!/^[0-9a-f]{6}$/.test(h)) return null;
	return '#' + h;
}

export function isValidHex(hex) {
	return normalizeHex(hex) !== null;
}
