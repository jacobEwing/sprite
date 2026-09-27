import { makeEmitter } from '../lib/emitter.js';
import { PaintCommand } from '../history/PaintCommand.js';
import {
	AddFrameCommand, RemoveFrameCommand, RenameFrameCommand, SetFrameCommand,
	AddSequenceCommand, RemoveSequenceCommand, RenameSequenceCommand, SetSequenceCommand,
	ResizeCanvasCommand, SetSheetSettingsCommand, SetCollisionCommand,
	CompositeCommand, ReshapeCommand,
} from './sheetCommands.js';

// A facade over SpriteSheet that mediates all structural mutations through
// the command layer. Every mutation:
//   1. builds a command
//   2. executes it through history (which applies it)
//   3. emits 'changed' with a payload describing what happened
//
// Views call these methods and subscribe to 'changed'. They never touch
// history or the raw sheet data directly.
//
// 'changed' payloads:
//   { type: 'frameAdded',    name }
//   { type: 'frameRemoved',  name }
//   { type: 'frameRenamed',  from, to }
//   { type: 'frameUpdated',  name }         — rect/origin changed
//   { type: 'sequenceAdded',   name }
//   { type: 'sequenceRemoved', name }
//   { type: 'sequenceRenamed', from, to }
//   { type: 'sequenceUpdated', name }       — frames list or properties
export class EditableSheet {
	constructor(sheet, history) {
		makeEmitter(this);
		this.sheet = sheet;
		this.history = history;
	}

	get frames()    { return this.sheet.frames; }
	get sequences() { return this.sheet.sequences; }

	// --- naming -----------------------------------------------------------

	// Given a base name, return a unique variant: "name", "name_2", "name_3".
	uniqueFrameName(base) {
		if (!this.sheet.frames[base]) return base;
		let n = 2;
		while (this.sheet.frames[`${base}_${n}`]) n++;
		return `${base}_${n}`;
	}
	uniqueSequenceName(base) {
		if (!this.sheet.sequences[base]) return base;
		let n = 2;
		while (this.sheet.sequences[`${base}_${n}`]) n++;
		return `${base}_${n}`;
	}

	// --- frames -----------------------------------------------------------

	duplicateFrame(sourceName, newName) {
		const src = this.sheet.frames[sourceName];
		if (!src) throw new Error(`No such frame: ${sourceName}`);
		const name = this.uniqueFrameName(newName || sourceName);

		// Scan the sheet in row-major order for the first grid-aligned
		// slot that doesn't overlap an existing frame. Falls back to the
		// source's own position if the sheet is genuinely full.
		const slot = this._findFreeSlot(src.width, src.height);
		const x = slot ? slot.x : src.x;
		const y = slot ? slot.y : src.y;

		const frame = { ...src, x, y };
		this.history.execute(new AddFrameCommand(this.sheet, name, frame), 'data');
		this.emit('changed', { type: 'frameAdded', name });
		return name;
	}

	// Create a blank frame at the next free grid slot, using sheet defaults.
	// Unlike duplicateFrame, no pixels or per-frame overrides are copied.
	createFrame(baseName = 'frame') {
		const sheet = this.sheet;
		const fw = sheet.frameWidth  || 16;
		const fh = sheet.frameHeight || 16;
		const slot = this._findFreeSlot(fw, fh);
		if (!slot) throw new Error('No free space in the sheet for a new frame.');

		const name = this.uniqueFrameName(baseName);
		const frame = {
			x: slot.x,
			y: slot.y,
			width: fw,
			height: fh,
			centerx: sheet.centerx,
			centery: sheet.centery,
			drawOffset: { x: 0, y: 0 },
			// No collision key: the frame inherits the sheet's default shape.
		};

		this.history.execute(new AddFrameCommand(sheet, name, frame), 'data');
		this.emit('changed', { type: 'frameAdded', name });
		return name;
	}

