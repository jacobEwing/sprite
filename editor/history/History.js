import { makeEmitter } from '../lib/emitter.js';

// Linear undo/redo. Commands are pushed already-applied; undo() calls
// revert() and redo() calls apply().
//
// Each push carries a `kind` of 'pixels' (image content) or 'data' (sheet
// structure and settings). The 'change' event exposes it, so the document
// can route dirty-flag tracking appropriately.
export class History {
	constructor({ limit = 100 } = {}) {
		makeEmitter(this);
		this.undoStack = [];
		this.redoStack = [];
		this.limit = limit;
	}

	push(command, kind = 'pixels') {
		this.undoStack.push(command);
		if (this.undoStack.length > this.limit) this.undoStack.shift();
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
		this._emit('undo');
		return true;
	}

	redo() {
		const cmd = this.redoStack.pop();
		if (!cmd) return false;
		cmd.apply();
		this.undoStack.push(cmd);
		this._emit('redo');
		return true;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._emit('clear');
	}

	get canUndo() { return this.undoStack.length > 0; }
	get canRedo() { return this.redoStack.length > 0; }

	_emit(source, kind = null) {
		this.emit('change', {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			depth: this.undoStack.length,
			source,
			kind,
		});
	}
}
