// Loading, from disk or programmatically. Two independent halves:
//   • Sprite data - frames, sequences, settings, collision
//   • Image       - the pixel atlas
//
// Each can be loaded, replaced, or absent independently, so the editor
// supports sprite-only and image-only states.

/* ==========================================================================
 *  File pickers
 * ========================================================================== */

// Single-file picker. Prefers the File System Access API when available
// (Chromium), because it gives the caller a real File object even after
// the picker closes. Falls back to a hidden <input type="file"> elsewhere.
//
// Cancellation: on the FSA path, the picker rejects with AbortError and we
// return null cleanly. On the <input> fallback, no cancel event fires
// across browsers, so the returned promise stays pending until the user
// picks something or navigates away. Callers should treat a hanging
// promise as "still waiting" rather than "cancelled".
export async function pickFile({ description, accept, extensions }) {
	if (typeof window.showOpenFilePicker === 'function') {
		try {
			const [handle] = await window.showOpenFilePicker({
				types: [{ description, accept: { [accept]: extensions } }],
				multiple: false,
			});
			return await handle.getFile();
		} catch (err) {
			if (err.name === 'AbortError') return null;
			// Some Chromium variants (Brave with shields, embedded
			// webviews) reject for reasons other than user cancel. Fall
			// through to the input path rather than propagating.
		}
	}
	return inputPickOne(extensions.join(','));
}

function inputPickOne(accept) {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.style.display = 'none';
		input.addEventListener('change', () => {
			document.body.removeChild(input);
			resolve(input.files && input.files[0] ? input.files[0] : null);
		});
		document.body.appendChild(input);
		input.click();
	});
}

/* ==========================================================================
 *  Sprite data
 * ========================================================================== */

// Load a sprite JSON from disk. Returns:
//   { json, jsonFilename, imageFilename } - parsed JSON and the filenames
// `imageFilename` is the basename of the JSON's own "image" field, or null
// if the field is absent. The caller decides whether to also load an image.
export async function loadSpriteFile() {
	const file = await pickFile({
		description: 'Sprite sheet JSON',
		accept: 'application/json',
		extensions: ['.json'],
	});
	if (!file) return null;

	let json;
	try {
		json = JSON.parse(await file.text());
	} catch (err) {
		throw new Error(`Invalid JSON in ${file.name}: ${err.message}`);
	}

	return {
		json,
		jsonFilename: file.name,
		imageFilename: (json.image || '').split('/').pop() || null,
	};
}

// Build a SpriteSheet from raw sprite JSON. If no image is supplied, uses
// a blank canvas sized from the frames themselves, so the frame rectangles
// land where they would against the real image.
//
// The spread of `json` is deliberate: an explicit `image` value overrides
// whatever the JSON specified, so the caller can supply a pre-loaded image
// (a canvas, an HTMLImageElement, or an ImageBitmap) without the runtime
// trying to fetch a URL.
export async function sheetFromSpriteJSON(json, imageSource = null) {
	const image = imageSource || placeholderCanvasFor(json);
	const sheet = await window.SpriteSheet.fromJSON({ ...json, image });
	return sheet;
}

// Compute the tightest canvas that contains every frame, so the placeholder
// matches what the eventual real image will look like. Handles both the
// grid form (col/row) and pixel-offset aliases (x/y, xoffset/yoffset).
function placeholderCanvasFor(json) {
	const fw = Number(json.frameWidth)  || 16;
	const fh = Number(json.frameHeight) || 16;
	let maxX = fw;
	let maxY = fh;

	const frames = json.frames || {};
	for (const name of Object.keys(frames)) {
		const data = frames[name] || {};

		let fx = 0;
		let fy = 0;
		if (data.col !== undefined) fx += Number(data.col) * fw;
		if (data.row !== undefined) fy += Number(data.row) * fh;

		// JSON authors use one of the pixel-offset aliases or the other,
		// not both. First match wins.
		const xAlias = data.x !== undefined      ? data.x
		             : data.left !== undefined   ? data.left
		             : data.xoffset;
		const yAlias = data.y !== undefined      ? data.y
		             : data.top !== undefined    ? data.top
		             : data.yoffset;
		if (xAlias !== undefined) fx += Number(xAlias);
		if (yAlias !== undefined) fy += Number(yAlias);

		const w = Number(data.width)  || fw;
		const h = Number(data.height) || fh;

		if (fx + w > maxX) maxX = fx + w;
		if (fy + h > maxY) maxY = fy + h;
	}

	const c = document.createElement('canvas');
	c.width  = Math.max(1, maxX);
	c.height = Math.max(1, maxY);
	c.getContext('2d', { willReadFrequently: true });
	return c;
}