	// Walks a grid of frame-sized cells across the sheet and returns the
	// first one that doesn't intersect an existing frame. Returns null if
	// there's no free space.
	_findFreeSlot(w, h) {
		const sheet = this.sheet;
		const cols = Math.max(1, Math.floor(sheet.imageWidth  / w));
		const rows = Math.max(1, Math.floor(sheet.imageHeight / h));
		const frames = Object.values(sheet.frames);

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const x = col * w;
				const y = row * h;
				if (this._regionIsFree(x, y, w, h, frames)) return { x, y };
			}
		}
		return null;
	}

	_regionIsFree(x, y, w, h, frames) {
		for (const f of frames) {
			if (x < f.x + f.width  && x + w > f.x &&
			    y < f.y + f.height && y + h > f.y) {
				return false;
			}
		}
		return true;
	}

	removeFrame(name) {
		if (!this.sheet.frames[name]) return;
		this.history.execute(new RemoveFrameCommand(this.sheet, name), 'data');
		this.emit('changed', { type: 'frameRemoved', name });
	}

	renameFrame(oldName, newName) {
		if (oldName === newName) return;
		if (!this.sheet.frames[oldName]) throw new Error(`No such frame: ${oldName}`);
		if (this.sheet.frames[newName]) throw new Error(`Frame already exists: ${newName}`);
		this.history.execute(new RenameFrameCommand(this.sheet, oldName, newName), 'data');
		this.emit('changed', { type: 'frameRenamed', from: oldName, to: newName });
	}

	// patch: { x, y, width, height, centerx, centery } — scalars only.
	setFrame(name, patch) {
		const current = this.sheet.frames[name];
		if (!current) return;
		const before = { ...current };
		const after  = { ...current };
		for (const key of ['x', 'y', 'width', 'height', 'centerx', 'centery']) {
			if (patch[key] !== undefined) after[key] = Number(patch[key]);
		}
		if (JSON.stringify(before) === JSON.stringify(after)) return;
		this.history.execute(new SetFrameCommand(this.sheet, name, before, after), 'data');
		this.emit('changed', { type: 'frameUpdated', name });
	}

	// --- sequences --------------------------------------------------------

	addSequence(name, sequence) {
		if (this.sheet.sequences[name]) throw new Error(`Sequence already exists: ${name}`);
		const seq = {
			name,
			frames: [],
			frameRate: this.sheet.defaultFrameRate,
			iterations: 0,
			method: 'auto',
			...sequence,
		};
		this.history.execute(new AddSequenceCommand(this.sheet, name, seq), 'data');
		this.emit('changed', { type: 'sequenceAdded', name });
		return name;
	}

	removeSequence(name) {
		if (!this.sheet.sequences[name]) return;
		this.history.execute(new RemoveSequenceCommand(this.sheet, name), 'data');
		this.emit('changed', { type: 'sequenceRemoved', name });
	}

	renameSequence(oldName, newName) {
		if (oldName === newName) return;
		if (!this.sheet.sequences[oldName]) throw new Error(`No such sequence: ${oldName}`);
		if (this.sheet.sequences[newName]) throw new Error(`Sequence already exists: ${newName}`);
		this.history.execute(new RenameSequenceCommand(this.sheet, oldName, newName), 'data');
		this.emit('changed', { type: 'sequenceRenamed', from: oldName, to: newName });
	}

	// patch: any subset of { frames, frameRate, iterations, method, frameTimes }.
	setSequence(name, patch) {
		const current = this.sheet.sequences[name];
		if (!current) return;
		const before = { ...current, frames: current.frames.slice() };
		const after  = { ...current, frames: current.frames.slice() };
		if (patch.frames)          after.frames      = patch.frames.slice();
		if (patch.frameRate  !== undefined) after.frameRate  = Number(patch.frameRate);
		if (patch.iterations !== undefined) after.iterations = Number(patch.iterations);
		if (patch.method     !== undefined) after.method     = String(patch.method);
		if (patch.frameTimes !== undefined) after.frameTimes = patch.frameTimes.slice();
		if (JSON.stringify(before) === JSON.stringify(after)) return;
		this.history.execute(new SetSequenceCommand(this.sheet, name, before, after), 'data');
		this.emit('changed', { type: 'sequenceUpdated', name });
	}

	// Sequence frames-list helpers, thin wrappers around setSequence.
	addFrameToSequence(seqName, frameName, index = -1) {
		const seq = this.sheet.sequences[seqName];
		if (!seq) return;
		if (!this.sheet.frames[frameName]) return;
		const frames = seq.frames.slice();
		if (index < 0 || index >= frames.length) frames.push(frameName);
		else frames.splice(index, 0, frameName);
		this.setSequence(seqName, { frames });
	}

	removeFrameFromSequence(seqName, index) {
		const seq = this.sheet.sequences[seqName];
		if (!seq) return;
		if (index < 0 || index >= seq.frames.length) return;
		const frames = seq.frames.slice();
		frames.splice(index, 1);
		this.setSequence(seqName, { frames });
	}

	moveSequenceFrame(seqName, from, to) {
		const seq = this.sheet.sequences[seqName];
		if (!seq) return;
		const n = seq.frames.length;
		if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
		const frames = seq.frames.slice();
		const [item] = frames.splice(from, 1);
		frames.splice(to, 0, item);
		this.setSequence(seqName, { frames });
	}

	// --- canvas -----------------------------------------------------------

	// Grow or shrink the canvas. Existing content stays anchored at the
	// top-left; expanding adds blank space on the right/bottom, shrinking
	// drops the right/bottom. Frame data is not touched, even when a frame
	// now sits outside the new bounds.
	resizeCanvas(newWidth, newHeight) {
		newWidth  = Math.max(1, Number(newWidth)  | 0);
		newHeight = Math.max(1, Number(newHeight) | 0);
		if (newWidth === this.sheet.imageWidth && newHeight === this.sheet.imageHeight) {
			return;
		}
		this.history.execute(
			new ResizeCanvasCommand(this.sheet, newWidth, newHeight),
			'pixels'
		);
		this.emit('changed', { type: 'canvasResized', width: newWidth, height: newHeight });
	}

	// --- settings ---------------------------------------------------------

	// Updates the sheet's default frame size, origin, and default frame
	// rate. All of these are values consulted only when new frames and
	// sequences are added; changing them never alters existing data.
	setSheetSettings(patch) {
		const numericFields = [
			'frameWidth', 'frameHeight', 'centerx', 'centery', 'defaultFrameRate',
		];
		const before = {};
		const after  = {};
		let settingsChanged = false;

		for (const k of numericFields) {
			before[k] = this.sheet[k];
			after[k]  = patch[k] !== undefined ? Number(patch[k]) : this.sheet[k];
			if (before[k] !== after[k]) settingsChanged = true;
		}

		if (patch.imageSrc !== undefined) {
			before.imageSrc = this.sheet.imageSrc;
			after.imageSrc  = String(patch.imageSrc);
			if (before.imageSrc !== after.imageSrc) settingsChanged = true;
		}

		const commands = [];

		if (settingsChanged) {
			commands.push(new SetSheetSettingsCommand(this.sheet, before, after));
		}

		const wantW = patch.imageWidth  !== undefined
			? Math.max(1, Number(patch.imageWidth)  | 0)
			: this.sheet.imageWidth;
		const wantH = patch.imageHeight !== undefined
			? Math.max(1, Number(patch.imageHeight) | 0)
			: this.sheet.imageHeight;
		const resizeChanged =
			wantW !== this.sheet.imageWidth || wantH !== this.sheet.imageHeight;
		if (resizeChanged) {
			commands.push(new ResizeCanvasCommand(this.sheet, wantW, wantH));
		}

		if (commands.length === 0) return;

		// One command if only one side changed; a composite when both did,
		// so a single Ctrl+Z reverses the whole dialog interaction.
		const cmd = commands.length === 1 ? commands[0] : new CompositeCommand(commands);
		const kind = settingsChanged && resizeChanged ? 'both'
			: resizeChanged ? 'pixels'
			: 'data';
		this.history.execute(cmd, kind);
		this.emit('changed', {
			type: 'settingsUpdated',
			resized: resizeChanged,
		});
	}

	// --- collision --------------------------------------------------------

	// Replace the whole collision shape. Passing null clears it.
	setCollision(newCollision) {
		const before = this.sheet.collision;
		const after  = newCollision;
		if (_deepEqual(before, after)) return;
		this.history.execute(new SetCollisionCommand(this.sheet, before, after), 'data');
		this.emit('changed', { type: 'collisionUpdated' });
	}

	addCollisionCircle(circle) {
		const current = this.sheet.collision || { circles: [] };
		const next = {
			circles: [
				...current.circles.map(c => ({ ...c })),
				{
					offsetX: Number(circle.offsetX) || 0,
					offsetY: Number(circle.offsetY) || 0,
					radius:  Math.max(1, Number(circle.radius) || 1),
				},
			],
		};
		this.setCollision(next);
	}

	removeCollisionCircle(index) {
		if (!this.sheet.collision || !this.sheet.collision.circles[index]) return;
		const next = this.sheet.collision.circles
			.filter((_, i) => i !== index)
			.map(c => ({ ...c }));
		this.setCollision(next.length ? { circles: next } : null);
	}

	updateCollisionCircle(index, patch) {
		if (!this.sheet.collision || !this.sheet.collision.circles[index]) return;
		const next = this.sheet.collision.circles.map((c, i) => {
			if (i !== index) return { ...c };
			return {
				offsetX: patch.offsetX !== undefined ? Number(patch.offsetX) : c.offsetX,
				offsetY: patch.offsetY !== undefined ? Number(patch.offsetY) : c.offsetY,
				radius:  patch.radius  !== undefined ? Math.max(1, Number(patch.radius)) : c.radius,
			};
		});
		this.setCollision({ circles: next });
	}
	// --- frame content ----------------------------------------------------

	// Clear a specific region to transparent. `rect` is in image coords.
	clearRegion(rect) {
		if (!rect || rect.w <= 0 || rect.h <= 0) return;
		const ctx = this.sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

		let anyOpaque = false;
		for (let i = 3; i < before.data.length; i += 4) {
			if (before.data[i] !== 0) { anyOpaque = true; break; }
		}
		if (!anyOpaque) return;

		ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
		const after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

		const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
		this.history.push(cmd, 'pixels');
		this.emit('changed', { type: 'regionUpdated' });
	}

	clearFrameContent(frameName) {
		const frame = this.sheet.frames[frameName];
		if (!frame) return;
		this.clearRegion({ x: frame.x, y: frame.y, w: frame.width, h: frame.height });
	}

	// Composite `imageData` into `rect`. Align may be 'center' (default)
	// or 'topleft'. Pixels outside `rect` are dropped.
	pasteIntoRegion(rect, imageData, { align = 'center' } = {}) {
		if (!imageData || !rect || rect.w <= 0 || rect.h <= 0) return;

		const ctx = this.sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const working = new ImageData(
			new Uint8ClampedArray(before.data),
			before.width,
			before.height
		);

		let ox, oy;
		if (align === 'topleft') {
			ox = 0;
			oy = 0;
		} else {
			ox = Math.floor((rect.w - imageData.width)  / 2);
			oy = Math.floor((rect.h - imageData.height) / 2);
		}

		const sd = imageData.data;
		const wd = working.data;

		for (let y = 0; y < imageData.height; y++) {
			const ty = y + oy;
			if (ty < 0 || ty >= rect.h) continue;
			for (let x = 0; x < imageData.width; x++) {
				const tx = x + ox;
				if (tx < 0 || tx >= rect.w) continue;

				const si = (y * imageData.width + x) * 4;
				const ti = (ty * rect.w + tx) * 4;
				const sa = sd[si + 3] / 255;
				if (sa === 0) continue;

				if (sa === 1) {
					wd[ti]     = sd[si];
					wd[ti + 1] = sd[si + 1];
					wd[ti + 2] = sd[si + 2];
					wd[ti + 3] = 255;
				} else {
					const da = wd[ti + 3] / 255;
					const outA = sa + da * (1 - sa);
					if (outA > 0) {
						wd[ti]     = Math.round((sd[si]     * sa + wd[ti]     * da * (1 - sa)) / outA);
						wd[ti + 1] = Math.round((sd[si + 1] * sa + wd[ti + 1] * da * (1 - sa)) / outA);
						wd[ti + 2] = Math.round((sd[si + 2] * sa + wd[ti + 2] * da * (1 - sa)) / outA);
						wd[ti + 3] = Math.round(outA * 255);
					}
				}
			}
		}

		ctx.putImageData(working, rect.x, rect.y);
		const after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

		const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
		this.history.push(cmd, 'pixels');
		this.emit('changed', { type: 'regionUpdated' });
	}

	// Apply a pure transform to a region's pixels. `fn` takes an ImageData
	// and returns a new ImageData of the same dimensions.
	transformRegion(rect, fn) {
		if (!rect || rect.w <= 0 || rect.h <= 0) return;

		const ctx = this.sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const after = fn(before);
		if (!after) return;

		ctx.putImageData(after, rect.x, rect.y);

		const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
		this.history.push(cmd, 'pixels');
		this.emit('changed', { type: 'regionUpdated' });
	}

	pasteIntoFrame(frameName, imageData) {
		const frame = this.sheet.frames[frameName];
		if (!frame) return;
		this.pasteIntoRegion(
			{ x: frame.x, y: frame.y, w: frame.width, h: frame.height },
			imageData,
			{ align: 'center' }
		);
	}

	// --- frame collision --------------------------------------------------

	// Set or clear a frame's collision override.
	//   value === undefined  → delete the key (frame inherits sheet-level)
	//   value === null       → explicit none ({ circles: [] })
	//   value = { circles }  → override with those circles
	setFrameCollision(frameName, value) {
		const current = this.sheet.frames[frameName];
		if (!current) return;

		const before = { ...current };
		const after  = { ...current };

		if (value === undefined) {
			delete after.collision;
		} else if (value === null) {
			after.collision = { circles: [] };
		} else {
			after.collision = JSON.parse(JSON.stringify(value));
		}

		if (_deepEqual(before, after)) return;

		this.history.execute(new SetFrameCommand(this.sheet, frameName, before, after), 'data');
		this.emit('changed', { type: 'frameUpdated', name: frameName });
	}

	// --- reshape ----------------------------------------------------------

	// Repack every frame into a row-major grid with the given column count.
	// Cell size is the sheet's frameWidth/frameHeight; frames larger than
	// that are clipped into their cell.
	reshapeToGrid(cols) {
		cols = Math.max(1, Number(cols) | 0);
		const names = this.sheet.frameNames;
		if (names.length === 0) return;

		const cellW = this.sheet.frameWidth  || 16;
		const cellH = this.sheet.frameHeight || 16;
		const rows  = Math.ceil(names.length / cols);
		const canvasW = cols * cellW;
		const canvasH = rows * cellH;

		const newPositions = {};
		names.forEach((name, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			newPositions[name] = { x: col * cellW, y: row * cellH };
		});

		this.history.execute(
			new ReshapeCommand(this.sheet, newPositions, canvasW, canvasH, cellW, cellH),
			'both'
		);
		this.emit('changed', {
			type: 'reshaped',
			cols, rows,
			width: canvasW, height: canvasH,
		});
	}

	// Frames that would be clipped by a reshape at the current cell size.
	// Used by the dialog to build its warning.
	framesClippedByReshape() {
		const cellW = this.sheet.frameWidth  || 16;
		const cellH = this.sheet.frameHeight || 16;
		const out = [];
		for (const name of this.sheet.frameNames) {
			const f = this.sheet.frames[name];
			if (f.width > cellW || f.height > cellH) out.push(name);
		}
		return out;
	}
}

function _deepEqual(a, b) {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	const ka = Object.keys(a), kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (const k of ka) {
		if (!_deepEqual(a[k], b[k])) return false;
	}
	return true;
}
