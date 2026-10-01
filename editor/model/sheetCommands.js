// Commands that mutate a SpriteSheet. Each has apply() and revert().
//
// Two families:
//   • Structural commands - clone their before/after data at construction
//     and swap it in on apply/revert. Add/Remove/Rename/Set for frames and
//     sequences, plus SetCollision and SetSheetSettings.
//   • Image-swap commands - hold a reference to the previous canvas and
//     build a new one on first apply. ResizeCanvasCommand and
//     ReshapeCommand. These don't clone pixels; they replace the whole
//     canvas reference.
//
// CompositeCommand wraps a list of commands into one atomic undo entry.
// Applied in order on apply, reversed on revert.

function clone(x) {
	return JSON.parse(JSON.stringify(x));
}

// --- frames ---------------------------------------------------------------

export class AddFrameCommand {
	constructor(sheet, name, frame) {
		this.sheet = sheet;
		this.name = name;
		this.frame = clone(frame);
	}
	apply()  { this.sheet.frames[this.name] = clone(this.frame); }
	revert() { delete this.sheet.frames[this.name]; }
}

export class RemoveFrameCommand {
	constructor(sheet, name) {
		this.sheet = sheet;
		this.name = name;
		this.frame = clone(sheet.frames[name]);
		// Snapshot the frames array of every sequence that references this
		// frame, so revert() can restore the sequences intact.
		this.affectedSequences = {};
		for (const [seqName, seq] of Object.entries(sheet.sequences)) {
			if (seq.frames.some(s => s.frame === name)) {
				this.affectedSequences[seqName] = seq.frames.map(s => ({
					frame: s.frame,
					transform: s.transform ? { ...s.transform } : null,
				}));
			}
		}
	}
	apply() {
		delete this.sheet.frames[this.name];
		for (const [seqName, frames] of Object.entries(this.affectedSequences)) {
			this.sheet.sequences[seqName].frames =
				frames.filter(s => s.frame !== this.name);
		}
	}
	revert() {
		this.sheet.frames[this.name] = clone(this.frame);
		for (const [seqName, frames] of Object.entries(this.affectedSequences)) {
			this.sheet.sequences[seqName].frames = frames.map(s => ({
				frame: s.frame,
				transform: s.transform ? { ...s.transform } : null,
			}));
		}
	}
}

export class RenameFrameCommand {
	constructor(sheet, oldName, newName) {
		this.sheet = sheet;
		this.oldName = oldName;
		this.newName = newName;
		// Record which indices in each sequence point at the old name.
		this.affectedSequences = {};
		for (const [seqName, seq] of Object.entries(sheet.sequences)) {
			const idxs = [];
			seq.frames.forEach((s, i) => { if (s.frame === oldName) idxs.push(i); });
			if (idxs.length) this.affectedSequences[seqName] = idxs;
		}
	}
	_swap(from, to) {
		const frames = this.sheet.frames;
		if (!frames[from]) return;

		// Rebuild the frame map in place, preserving key order.
		const oldFrame = frames[from];
		const keys = Object.keys(frames);
		const ordered = {};
		for (const key of keys) {
			if (key === from) ordered[to] = oldFrame;
			else              ordered[key] = frames[key];
		}
		for (const key of keys) delete frames[key];
		for (const key of Object.keys(ordered)) frames[key] = ordered[key];

		// Update every sequence slot that referenced the old name,
		// preserving the slot's transform.
		for (const [seqName, idxs] of Object.entries(this.affectedSequences)) {
			const seq = this.sheet.sequences[seqName];
			for (const i of idxs) {
				const slot = seq.frames[i];
				if (slot && typeof slot === 'object') {
					seq.frames[i] = { ...slot, frame: to };
				}
			}
		}
	}
	apply()  { this._swap(this.oldName, this.newName); }
	revert() { this._swap(this.newName, this.oldName); }
}

