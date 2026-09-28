import { makeEmitter } from '../lib/emitter.js';
import { PaintCommand } from '../history/PaintCommand.js';
import {
	AddFrameCommand, RemoveFrameCommand, RenameFrameCommand, SetFrameCommand,
	AddSequenceCommand, RemoveSequenceCommand, RenameSequenceCommand, SetSequenceCommand,
	ResizeCanvasCommand, SetSheetSettingsCommand,
	CompositeCommand, ReshapeCommand,
	ReorderFramesCommand, ReorderSequencesCommand,
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
// Pixel-content methods (clearRegion, pasteIntoRegion, transformRegion)
// mutate the canvas directly and then push an already-applied PaintCommand;
// every other method uses history.execute() with a command whose apply()
// performs the mutation.
//
// 'changed' payloads:
//   { type: 'frameAdded',      name }
//   { type: 'frameRemoved',    name }
//   { type: 'frameRenamed',    from, to }
//   { type: 'frameUpdated',    name }         - rect, origin, or collision
//   { type: 'sequenceAdded',   name }
//   { type: 'sequenceRemoved', name }
//   { type: 'sequenceRenamed', from, to }
//   { type: 'sequenceUpdated', name }         - frames list or properties
//   { type: 'regionUpdated' }                 - pixels changed in place
//   { type: 'canvasResized',   width, height }
//   { type: 'settingsUpdated', resized }      - sheet defaults changed
//   { type: 'collisionUpdated' }              - sheet-level collision changed
//   { type: 'reshaped',        cols, rows, width, height }
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
			// No collision key: the frame inherits the sheet's default shape.
		};

		this.history.execute(new AddFrameCommand(sheet, name, frame), 'data');
		this.emit('changed', { typ: 'frameAdded', name });
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

	// patch: { x, y, width, height, centerx, centery } - scalars only.
	setFrame(name, patch) {
		const current = this.sheet.frames[name];
		if (!current) return;
		const before = { ...current };
		const after  = { ...current };
		for (const key of ['x', 'y', 'width', 'height', 'centerx', 'centery']) {
			if (patch[key] !== undefined) after[key] = Number(patch[key]);
		}
		if (deepEqual(before, after)) return;
		this.history.execute(new SetFrameCommand(this.sheet, name, before, after), 'data');
		this.emit('changed', { type: 'frameUpdated', name });
	}

	// Move a frame's rect to a new position, optionally carrying its pixels
	// along. When `moveContents` is false, this is just a metadata change
	// (rect definition moves; the pixels at the old location stay put).
	// When true, the frame's pixels are moved from the old rect to the new
	// one in the same undo step.
	//
	// The undo entry is one command either way. Overlap with other frames
	// is the user's concern - no special handling beyond the swap order
	// documented in swapFrames.
	moveFrameWithContents(name, newX, newY, moveContents) {
		const frame = this.sheet.frames[name];
		if (!frame) return;

		const oldX = frame.x;
		const oldY = frame.y;

		if (!moveContents) {
			return this.setFrame(name, { x: newX, y: newY });
		}

		const ctx = this.sheet.image.getContext('2d', { willReadFrequently: true });
		const w = frame.width;
		const h = frame.height;

		// Union of old and new rects, clipped to canvas bounds, defines the
		// region the PaintCommand will snapshot.
		const ux  = Math.max(0, Math.min(oldX, newX));
		const uy  = Math.max(0, Math.min(oldY, newY));
		const ux2 = Math.min(this.sheet.imageWidth,  Math.max(oldX + w, newX + w));
		const uy2 = Math.min(this.sheet.imageHeight, Math.max(oldY + h, newY + h));
		const uw = ux2 - ux;
		const uh = uy2 - uy;
		if (uw <= 0 || uh <= 0) return;

		const before = ctx.getImageData(ux, uy, uw, uh);
		const pixels = ctx.getImageData(oldX, oldY, w, h);

		ctx.clearRect(oldX, oldY, w, h);
		ctx.putImageData(pixels, newX, newY);

		const after = ctx.getImageData(ux, uy, uw, uh);

		const paintCmd = new PaintCommand(ctx, ux, uy, uw, uh, before, after);

		const beforeFrame = { ...frame };
		const afterFrame  = { ...frame, x: newX, y: newY };
		const frameCmd = new SetFrameCommand(this.sheet, name, beforeFrame, afterFrame);

		// The pixel half is already applied - the buffers were written
		// directly so the "after" snapshot could be captured. Apply the
		// frame half now so both sides of the composite are in their
		// post-command state before the entry is recorded.
		const composite = new CompositeCommand([paintCmd, frameCmd]);
		frameCmd.apply();
		this.history.push(composite, 'both');

		this.emit('changed', { type: 'frameUpdated', name });
	}

	// Shift every named frame by (dx, dy). When `moveContents` is true the
	// pixels travel with the rects; otherwise only the rects move. One
	// undo step regardless of frame count.
	moveFramesWithContents(names, dx, dy, moveContents) {
		if (!names || names.length === 0 || (dx === 0 && dy === 0)) return;

		const sheet = this.sheet;
		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });

		// Snapshot everything before touching the canvas.
		const items = [];
		for (const name of names) {
			const frame = sheet.frames[name];
			if (!frame) continue;
			items.push({
				name,
				oldX: frame.x,
				oldY: frame.y,
				newX: frame.x + dx,
				newY: frame.y + dy,
				width: frame.width,
				height: frame.height,
				pixels: moveContents
					? ctx.getImageData(frame.x, frame.y, frame.width, frame.height)
					: null,
			});
		}
		if (items.length === 0) return;

		// Rect-only moves are pure metadata. Straight to a composite of
		// frame commands.
		if (!moveContents) {
			const commands = [];
			for (const it of items) {
				const frame = sheet.frames[it.name];
				const before = { ...frame };
				const after  = { ...frame, x: it.newX, y: it.newY };
				const cmd = new SetFrameCommand(sheet, it.name, before, after);
				cmd.apply();
				commands.push(cmd);
			}
			const composite = commands.length === 1
				? commands[0]
				: new CompositeCommand(commands);
			this.history.push(composite, 'data');
			for (const it of items) {
				this.emit('changed', { type: 'frameUpdated', name: it.name });
			}
			return;
		}

		// Content moves: work out the union region that the before/after
		// snapshot must cover.
		let ux  = Infinity, uy  = Infinity;
		let ux2 = -Infinity, uy2 = -Infinity;
		for (const it of items) {
			ux  = Math.min(ux,  it.oldX, it.newX);
			uy  = Math.min(uy,  it.oldY, it.newY);
			ux2 = Math.max(ux2, it.oldX + it.width,  it.newX + it.width);
			uy2 = Math.max(uy2, it.oldY + it.height, it.newY + it.height);
		}
		ux  = Math.max(0, ux);
		uy  = Math.max(0, uy);
		ux2 = Math.min(sheet.imageWidth,  ux2);
		uy2 = Math.min(sheet.imageHeight, uy2);
		const uw = ux2 - ux;
		const uh = uy2 - uy;
		if (uw <= 0 || uh <= 0) return;

		const before = ctx.getImageData(ux, uy, uw, uh);

		for (const it of items) {
			ctx.clearRect(it.oldX, it.oldY, it.width, it.height);
		}
		for (const it of items) {
			ctx.putImageData(it.pixels, it.newX, it.newY);
		}

		const after = ctx.getImageData(ux, uy, uw, uh);
		const paintCmd = new PaintCommand(ctx, ux, uy, uw, uh, before, after);

		const commands = [paintCmd];
		for (const it of items) {
			const frame = sheet.frames[it.name];
			const beforeFrame = { ...frame, x: it.oldX, y: it.oldY };
			const afterFrame  = { ...frame, x: it.newX, y: it.newY };
			const cmd = new SetFrameCommand(sheet, it.name, beforeFrame, afterFrame);
			cmd.apply();
			commands.push(cmd);
		}

		const composite = new CompositeCommand(commands);
		this.history.push(composite, 'both');
		for (const it of items) {
			this.emit('changed', { type: 'frameUpdated', name: it.name });
		}
	}

	// Exchange the positions and pixel contents of two frames. Each frame
	// keeps its own width and height; only x/y trade. When the two rects
	// overlap, the frame that was at A's position wins in the shared
	// region - documented rather than special-cased, since a swap between
	// overlapping frames is a user error that undo resolves.
	swapFrames(nameA, nameB) {
		if (nameA === nameB) return;
		const a = this.sheet.frames[nameA];
		const b = this.sheet.frames[nameB];
		if (!a || !b) return;

		const ctx = this.sheet.image.getContext('2d', { willReadFrequently: true });

		const ax = a.x, ay = a.y, aw = a.width,  ah = a.height;
		const bx = b.x, by = b.y, bw = b.width,  bh = b.height;

		const ux  = Math.max(0, Math.min(ax, bx));
		const uy  = Math.max(0, Math.min(ay, by));
		const ux2 = Math.min(this.sheet.imageWidth,  Math.max(ax + aw, bx + bw));
		const uy2 = Math.min(this.sheet.imageHeight, Math.max(ay + ah, by + bh));
		const uw = ux2 - ux;
		const uh = uy2 - uy;
		if (uw <= 0 || uh <= 0) return;

		const before = ctx.getImageData(ux, uy, uw, uh);

		const bufferA = ctx.getImageData(ax, ay, aw, ah);
		const bufferB = ctx.getImageData(bx, by, bw, bh);

		ctx.clearRect(ax, ay, aw, ah);
		ctx.clearRect(bx, by, bw, bh);

		// Order matters only when the rects overlap. A lands at B's old
		// position first, then B lands at A's old position, so B wins any
		// shared pixels.
		ctx.putImageData(bufferA, bx, by);
		ctx.putImageData(bufferB, ax, ay);

		const after = ctx.getImageData(ux, uy, uw, uh);

		const paintCmd = new PaintCommand(ctx, ux, uy, uw, uh, before, after);
		const cmdA = new SetFrameCommand(this.sheet, nameA,
			{ ...a }, { ...a, x: bx, y: by });
		const cmdB = new SetFrameCommand(this.sheet, nameB,
			{ ...b }, { ...b, x: ax, y: ay });

		// Same pattern as moveFrameWithContents: the pixel half of the
		// composite has been applied directly; apply the two frame
		// commands now so the recorded state matches the canvas.
		const composite = new CompositeCommand([paintCmd, cmdA, cmdB]);
		cmdA.apply();
		cmdB.apply();
		this.history.push(composite, 'both');

		this.emit('changed', { type: 'frameUpdated', name: nameA });
		this.emit('changed', { type: 'frameUpdated', name: nameB });
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
		if (patch.frameTimes !== undefined) {
			if (patch.frameTimes.length === 0) delete after.frameTimes;
			else after.frameTimes = patch.frameTimes.slice();
		}
		if (deepEqual(before, after)) return;
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
	//
	// Image width/height, if present in `patch`, trigger a canvas resize in
	// the same command so a single Ctrl+Z reverses the whole dialog
	// interaction.
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

		if (deepEqual(before, after)) return;

		this.history.execute(new SetFrameCommand(this.sheet, frameName, before, after), 'data');
		this.emit('changed', { type: 'frameUpdated', name: frameName });
	}

	// Copy the source frame's collision shape onto every other frame in the
	// sheet. One undo step. Returns the number of frames changed.
	copyFrameCollisionToAll(sourceName) {
		const source = this.sheet.frames[sourceName];
		if (!source) return 0;

		const shape = source.collision && source.collision.circles &&
		              source.collision.circles.length > 0
			? { circles: source.collision.circles.map(c => ({ ...c })) }
			: null;

		const commands = [];
		const affected = [];

		for (const name of this.sheet.frameNames) {
			if (name === sourceName) continue;
			const frame = this.sheet.frames[name];
			if (!frame) continue;

			const before = { ...frame };
			const after  = { ...frame };

			if (shape) {
				after.collision = JSON.parse(JSON.stringify(shape));
			} else {
				delete after.collision;
			}

			if (deepEqual(before, after)) continue;

			const cmd = new SetFrameCommand(this.sheet, name, before, after);
			cmd.apply();
			commands.push(cmd);
			affected.push(name);
		}

		if (commands.length === 0) return 0;

		const composite = commands.length === 1
			? commands[0]
			: new CompositeCommand(commands);
		this.history.push(composite, 'data');

		for (const name of affected) {
			this.emit('changed', { type: 'frameUpdated', name });
		}
		return affected.length;
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

	// --- bulk operations --------------------------------------------------

	// Duplicate each named frame. Names use the same "name_2" convention as
	// the single-frame version. All copies are one undo step.
	duplicateFrames(names) {
		if (!names || names.length === 0) return [];

		const commands = [];
		const newNames = [];

		for (const name of names) {
			const src = this.sheet.frames[name];
			if (!src) continue;

			const newName = this.uniqueFrameName(name);
			const slot = this._findFreeSlot(src.width, src.height);
			const x = slot ? slot.x : src.x;
			const y = slot ? slot.y : src.y;
			const frame = { ...src, x, y };

			// Apply immediately so subsequent slot searches in this batch
			// see the frames we've already planned, then wrap everything
			// in a composite so undo reverses the whole batch at once.
			const cmd = new AddFrameCommand(this.sheet, newName, frame);
			cmd.apply();
			commands.push(cmd);
			newNames.push(newName);
		}

		if (commands.length === 0) return [];
		const composite = commands.length === 1
			? commands[0]
			: new CompositeCommand(commands);
		this.history.push(composite, 'data');
		for (const n of newNames) {
			this.emit('changed', { type: 'frameAdded', name: n });
		}
		return newNames;
	}

	// Remove each named frame and drop it from any sequence that references
	// it. One undo step.
	removeFrames(names) {
		if (!names || names.length === 0) return;

		const commands = [];
		const removed = [];

		for (const name of names) {
			if (!this.sheet.frames[name]) continue;
			const cmd = new RemoveFrameCommand(this.sheet, name);
			cmd.apply();
			commands.push(cmd);
			removed.push(name);
		}

		if (commands.length === 0) return;
		const composite = commands.length === 1
			? commands[0]
			: new CompositeCommand(commands);
		this.history.push(composite, 'data');
		for (const name of removed) {
			this.emit('changed', { type: 'frameRemoved', name });
		}
	}

	// Remove each named sequence. One undo step.
	removeSequences(names) {
		if (!names || names.length === 0) return;

		const commands = [];
		const removed = [];

		for (const name of names) {
			if (!this.sheet.sequences[name]) continue;
			const cmd = new RemoveSequenceCommand(this.sheet, name);
			cmd.apply();
			commands.push(cmd);
			removed.push(name);
		}

		if (commands.length === 0) return;
		const composite = commands.length === 1
			? commands[0]
			: new CompositeCommand(commands);
		this.history.push(composite, 'data');
		for (const name of removed) {
			this.emit('changed', { type: 'sequenceRemoved', name });
		}
	}

	// Move the named frames by one position in the given direction.
	// direction: -1 (up) or +1 (down). Preserves relative order within
	// the moved group; items that would collide with another selected
	// item don't move past it.
	moveFrames(names, direction) {
		const current = this.sheet.frameNames;
		const newOrder = moveInOrder(current, names, direction);
		if (!newOrder) return;
		this.history.execute(new ReorderFramesCommand(this.sheet, newOrder), 'data');
		this.emit('changed', { type: 'framesReordered' });
	}

	moveSequences(names, direction) {
		const current = this.sheet.sequenceNames;
		const newOrder = moveInOrder(current, names, direction);
		if (!newOrder) return;
		this.history.execute(new ReorderSequencesCommand(this.sheet, newOrder), 'data');
		this.emit('changed', { type: 'sequencesReordered' });
	}
}

