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
export class ResizeCanvasCommand {
	constructor(sheet, newWidth, newHeight) {
		this.sheet = sheet;
		this.oldImage = sheet.image;
		this.oldWidth = sheet.imageWidth;
		this.oldHeight = sheet.imageHeight;
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

// --- collision ------------------------------------------------------------

export class SetCollisionCommand {
	constructor(sheet, before, after) {
		this.sheet = sheet;
		this.before = clone(before);
		this.after  = clone(after);
	}
	apply()  { this.sheet.collision = clone(this.after); }
	revert() { this.sheet.collision = clone(this.before); }
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
