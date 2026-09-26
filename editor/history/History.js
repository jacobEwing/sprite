import { makeEmitter } from '../lib/emitter.js';

// Linear undo/redo with per-kind depth tracking.
//
// Each command carries a `kind` of 'pixels' (image content) or 'data'
// (sheet structure and settings). The History tracks how many of each
// live in the undo stack and remembers, for each kind, the depth and
// topmost command at the moment of the last save. Dirty state is derived
// from that comparison, so undoing back to the save point clears it.
//
// The 'change' event fires after every mutation with:
//   { canUndo, canRedo, depth, source, kind, dirtyImage, dirtyData, anyDirty }
export class History {
	constructor({ limit = 100 } = {}) {
		makeEmitter(this);
		this.undoStack = [];
		this.redoStack = [];
		this.limit = limit;

		this._imageDepth = 0;
		this._dataDepth  = 0;

		this._savedImageDepth = 0;
		this._savedDataDepth  = 0;
		this._savedImageTop   = null;
		this._savedDataTop    = null;
	}

	push(command, kind = 'pixels') {
		command._historyKind = kind;
		this.undoStack.push(command);

		if (this.undoStack.length > this.limit) {
			const dropped = this.undoStack.shift();
			if (dropped._historyKind === 'data') this._dataDepth--;
			else                                 this._imageDepth--;
		}

		if (kind === 'data') this._dataDepth++;
		else                 this._imageDepth++;

		this.redoStack.length = 0;
		this._emit('push', kind);
	}

	execute(command, kind = 'pixels') {
		command.apply();
		this.push(command, kind);
		return command;
	}

	undo() {
		const cmd = this.undoStack.pop();
		if (!cmd) return false;
		cmd.revert();
		this.redoStack.push(cmd);
		if (cmd._historyKind === 'data') this._dataDepth--;
		else                             this._imageDepth--;
		this._emit('undo', cmd._historyKind);
		return true;
	}

	redo() {
		const cmd = this.redoStack.pop();
		if (!cmd) return false;
		cmd.apply();
		this.undoStack.push(cmd);
		if (cmd._historyKind === 'data') this._dataDepth++;
		else                             this._imageDepth++;
		this._emit('redo', cmd._historyKind);
		return true;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._imageDepth = 0;
		this._dataDepth  = 0;
		this._savedImageDepth = 0;
		this._savedDataDepth  = 0;
		this._savedImageTop   = null;
		this._savedDataTop    = null;
		this._emit('clear');
	}

	// which: 'image' | 'data' | 'all'. Records the current depths and
	// top commands of each kind as the new "clean" reference.
	markSaved(which = 'all') {
		if (which === 'image' || which === 'all') {
			this._savedImageDepth = this._imageDepth;
			this._savedImageTop   = this._topOfKind('pixels');
		}
		if (which === 'data' || which === 'all') {
			this._savedDataDepth = this._dataDepth;
			this._savedDataTop   = this._topOfKind('data');
		}
		this._emit('marksaved');
	}

	get canUndo() { return this.undoStack.length > 0; }
	get canRedo() { return this.redoStack.length > 0; }

	get imageDirty() {
		if (this._imageDepth !== this._savedImageDepth) return true;
		return this._topOfKind('pixels') !== this._savedImageTop;
	}
	get dataDirty() {
		if (this._dataDepth !== this._savedDataDepth) return true;
		return this._topOfKind('data') !== this._savedDataTop;
	}
	get anyDirty() { return this.imageDirty || this.dataDirty; }

	_topOfKind(kind) {
		for (let i = this.undoStack.length - 1; i >= 0; i--) {
			const c = this.undoStack[i];
			if ((c._historyKind || 'pixels') === kind) return c;
		}
		return null;
	}

	_emit(source, kind = null) {
		this.emit('change', {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			depth: this.undoStack.length,
			source,
			kind,
			dirtyImage: this.imageDirty,
			dirtyData:  this.dataDirty,
			anyDirty:   this.anyDirty,
		});
	}
}
