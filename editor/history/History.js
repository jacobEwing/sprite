import { makeEmitter } from '../lib/emitter.js';

// Linear undo/redo. Commands are pushed already-applied; undo() calls
// revert() and redo() calls apply().
//
// The 'change' event is emitted after every mutation, with:
//   { canUndo, canRedo, depth, source, command? }
// where source is 'push' | 'undo' | 'redo' | 'clear'. Subscribers that only
// care about toolbar state can ignore the last two fields.
export class History {
	constructor({ limit = 100 } = {}) {
		makeEmitter(this);
		this.undoStack = [];
		this.redoStack = [];
		this.limit = limit;
	}

	push(command) {
		this.undoStack.push(command);
		if (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack.length = 0;
		this._emit('push');
	}

	// Apply a command and push it. Preferred entry point for new edits:
	// commands are written assuming they haven't been applied yet.
	execute(command) {
		command.apply();
		this.push(command);
		return command;
	}

	undo() {
		const cmd = this.undoStack.pop();
		if (!cmd) return false;
		cmd.revert();
		this.redoStack.push(cmd);
		this._emit('undo', cmd);
		return true;
	}

	redo() {
		const cmd = this.redoStack.pop();
		if (!cmd) return false;
		cmd.apply();
		this.undoStack.push(cmd);
		this._emit('redo', cmd);
		return true;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._emit('clear');
	}

	get canUndo() { return this.undoStack.length > 0; }
	get canRedo() { return this.redoStack.length > 0; }

	_emit(source, command) {
		this.emit('change', {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			depth: this.undoStack.length,
			source,
			command,
		});
	}
}