// Structural equality over plain objects and arrays. Used to short-circuit
// commands that wouldn't change anything - the history layer treats them
// as separate entries otherwise, which pollutes the undo stack.
function deepEqual(a, b) {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	const ka = Object.keys(a), kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (const k of ka) {
		if (!deepEqual(a[k], b[k])) return false;
	}
	return true;
}

// Move every name in `selected` one step in `direction` (-1 up, +1 down).
// Returns the new order, or null if nothing moved.
function moveInOrder(order, selected, direction) {
	const n = order.length;
	const sel = new Set(selected);
	const indices = order
		.map((name, i) => sel.has(name) ? i : -1)
		.filter(i => i >= 0);
	if (indices.length === 0) return null;

	const next = order.slice();
	const stillSelected = new Set(sel);

	// Move top-to-bottom for up, bottom-to-top for down, so items don't
	// step on each other within the same move.
	const seq = direction < 0
		? indices.slice().sort((a, b) => a - b)
		: indices.slice().sort((a, b) => b - a);

	for (const i of seq) {
		const j = i + direction;
		if (j < 0 || j >= n) continue;
		if (stillSelected.has(j)) continue;
		[next[i], next[j]] = [next[j], next[i]];
		stillSelected.delete(i);
		stillSelected.add(j);
	}

	// Return null if the array is unchanged.
	for (let i = 0; i < n; i++) if (next[i] !== order[i]) return next;
	return null;
}
