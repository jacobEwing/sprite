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

// Translate `src` so that its non-transparent content's bounding box is
// centred within the region. Returns a new ImageData, or the input
// unchanged if there is no content or the content is already centred.
//
// Nearest-pixel integer translation: the same frame size always produces
// the same result, so re-clicking the button is idempotent.
export function centreContent(src) {
	const w = src.width;
	const h = src.height;
	const sd = src.data;

	// Find the content bounding box.
	let minX = w, minY = h, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (sd[(y * w + x) * 4 + 3] === 0) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}

	// No content to centre.
	if (maxX < 0) return src;

	const contentW = maxX - minX + 1;
	const contentH = maxY - minY + 1;
	const contentCX = minX + contentW / 2;
	const contentCY = minY + contentH / 2;

	// Round the shift so the content's centre lands as close as possible
	// to the region's centre.
	const dx = Math.round(w / 2 - contentCX);
	const dy = Math.round(h / 2 - contentCY);
	if (dx === 0 && dy === 0) return src;

	// Non-wrapping shift. Content that would end up outside the region is
	// dropped; in practice this only happens when the content was already
	// larger than the region, which is a user error.
	const dst = new ImageData(w, h);
	const dd = dst.data;
	for (let y = 0; y < h; y++) {
		const sy = y - dy;
		if (sy < 0 || sy >= h) continue;
		for (let x = 0; x < w; x++) {
			const sx = x - dx;
			if (sx < 0 || sx >= w) continue;
			const si = (sy * w + sx) * 4;
			const di = (y * w + x) * 4;
			dd[di]     = sd[si];
			dd[di + 1] = sd[si + 1];
			dd[di + 2] = sd[si + 2];
			dd[di + 3] = sd[si + 3];
		}
	}
	return dst;
}

// Rotate by an arbitrary angle in degrees. Positive values rotate the
// content clockwise, matching rotate90CW. The output has the same
// dimensions as the input; pixels that rotate outside the region are
// clipped, and the corners they leave behind are transparent.
//
// `pivotX` and `pivotY` are in region-relative coordinates (0, 0 = the
// region's top-left corner). Defaults to the region's centre. Values
// outside the region are legal - rotating around a point beyond the edge
// is sometimes what you want, and there's no clipping to enforce.
//
// Nearest-neighbour sampling. Bilinear would introduce colours not present
// in the source - undesirable for pixel art, and rarely what's wanted for
// a small sprite.
export function rotateArbitrary(src, degrees, pivotX = null, pivotY = null) {
	const w = src.width;
	const h = src.height;
	const dst = new ImageData(w, h);

	const rad = (degrees % 360) * Math.PI / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	const px = pivotX === null ? w / 2 : pivotX;
	const py = pivotY === null ? h / 2 : pivotY;

	for (let dy = 0; dy < h; dy++) {
		for (let dx = 0; dx < w; dx++) {
			// Destination pixel centre, relative to the pivot.
			const ox = dx + 0.5 - px;
			const oy = dy + 0.5 - py;

			// Inverse rotation: where in the source did this destination
			// pixel come from?
			const rx =  ox * cos + oy * sin;
			const ry = -ox * sin + oy * cos;

			const sx = Math.floor(px + rx);
			const sy = Math.floor(py + ry);

			if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;

			const si = (sy * w + sx) * 4;
			const di = (dy * w + dx) * 4;
			dst.data[di]     = src.data[si];
			dst.data[di + 1] = src.data[si + 1];
			dst.data[di + 2] = src.data[si + 2];
			dst.data[di + 3] = src.data[si + 3];
		}
	}

	return dst;
}
