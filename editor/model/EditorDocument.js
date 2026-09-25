import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';

// Holds the loaded sheet and the current selection. Wraps the sheet in an
// EditableSheet so all structural mutations go through the command layer.
//
// Events:
//   sheetChanged     — a new sheet has been set
//   selectionChanged — { frame?, sequence?, focus?, changed? }
//   edit             — something in the sheet changed (data or structure)
//
// 'edit' fires for two reasons:
//   1. EditableSheet executed a mutation (payload describes what changed)
//   2. History undid or redid a mutation (payload is { type: 'history' })
// Views can treat both as "something changed, refresh yourself."
export class EditorDocument {
	constructor(history) {
		makeEmitter(this);
		this.history = history;
		this.sheet = null;
		this.editable = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
		this.dirty = false;

		// Undo/redo bypass EditableSheet, so we listen to history directly
		// and turn its events into the same 'edit' signal views already know.
		history.on('change', ({ source }) => {
			// 'clear' fires when a new sheet is loaded; everything else is
			// a real edit.
			if (source !== 'clear') this._setDirty(true);

			if (source === 'undo' || source === 'redo') {
				this._reconcileSelection();
				this.emit('selectionChanged', { changed: true });
				this.emit('edit', { type: 'history', source });
			}
		});

	}

	setSheet(sheet) {
		this.sheet = sheet;
		this.editable = new EditableSheet(sheet, this.history);
		this.editable.on('changed', (info) => this._onEdit(info));

		this.selectedFrame = sheet.frameNames[0] ?? null;
		this.selectedSequence = sheet.sequenceNames[0] ?? null;
		this._setDirty(false);
		this.emit('sheetChanged', { sheet });
		this.emit('selectionChanged', { focus: false });
	}

	_onEdit(info) {
		let selectionChanged = false;

		if (info.type === 'frameRemoved' && this.selectedFrame === info.name) {
			this.selectedFrame = this.sheet.frameNames[0] ?? null;
			selectionChanged = true;
		} else if (info.type === 'frameRenamed' && this.selectedFrame === info.from) {
			this.selectedFrame = info.to;
			selectionChanged = true;
		} else if (info.type === 'sequenceRemoved' && this.selectedSequence === info.name) {
			this.selectedSequence = this.sheet.sequenceNames[0] ?? null;
			selectionChanged = true;
		} else if (info.type === 'sequenceRenamed' && this.selectedSequence === info.from) {
			this.selectedSequence = info.to;
			selectionChanged = true;
		}

		if (selectionChanged) this.emit('selectionChanged', { changed: true });
		this.emit('edit', info);
	}

	// After undo/redo, the selection may point at something that no longer
	// exists. Fall back to the first available item. (Undoing a rename
	// leaves the frame under its old name; we don't try to follow it — the
	// user re-selects. Rare enough that the fallback is fine.)
	_reconcileSelection() {
		if (!this.sheet) return;
		if (this.selectedFrame && !this.sheet.frames[this.selectedFrame]) {
			this.selectedFrame = this.sheet.frameNames[0] ?? null;
		}
		if (this.selectedSequence && !this.sheet.sequences[this.selectedSequence]) {
			this.selectedSequence = this.sheet.sequenceNames[0] ?? null;
		}
	}

	selectFrame(name, { focus = false } = {}) {
		const changed = this.selectedFrame !== name;
		this.selectedFrame = name;
		this.emit('selectionChanged', { frame: name, changed, focus });
	}

	selectSequence(name) {
		const changed = this.selectedSequence !== name;
		this.selectedSequence = name;
		this.emit('selectionChanged', { sequence: name, changed });
	}

	getSelectedFrame() {
		return this.sheet && this.selectedFrame
			? this.sheet.frames[this.selectedFrame]
			: null;
	}

	getSelectedSequence() {
		return this.sheet && this.selectedSequence
			? this.sheet.sequences[this.selectedSequence]
			: null;
	}
	_setDirty(dirty) {
		if (this.dirty === dirty) return;
		this.dirty = dirty;
		this.emit('dirtyChanged', { dirty });
	}

	markSaved() {
		this._setDirty(false);
	}
}
