// Rect, ellipse, and flood-fill geometry. Every function calls cb(px, py)
// for pixels that should be painted. Coordinates are image-space integers.
//
// Rect and ellipse take a bounding box. The ellipse is fit to the box:
// odd-sized boxes center on a pixel, even-sized boxes center on the
// half-pixel between the two middle columns/rows.

export function rectOutline(x1, y1, x2, y2, cb) {
	const lx = Math.min(x1, x2), rx = Math.max(x1, x2);
	const ty = Math.min(y1, y2), by = Math.max(y1, y2);

	for (let x = lx; x <= rx; x++) {
		cb(x, ty);
		cb(x, by);
	}
	for (let y = ty + 1; y <= by - 1; y++) {
		cb(lx, y);
		cb(rx, y);
	}
}

export function rectFilled(x1, y1, x2, y2, cb) {
	const lx = Math.min(x1, x2), rx = Math.max(x1, x2);
	const ty = Math.min(y1, y2), by = Math.max(y1, y2);

	for (let y = ty; y <= by; y++) {
		for (let x = lx; x <= rx; x++) cb(x, y);
	}
}

// Is (px, py) inside the ellipse defined by the bounding box?
// Uses pixel centers, so the check is deterministic and symmetric.
function ellipseContains(px, py, cx, cy, rx, ry) {
	if (rx <= 0 || ry <= 0) {
		return Math.round(px) === Math.round(cx) && Math.round(py) === Math.round(cy);
	}
	const dx = (px - cx) / rx;
	const dy = (py - cy) / ry;
	return dx * dx + dy * dy <= 1;
}

function ellipseBounds(x1, y1, x2, y2) {
	const lx = Math.min(x1, x2), rx = Math.max(x1, x2);
	const ty = Math.min(y1, y2), by = Math.max(y1, y2);
	const cx = (lx + rx) / 2;
	const cy = (ty + by) / 2;
	const rxr = (rx - lx) / 2 + 0.5;
	const ryr = (by - ty) / 2 + 0.5;
	return { lx, ty, rx, by, cx, cy, rxr, ryr };
}

export function ellipseFilled(x1, y1, x2, y2, cb) {
	const b = ellipseBounds(x1, y1, x2, y2);
	for (let y = b.ty; y <= b.by; y++) {
		for (let x = b.lx; x <= b.rx; x++) {
			if (ellipseContains(x, y, b.cx, b.cy, b.rxr, b.ryr)) cb(x, y);
		}
	}
}

export function ellipseOutline(x1, y1, x2, y2, cb) {
	const b = ellipseBounds(x1, y1, x2, y2);
	for (let y = b.ty; y <= b.by; y++) {
		for (let x = b.lx; x <= b.rx; x++) {
			if (!ellipseContains(x, y, b.cx, b.cy, b.rxr, b.ryr)) continue;
			// Outline = inside, but at least one 4-neighbor is outside.
			if (!ellipseContains(x - 1, y, b.cx, b.cy, b.rxr, b.ryr) ||
			    !ellipseContains(x + 1, y, b.cx, b.cy, b.rxr, b.ryr) ||
			    !ellipseContains(x, y - 1, b.cx, b.cy, b.rxr, b.ryr) ||
			    !ellipseContains(x, y + 1, b.cx, b.cy, b.rxr, b.ryr)) {
				cb(x, y);
			}
		}
	}
}

// Span-based scanline flood fill. Fills the contiguous region of `target`
// pixels surrounding (startX, startY) with `replacement`. Writes through the
// transaction, so the clip rect is respected automatically.
//
// `matches(px, py)` should return true if that pixel equals the target.
export function floodFill(transaction, startX, startY, target, replacement, matches) {
	const r = transaction.rect;
	const x0 = r.x, y0 = r.y;
	const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;

	if (startX < x0 || startX > x1 || startY < y0 || startY > y1) return;

	const stack = [[startX, startY]];

	while (stack.length) {
		const [seedX, seedY] = stack.pop();
		if (!matches(seedX, seedY)) continue;

		// Find the left edge of this run.
		let lx = seedX;
		while (lx > x0 && matches(lx - 1, seedY)) lx--;

		// Find the right edge.
		let rx = seedX;
		while (rx < x1 && matches(rx + 1, seedY)) rx++;

		// Fill the span, and push one seed per contiguous run above/below.
		let spanAbove = false;
		let spanBelow = false;
		for (let px = lx; px <= rx; px++) {
			transaction.setPixel(px, seedY, replacement);

			if (seedY > y0) {
				const above = matches(px, seedY - 1);
				if (above && !spanAbove) { stack.push([px, seedY - 1]); spanAbove = true; }
				else if (!above) spanAbove = false;
			}
			if (seedY < y1) {
				const below = matches(px, seedY + 1);
				if (below && !spanBelow) { stack.push([px, seedY + 1]); spanBelow = true; }
				else if (!below) spanBelow = false;
			}
		}
	}
}
