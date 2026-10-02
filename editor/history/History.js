import { makeEmitter } from '../lib/emitter.js';

// Linear undo/redo with per-kind depth tracking.
//
// Each command carries a `kind`:
//   'pixels' - image content changed (paint strokes, transforms, filters)
//   'data'   - sheet structure changed (frames, sequences, settings)
//   'both'   - both at once (e.g. reshape, which moves frames and the image)
//
// The History tracks how many of each kind live in the undo stack and
// remembers, per kind, the depth and topmost command at the moment of the
// last save. Dirty state is derived from that comparison, so undoing back
// to the save point clears it.
//
// The 'change' event fires after every mutation with:
//   { canUndo, canRedo, depth, source, kind, dirtyImage, dirtyData, anyDirty }
// `source` is one of 'push' | 'undo' | 'redo' | 'clear' | 'marksaved'.
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

	// Record a command that has already been applied by the caller. Use
	// this when the operation mutates pixels directly (putImageData,
	// drawImage) and then wraps the before/after state in a command - the
	// command's own apply() would be a redundant re-application.
	push(command, kind = 'pixels', options = {}) {
		command._historyKind = kind;
		this.undoStack.push(command);

		if (this.undoStack.length > this.limit) {
			const dropped = this.undoStack.shift();
			this._decKind(dropped._historyKind);
		}
		this._incKind(kind);

		this.redoStack.length = 0;
		this._emit('push', kind, options);
	}

	// Apply a command and record it. Use this when the command itself
	// performs the mutation - data commands like AddFrameCommand,
	// SetFrameCommand, and ResizeCanvasCommand are written this way.
	execute(command, kind = 'pixels', options = {}) {
		command.apply();
		this.push(command, kind, options);
		return command;
	}

	undo() {
		const cmd = this.undoStack.pop();
		if (!cmd) return false;
		cmd.revert();
		this.redoStack.push(cmd);
		this._decKind(cmd._historyKind);
		this._emit('undo', cmd._historyKind);
		return true;
	}

	redo() {
		const cmd = this.redoStack.pop();
		if (!cmd) return false;
		cmd.apply();
		this.undoStack.push(cmd);
		this._incKind(cmd._historyKind);
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

	// Walk back through the undo stack looking for the topmost command of
	// the requested kind. A 'both' command satisfies either query.
	_topOfKind(kind) {
		for (let i = this.undoStack.length - 1; i >= 0; i--) {
			const c = this.undoStack[i];
			const k = c._historyKind || 'pixels';
			if (k === kind || k === 'both') return c;
		}
		return null;
	}

	_emit(source, kind = null, extras = {}) {
		this.emit('change', {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			depth: this.undoStack.length,
			source,
			kind,
			...extras,
			dirtyImage: this.imageDirty,
			dirtyData:  this.dataDirty,
			anyDirty:   this.anyDirty,
		});
	}

	_incKind(kind) {
		if (kind === 'data') this._dataDepth++;
		else if (kind === 'both') { this._dataDepth++; this._imageDepth++; }
		else this._imageDepth++;
	}
	_decKind(kind) {
		if (kind === 'data') this._dataDepth--;
		else if (kind === 'both') { this._dataDepth--; this._imageDepth--; }
		else this._imageDepth--;
	}
}