// Sets one frame's numeric/metadata fields (rect, origin). `before` and
// `after` are full frame objects; apply() writes `after` onto the live
// frame, revert() writes `before`.
export class SetFrameCommand {
	constructor(sheet, name, before, after) {
		this.sheet = sheet;
		this.name = name;
		this.before = clone(before);
		this.after = clone(after);
	}
	apply()  { this.sheet.frames[this.name] = clone(this.after); }
	revert() { this.sheet.frames[this.name] = clone(this.before); }
}

// --- sequences ------------------------------------------------------------

export class AddSequenceCommand {
	constructor(sheet, name, sequence) {
		this.sheet = sheet;
		this.name = name;
		this.sequence = clone(sequence);
	}
	apply()  { this.sheet.sequences[this.name] = clone(this.sequence); }
	revert() { delete this.sheet.sequences[this.name]; }
}

export class RemoveSequenceCommand {
	constructor(sheet, name) {
		this.sheet = sheet;
		this.name = name;
		this.sequence = clone(sheet.sequences[name]);
	}
	apply()  { delete this.sheet.sequences[this.name]; }
	revert() { this.sheet.sequences[this.name] = clone(this.sequence); }
}

export class RenameSequenceCommand {
	constructor(sheet, oldName, newName) {
		this.sheet = sheet;
		this.oldName = oldName;
		this.newName = newName;
	}
	apply()  { this._swap(this.oldName, this.newName); }
	revert() { this._swap(this.newName, this.oldName); }

	// Rebuild the sequences map in place with the renamed key at the same
	// position. Direct assignment plus delete would append the new key at
	// the end, changing the visible order.
	_swap(from, to) {
		const sequences = this.sheet.sequences;
		if (!sequences[from]) return;

		const oldSeq = sequences[from];
		// Keep the sequence's own `name` field in sync with its key.
		// Without this, code that keys off seq.name (duplicate, delete,
		// setSlotTransforms) would look up a key that no longer exists.
		oldSeq.name = to;

		const keys = Object.keys(sequences);
		const ordered = {};
		for (const key of keys) {
			if (key === from) ordered[to] = oldSeq;
			else              ordered[key] = sequences[key];
		}
		for (const key of keys) delete sequences[key];
		for (const key of Object.keys(ordered)) sequences[key] = ordered[key];
	}
}

export class SetSequenceCommand {
	constructor(sheet, name, before, after) {
		this.sheet = sheet;
		this.name = name;
		this.before = clone(before);
		this.after = clone(after);
	}
	apply()  { this.sheet.sequences[this.name] = clone(this.after); }
	revert() { this.sheet.sequences[this.name] = clone(this.before); }
}

// --- canvas operations ----------------------------------------------------
export class ResizeCanvasCommand {
	constructor(sheet, newWidth, newHeight) {
		this.sheet = sheet;
		this.oldImage = sheet.image;
		this.newWidth = newWidth;
		this.newHeight = newHeight;
		this.newImage = null;
	}

	_build() {
		const c = document.createElement('canvas');
		c.width = this.newWidth;
		c.height = this.newHeight;
		const ctx = c.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(this.oldImage, 0, 0);
		return c;
	}

	apply() {
		if (!this.newImage) this.newImage = this._build();
		this.sheet.image = this.newImage;
	}

	revert() {
		this.sheet.image = this.oldImage;
	}
}

// --- sheet settings -------------------------------------------------------

// Updates the sheet's default values: frame size, origin, default frame
// rate. None of these affect existing frames or sequences (they all have
// their own values baked in at creation time), so the command is safe.
export class SetSheetSettingsCommand {
	constructor(sheet, before, after) {
		this.sheet = sheet;
		this.before = { ...before };
		this.after  = { ...after };
	}
	apply() {
		Object.assign(this.sheet, this.after);
	}
	revert() {
		Object.assign(this.sheet, this.before);
	}
}

// Bundle several commands as one atomic action. apply() runs forwards,
// revert() runs backwards, so dependencies unwind correctly.
export class CompositeCommand {
	constructor(commands) {
		this.commands = commands;
	}
	apply()  { for (const c of this.commands) c.apply(); }
	revert() { for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].revert(); }
}

