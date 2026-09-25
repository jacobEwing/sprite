import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';

// Holds the loaded sheet and the current selection. Wraps the sheet in an
// EditableSheet so all structural mutations go through the command layer.
//
// Two dirty flags track unsaved work:
//   dirtyImage — the PNG differs from what's on disk
//   dirtyData  — the JSON differs from what's on disk
// Both must be cleared before the editor considers itself fully saved.
//
// Events:
//   sheetChanged     — a new sheet has been set
//   selectionChanged — { frame?, sequence?, focus?, changed? }
//   edit             — a mutation occurred (any kind)
//   dirtyChanged     — { dirtyImage, dirtyData, anyDirty }
export class EditorDocument {
	constructor(history) {
		makeEmitter(this);
		this.history = history;
		this.sheet = null;
		this.editable = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
		this.dirtyImage = false;
		this.dirtyData  = false;

		history.on('change', ({ source, kind }) => {
			if (source === 'push') {
				this._setDirty(kind === 'data' ? 'data' : 'image', true);
			}
			// Undo/redo leave dirty state as-is: the user has work in
			// progress, and only an explicit save should clear that.
			if (source === 'undo' || source === 'redo') {
				this._reconcileSelection();
				this.emit('selectionChanged', { changed: true });
				this.emit('edit', { type: 'history', source });
			}
		});
	}

	get anyDirty() { return this.dirtyImage || this.dirtyData; }

	setSheet(sheet) {
		this.sheet = sheet;
		this.editable = new EditableSheet(sheet, this.history);
		this.editable.on('changed', (info) => this._onEdit(info));

		this.selectedFrame = sheet.frameNames[0] ?? null;
		this.selectedSequence = sheet.sequenceNames[0] ?? null;

		this._setDirty('image', false);
		this._setDirty('data',  false);

		this.emit('sheetChanged', { sheet });
		this.emit('selectionChanged', { focus: false });
	}

	_onEdit(info) {
		// The history push already set the appropriate dirty flag; we only
		// reconcile the selection here.
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

	_reconcileSelection() {
		if (!this.sheet) return;
		if (this.selectedFrame && !this.sheet.frames[this.selectedFrame]) {
			this.selectedFrame = this.sheet.frameNames[0] ?? null;
		}
		if (this.selectedSequence && !this.sheet.sequences[this.selectedSequence]) {
			this.selectedSequence = this.sheet.sequenceNames[0] ?? null;
		}
	}

	_setDirty(which, dirty) {
		const key = which === 'image' ? 'dirtyImage' : 'dirtyData';
		if (this[key] === dirty) return;
		this[key] = dirty;
		this.emit('dirtyChanged', {
			dirtyImage: this.dirtyImage,
			dirtyData:  this.dirtyData,
			anyDirty:   this.anyDirty,
		});
	}

	// which: 'image' | 'data' | 'all'
	markSaved(which = 'all') {
		if (which === 'image' || which === 'all') this._setDirty('image', false);
		if (which === 'data'  || which === 'all') this._setDirty('data',  false);
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
}
