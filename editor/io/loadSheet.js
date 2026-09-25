// Loads a sprite sheet and swaps its image for an editable canvas.
//
// The runtime accepts any CanvasImageSource for sheet.image, so from here on
// the sheet's pixels live on our canvas. Edits mutate the canvas in place,
// which means every sprite drawn from the sheet sees the change immediately —
// no reference swapping, no re-creating sprites.
export async function loadSheet(path) {
	const sheet = await window.SpriteSheet.load(path);
	return makeEditable(sheet);
}

// Swap the sheet's image for an offscreen canvas so pixel-editing tools
// have something they can call getContext('2d') and putImageData on. Both
// the URL loader and the disk loader end with this step.
export function makeEditable(sheet) {
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
 *  Disk loading
 *
 *  Chromium only grants a file picker a transient user activation once; a
 *  second picker in the same async flow fails with "File chooser dialog
 *  can only be shown with a user activation." So we ask for both files in
 *  one picker and pair them by looking at the JSON's "image" field.
 * ========================================================================== */

// Multi-file picker. Uses the File System Access API when available,
// falling back to a hidden <input type="file" multiple>.
export async function pickFiles({ description, accept }) {
	if (typeof window.showOpenFilePicker === 'function') {
		try {
			const handles = await window.showOpenFilePicker({
				types: [{ description, accept }],
				multiple: true,
			});
			return await Promise.all(handles.map(h => h.getFile()));
		} catch (err) {
			if (err.name === 'AbortError') return null;
			// Some Chromium variants reject for reasons other than user
			// cancel. Fall through to the input path.
		}
	}
	return _inputPickFiles(accept);
}

function _inputPickFiles(acceptMap) {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		input.accept = Object.values(acceptMap).flat().join(',');
		input.style.display = 'none';
		input.addEventListener('change', () => {
			document.body.removeChild(input);
			resolve(input.files ? Array.from(input.files) : null);
		});
		document.body.appendChild(input);
		input.click();
	});
}

// Single-file picker. Same activation rules as pickFiles: one click, one
// picker, one user gesture.
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
			// Fall through to the input path for other rejection reasons.
		}
	}
	return _inputPickOne(extensions.join(','));
}

function _inputPickOne(accept) {
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

// Load a sheet from a set of user-picked files. The set must contain a JSON
// file and (unless the JSON references an absolute URL or data URI) the
// image it names. Returns { sheet, jsonFilename, imageFilename } or null if
// the user cancels.
export async function loadSheetFromDisk() {
	const files = await pickFiles({
		description: 'Sprite sheet JSON and its image',
		accept: {
			'application/json': ['.json'],
			'image/png':  ['.png'],
			'image/gif':  ['.gif'],
			'image/jpeg': ['.jpg', '.jpeg'],
			'image/webp': ['.webp'],
		},
	});
	if (!files || files.length === 0) return null;

	const jsonFile = files.find(f => /\.json$/i.test(f.name));
	if (!jsonFile) {
		throw new Error('Please select the sheet JSON along with its image.');
	}

	let data;
	try {
		data = JSON.parse(await jsonFile.text());
	} catch (err) {
		throw new Error(`Invalid JSON in ${jsonFile.name}: ${err.message}`);
	}

	const imageRef = data.image;
	if (!imageRef) {
		throw new Error(`Sheet ${jsonFile.name} has no "image" field.`);
	}

	let imageSource;
	let imageFilename;

	if (_isAbsoluteImageRef(imageRef)) {
		imageSource = await _loadImageFromURL(imageRef);
		imageFilename = _basename(imageRef);
	} else {
		const wanted = _basename(imageRef).toLowerCase();
		const imageFile = files.find(f => f.name.toLowerCase() === wanted);
		if (!imageFile) {
			const listed = files.map(f => f.name).join(', ');
			throw new Error(
				`The JSON refers to "${imageRef}", but that file wasn't ` +
				`among the selection (${listed}).`
			);
		}
		imageSource = await _loadImageFromFile(imageFile);
		imageFilename = imageFile.name;
	}

	const sheet = await window.SpriteSheet.fromJSON({ ...data, image: imageSource });
	makeEditable(sheet);
	sheet.imageSrc = imageFilename;

	return { sheet, jsonFilename: jsonFile.name, imageFilename };
}

export function _isAbsoluteImageRef(ref) {
	return /^(data:|https?:\/\/|\/)/i.test(ref);
}

export function _basename(p) {
	return String(p).split('/').pop().split('?')[0];
}

export function _loadImageFromURL(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload  = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
		img.src = src;
	});
}

export async function _loadImageFromFile(file) {
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
 *  Blank sheet creation
 * ========================================================================== */

// Build a fresh SpriteSheet with an empty (transparent) canvas of the
// requested size, and a set of empty frames laid out on the grid.
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
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;

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
		frameWidth,
		frameHeight,
		centerx,
		centery,
		frameRate: defaultFrameRate,
		frames,
		sequences: {},
	});

	// The canvas is already editable; no swap needed.
	return sheet;
}
