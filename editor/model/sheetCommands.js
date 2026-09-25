// Commands that mutate a SpriteSheet's data. Each has apply() and revert()
// and touches only plain objects (frames, sequences, image). ImageData
// operations for canvas resize are handled separately.

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
			if (seq.frames.includes(name)) {
				this.affectedSequences[seqName] = seq.frames.slice();
			}
		}
	}
	apply() {
		delete this.sheet.frames[this.name];
		for (const [seqName, frames] of Object.entries(this.affectedSequences)) {
			this.sheet.sequences[seqName].frames = frames.filter(f => f !== this.name);
		}
	}
	revert() {
		this.sheet.frames[this.name] = clone(this.frame);
		for (const [seqName, frames] of Object.entries(this.affectedSequences)) {
			this.sheet.sequences[seqName].frames = frames.slice();
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
			seq.frames.forEach((f, i) => { if (f === oldName) idxs.push(i); });
			if (idxs.length) this.affectedSequences[seqName] = idxs;
		}
	}
	_swap(from, to) {
		this.sheet.frames[to] = this.sheet.frames[from];
		delete this.sheet.frames[from];
		for (const [seqName, idxs] of Object.entries(this.affectedSequences)) {
			const seq = this.sheet.sequences[seqName];
			for (const i of idxs) seq.frames[i] = to;
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
	apply() {
		this.sheet.sequences[this.newName] = this.sheet.sequences[this.oldName];
		delete this.sheet.sequences[this.oldName];
	}
	revert() {
		this.sheet.sequences[this.oldName] = this.sheet.sequences[this.newName];
		delete this.sheet.sequences[this.newName];
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

// Replaces sheet.image with a larger canvas that contains the old image at
// (offsetX, offsetY). The new canvas is built lazily on first apply so
// redo after undo of later edits rebuilds it fresh if needed; in practice
// the redo stack is cleared by any intervening edit, so this is a one-shot.
//
// Frame rects are assumed to stay at their existing coordinates. Callers
// that want to insert space *above* or *left of* existing content must also
// shift every frame's x/y — that's out of scope here.
export class ExpandCanvasCommand {
	constructor(sheet, newWidth, newHeight, offsetX = 0, offsetY = 0) {
		this.sheet = sheet;
		this.oldImage = sheet.image;
		this.oldWidth = sheet.imageWidth;
		this.oldHeight = sheet.imageHeight;
		this.newWidth = newWidth;
		this.newHeight = newHeight;
		this.offsetX = offsetX;
		this.offsetY = offsetY;
		this.newImage = null;
	}

	_build() {
		const c = document.createElement('canvas');
		c.width = this.newWidth;
		c.height = this.newHeight;
		const ctx = c.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(this.oldImage, this.offsetX, this.offsetY);
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