// --- reshape --------------------------------------------------------------

// Repack every frame into a clean row-major grid, then resize the canvas to
// fit. Frame widths and heights are preserved on the frame objects
// themselves; only x/y change. Content that extends past a frame's new cell
// is clipped to the cell boundary.
//
// The old canvas is left untouched (we build a new one), so revert only has
// to swap the image reference back and restore the old positions.
export class ReshapeCommand {
	constructor(sheet, newPositions, newCanvasWidth, newCanvasHeight, cellW, cellH) {
		this.sheet = sheet;
		this.oldImage = sheet.image;
		this.oldFrames = {};
		for (const name of Object.keys(sheet.frames)) {
			const f = sheet.frames[name];
			this.oldFrames[name] = { x: f.x, y: f.y };
		}
		this.newPositions = newPositions;
		this.newCanvasWidth = newCanvasWidth;
		this.newCanvasHeight = newCanvasHeight;
		this.cellW = cellW;
		this.cellH = cellH;
		this.newImage = null;
	}

	apply() {
		if (!this.newImage) this.newImage = this._build();
		this.sheet.image = this.newImage;
		for (const [name, pos] of Object.entries(this.newPositions)) {
			const f = this.sheet.frames[name];
			if (f) { f.x = pos.x; f.y = pos.y; }
		}
	}

	revert() {
		this.sheet.image = this.oldImage;
		for (const [name, pos] of Object.entries(this.oldFrames)) {
			const f = this.sheet.frames[name];
			if (f) { f.x = pos.x; f.y = pos.y; }
		}
	}

	_build() {
		const c = document.createElement('canvas');
		c.width  = this.newCanvasWidth;
		c.height = this.newCanvasHeight;
		const ctx = c.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;

		for (const [name, newPos] of Object.entries(this.newPositions)) {
			const frame = this.sheet.frames[name];
			if (!frame) continue;
			const old = this.oldFrames[name];
			if (!old) continue;

			// Clip to the cell size: a frame bigger than one cell
			// contributes only its top-left cell-sized area.
			const copyW = Math.min(frame.width,  this.cellW);
			const copyH = Math.min(frame.height, this.cellH);

			ctx.drawImage(
				this.oldImage,
				old.x, old.y, copyW, copyH,
				newPos.x, newPos.y, copyW, copyH
			);
		}
		return c;
	}
}

// --- reorder --------------------------------------------------------------

// Rebuild the frames map with the given key order. Existing frame objects
// are reused by reference, so this is O(n) and doesn't clone pixel data.
export class ReorderFramesCommand {
	constructor(sheet, newOrder) {
		this.sheet = sheet;
		this.oldOrder = sheet.frameNames;
		this.newOrder = newOrder.slice();
	}
	apply()  { this._applyOrder(this.newOrder); }
	revert() { this._applyOrder(this.oldOrder); }
	_applyOrder(order) {
		const frames = this.sheet.frames;
		const rebuilt = {};
		for (const name of order) {
			if (frames[name]) rebuilt[name] = frames[name];
		}
		for (const key of Object.keys(frames)) delete frames[key];
		Object.assign(frames, rebuilt);
	}
}

export class ReorderSequencesCommand {
	constructor(sheet, newOrder) {
		this.sheet = sheet;
		this.oldOrder = sheet.sequenceNames;
		this.newOrder = newOrder.slice();
	}
	apply()  { this._applyOrder(this.newOrder); }
	revert() { this._applyOrder(this.oldOrder); }
	_applyOrder(order) {
		const sequences = this.sheet.sequences;
		const rebuilt = {};
		for (const name of order) {
			if (sequences[name]) rebuilt[name] = sequences[name];
		}
		for (const key of Object.keys(sequences)) delete sequences[key];
		Object.assign(sequences, rebuilt);
	}
}
