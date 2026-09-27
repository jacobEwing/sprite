// Convolution engine. Given an ImageData and a kernel definition, produce a
// new ImageData with the kernel applied.
//
// Kernel:
//   { matrix: number[][], divisor, offset, convolveAlpha }
//
//   matrix        square, odd-sized (3×3, 5×5)
//   divisor       if omitted or 0, treated as 1
//   offset        added to each channel after division
//   convolveAlpha if true, the alpha channel is convolved like the others;
//                 if false, alpha passes through unchanged. Keeping it off
//                 for hard-edged sprites (the default) preserves crisp
//                 transparency through a blur.
//
// Pixels near the source rect's edge are clamped to the nearest in-bounds
// pixel rather than reading beyond it. Sprite frames are treated as isolated
// images; a filter on one frame never reads from a neighbouring frame in the
// atlas.

export function applyConvolution(src, kernel) {
	const size = kernel.matrix.length;
	const half = Math.floor(size / 2);
	const w = src.width;
	const h = src.height;

	const div = kernel.divisor === 0 || kernel.divisor === undefined
		? 1
		: kernel.divisor;
	const offset = kernel.offset ?? 0;
	const convolveAlpha = !!kernel.convolveAlpha;

	const dst = new ImageData(w, h);
	const sd = src.data;
	const dd = dst.data;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let r = 0, g = 0, b = 0, a = 0;

			for (let ky = 0; ky < size; ky++) {
				const row = kernel.matrix[ky];
				for (let kx = 0; kx < size; kx++) {
					const weight = row[kx];
					if (weight === 0) continue;

					let sx = x + kx - half;
					let sy = y + ky - half;

					// 'clamp' to the frame's own bounds. Sprite frames are
					// isolated images; a filter on one frame must not read
					// pixels from a neighbouring frame in the atlas.
					if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
					if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;

					const i = (sy * w + sx) * 4;
					r += sd[i]     * weight;
					g += sd[i + 1] * weight;
					b += sd[i + 2] * weight;
					if (convolveAlpha) a += sd[i + 3] * weight;
				}
			}

			const di = (y * w + x) * 4;
			dd[di]     = clamp255(r / div + offset);
			dd[di + 1] = clamp255(g / div + offset);
			dd[di + 2] = clamp255(b / div + offset);
			dd[di + 3] = convolveAlpha ? clamp255(a / div + offset) : sd[di + 3];
		}
	}

	return dst;
}

function clamp255(v) {
	if (v < 0) return 0;
	if (v > 255) return 255;
	return Math.round(v);
}

// Sum of all values in a matrix. Used as the default divisor when applying
// a preset that doesn't specify one.
export function matrixSum(matrix) {
	let s = 0;
	for (const row of matrix) for (const v of row) s += v;
	return s;
}

// A neutral identity matrix of the given odd size. Multiplies each pixel
// by 1 and everything else by 0, so it has no visual effect. Used when
// the user switches matrix size with no preset to seed it.
export function defaultMatrix(size) {
	const mid = Math.floor(size / 2);
	const m = [];
	for (let y = 0; y < size; y++) {
		const row = [];
		for (let x = 0; x < size; x++) {
			row.push(x === mid && y === mid ? 1 : 0);
		}
		m.push(row);
	}
	return m;
}

// Preset kernels. When `divisor` is omitted, the panel computes it from the
// matrix sum. Presets are copied into the editor when chosen; editing a
// preset's matrix does not modify the preset.
export const PRESETS = [
	{ name: 'Blur (box)',
	  matrix: [[1,1,1],[1,1,1],[1,1,1]] },

	{ name: 'Blur (gaussian)',
	  matrix: [[1,2,1],[2,4,2],[1,2,1]] },

	{ name: 'Sharpen',
	  matrix: [[0,-1,0],[-1,5,-1],[0,-1,0]] },

	{ name: 'Sharpen (strong)',
	  matrix: [[-1,-1,-1],[-1,9,-1],[-1,-1,-1]] },

	{ name: 'Emboss',
	  matrix: [[-2,-1,0],[-1,1,1],[0,1,2]] },

	{ name: 'Edges (Laplacian)',
	  matrix: [[-1,-1,-1],[-1,8,-1],[-1,-1,-1]] },

	{ name: 'Edges (cross)',
	  matrix: [[0,1,0],[1,-4,1],[0,1,0]] },

	{ name: 'Neighbour mix',
	  matrix: [[0,.1,0],[.1,.6,.1],[0,.1,0]],
	  divisor: 1 },

	{ name: 'Blur (gaussian 5×5)',
	  matrix: [
		[ 1,  4,  6,  4, 1],
		[ 4, 16, 24, 16, 4],
		[ 6, 24, 36, 24, 6],
		[ 4, 16, 24, 16, 4],
		[ 1,  4,  6,  4, 1],
	  ] },

	{ name: 'Sharpen (5×5)',
	  matrix: [
		[-1, -1, -1, -1, -1],
		[-1, -1, -1, -1, -1],
		[-1, -1, 25, -1, -1],
		[-1, -1, -1, -1, -1],
		[-1, -1, -1, -1, -1],
	  ] },

	{ name: 'Neighbour mix (5×5)',
	  matrix: [
		[0, 0, .05, 0, 0],
		[0, .1, .1, .1, 0],
		[.05, .1, .2, .1, .05],
		[0, .1, .1, .1, 0],
		[0, 0, .05, 0, 0],
	  ] },
];