// Swap the sheet's image for an editable canvas. Pixel editing tools need
// a real 2D context, which an HTMLImageElement doesn't provide.
//
// Idempotent for images that are already canvases: in that case the copy
// is skipped and the input is returned as-is.
export function makeEditable(sheet) {
	if (sheet.image && typeof sheet.image.getContext === 'function') {
		return sheet;
	}

	const canvas = document.createElement('canvas');
	canvas.width  = sheet.imageWidth;
	canvas.height = sheet.imageHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(sheet.image, 0, 0);
	sheet.image = canvas;
	return sheet;
}

/* ==========================================================================
 *  Image
 * ========================================================================== */

// Load an image file from disk, returned as an offscreen canvas ready for
// pixel editing.
export async function loadImageFile() {
	const file = await pickFile({
		description: 'Sheet image',
		accept: 'image/*',
		extensions: ['.png', '.gif', '.jpg', '.jpeg', '.webp'],
	});
	if (!file) return null;

	const img = await loadImageFromFile(file);

	const canvas = document.createElement('canvas');
	canvas.width  = img.naturalWidth || img.width;
	canvas.height = img.naturalHeight || img.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(img, 0, 0);

	return { canvas, imageFilename: file.name };
}

async function loadImageFromFile(file) {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		if (typeof img.decode === 'function') {
			await img.decode();
		} else {
			await new Promise((resolve, reject) => {
				img.onload  = resolve;
				img.onerror = () => reject(new Error(`Failed to load ${file.name}`));
			});
		}
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/* ==========================================================================
 *  Blank / minimal sheets
 * ========================================================================== */

export async function makeBlankSheet({
	imageWidth,
	imageHeight,
	frameWidth,
	frameHeight,
	centerx = 0,
	centery = 0,
	defaultFrameRate = 12,
	cellCount = 1,
}) {
	const canvas = document.createElement('canvas');
	canvas.width  = imageWidth;
	canvas.height = imageHeight;
	// Force the CPU-backed pixel store, which later getImageData calls
	// depend on. We don't draw anything yet - the canvas is transparent.
	canvas.getContext('2d', { willReadFrequently: true });

	const cols = Math.max(1, Math.floor(imageWidth  / frameWidth));
	const rows = Math.max(1, Math.floor(imageHeight / frameHeight));
	const maxFrames = cols * rows;
	const n = Math.max(1, Math.min(cellCount, maxFrames));

	const frames = {};
	for (let i = 0; i < n; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		frames[`frame_${i + 1}`] = { col, row };
	}

	const sheet = await window.SpriteSheet.fromJSON({
		image: canvas,
		frameWidth, frameHeight,
		centerx, centery,
		frameRate: defaultFrameRate,
		frames,
		sequences: {},
	});
	return sheet;
}

// Wrap a bare canvas in a minimal sheet with default frame settings and no
// frames. Used when the user loads an image without a sprite.
export async function makeSheetFromImage(canvas) {
	const sheet = await window.SpriteSheet.fromJSON({
		image: canvas,
		frameWidth: 16,
		frameHeight: 16,
		frames: {},
		sequences: {},
	});
	return sheet;
}
