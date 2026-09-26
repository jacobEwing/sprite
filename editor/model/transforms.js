// Pure transforms on ImageData. Each returns a new ImageData of the same
// dimensions as the input, so results always fit the region they target.
//
// Rotations of non-square regions centre the rotated content and clip the
// overflow; for square regions (the common case) the mapping is exact.

function copyPixel(src, sx, sy, dst, dx, dy) {
	const si = (sy * src.width + sx) * 4;
	const di = (dy * dst.width + dx) * 4;
	dst.data[di]     = src.data[si];
	dst.data[di + 1] = src.data[si + 1];
	dst.data[di + 2] = src.data[si + 2];
	dst.data[di + 3] = src.data[si + 3];
}

export function rotate90CW(src) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);

	// Rotated content is h×w; centre it in the w×h destination.
	const offX = Math.floor((w - h) / 2);
	const offY = Math.floor((h - w) / 2);

	for (let sy = 0; sy < h; sy++) {
		for (let sx = 0; sx < w; sx++) {
			const dx = offX + (h - 1 - sy);
			const dy = offY + sx;
			if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
			copyPixel(src, sx, sy, dst, dx, dy);
		}
	}
	return dst;
}

export function rotate90CCW(src) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);

	const offX = Math.floor((w - h) / 2);
	const offY = Math.floor((h - w) / 2);

	for (let sy = 0; sy < h; sy++) {
		for (let sx = 0; sx < w; sx++) {
			const dx = offX + sy;
			const dy = offY + (w - 1 - sx);
			if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
			copyPixel(src, sx, sy, dst, dx, dy);
		}
	}
	return dst;
}

export function flipVertical(src) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			copyPixel(src, x, y, dst, x, h - 1 - y);
		}
	}
	return dst;
}

export function flipHorizontal(src) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			copyPixel(src, x, y, dst, w - 1 - x, y);
		}
	}
	return dst;
}

// Shift content by (dx, dy), wrapping around the region's bounds. Positive
// dx moves content right; positive dy moves content down.
export function translateWrapped(src, dx, dy) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const sx = ((x - dx) % w + w) % w;
			const sy = ((y - dy) % h + h) % h;
			copyPixel(src, sx, sy, dst, x, y);
		}
	}
	return dst;
}
