import { makeEmitter } from '../lib/emitter.js';
import {
	AddFrameCommand, RemoveFrameCommand, RenameFrameCommand, SetFrameCommand,
	AddSequenceCommand, RemoveSequenceCommand, RenameSequenceCommand, SetSequenceCommand,
	ExpandCanvasCommand,
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

		// Place the copy just to the right of the source if there's room;
		// otherwise just below it; otherwise on top of it (user can move
		// it via the inspector).
		let x = src.x + src.width;
		let y = src.y;
		if (x + src.width > this.sheet.imageWidth) {
			x = src.x;
			y = src.y + src.height;
		}
		if (y + src.height > this.sheet.imageHeight) {
			x = src.x;
			y = src.y;
		}

		const frame = { ...src, x, y };
		this.history.execute(new AddFrameCommand(this.sheet, name, frame));
		this.emit('changed', { type: 'frameAdded', name });
		return name;
	}

	removeFrame(name) {
		if (!this.sheet.frames[name]) return;
		this.history.execute(new RemoveFrameCommand(this.sheet, name));
		this.emit('changed', { type: 'frameRemoved', name });
	}

	renameFrame(oldName, newName) {
		if (oldName === newName) return;
		if (!this.sheet.frames[oldName]) throw new Error(`No such frame: ${oldName}`);
		if (this.sheet.frames[newName]) throw new Error(`Frame already exists: ${newName}`);
		this.history.execute(new RenameFrameCommand(this.sheet, oldName, newName));
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
		this.history.execute(new SetFrameCommand(this.sheet, name, before, after));
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
		this.history.execute(new AddSequenceCommand(this.sheet, name, seq));
		this.emit('changed', { type: 'sequenceAdded', name });
		return name;
	}

	removeSequence(name) {
		if (!this.sheet.sequences[name]) return;
		this.history.execute(new RemoveSequenceCommand(this.sheet, name));
		this.emit('changed', { type: 'sequenceRemoved', name });
	}

	renameSequence(oldName, newName) {
		if (oldName === newName) return;
		if (!this.sheet.sequences[oldName]) throw new Error(`No such sequence: ${oldName}`);
		if (this.sheet.sequences[newName]) throw new Error(`Sequence already exists: ${newName}`);
		this.history.execute(new RenameSequenceCommand(this.sheet, oldName, newName));
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
		this.history.execute(new SetSequenceCommand(this.sheet, name, before, after));
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

	// Grow the atlas canvas to newWidth × newHeight. Existing content is
	// copied to (offsetX, offsetY). Frame rects are not shifted; if
	// offsetX/offsetY are nonzero the caller is responsible for moving them.
	expandCanvas(newWidth, newHeight, offsetX = 0, offsetY = 0) {
		newWidth  = Math.max(newWidth  | 0, this.sheet.imageWidth);
		newHeight = Math.max(newHeight | 0, this.sheet.imageHeight);
		if (newWidth === this.sheet.imageWidth && newHeight === this.sheet.imageHeight) {
			return;
		}
		this.history.execute(
			new ExpandCanvasCommand(this.sheet, newWidth, newHeight, offsetX, offsetY)
		);
		this.emit('changed', {
			type: 'canvasExpanded',
			width: newWidth,
			height: newHeight,
		});
	}
}
