import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';
import { Selection } from './Selection.js';

// Holds the loaded sheet, the current selection, and the current frame /
// sequence selections. Wraps the sheet in an EditableSheet so all
// structural mutations go through the command layer.
//
// Events:
//   sheetChanged      — a new sheet has been set
//   selectionChanged  — frame or sequence selection changed
//                       { frame?, sequence?, focus?, changed? }
//   selectionModified — the pixel selection rect changed (during a drag)
//   edit              — a mutation occurred (any kind)
//   dirtyChanged      — { dirtyImage, dirtyData, anyDirty }
export class EditorDocument {
	constructor(history) {
		makeEmitter(this);
		this.history = history;
		this.sheet = null;
		this.editable = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
		this.selection = new Selection();

		history.on('change', ({ source }) => {
			if (source === 'undo' || source === 'redo') {
				this._reconcileSelection();
				this.emit('selectionChanged', { changed: true });
				this.emit('edit', { type: 'history', source });
			}
			this._emitDirty();
		});
	}

	get anyDirty()   { return this.history.anyDirty; }
	get dirtyImage() { return this.history.imageDirty; }
	get dirtyData()  { return this.history.dataDirty; }
	get dirty()      { return this.anyDirty; }

	setSheet(sheet) {
		this.sheet = sheet;
		this.editable = new EditableSheet(sheet, this.history);
		this.editable.on('changed', (info) => this._onEdit(info));

		this.selectedFrame = sheet.frameNames[0] ?? null;
		this.selectedSequence = sheet.sequenceNames[0] ?? null;
		this.selection.clear();

		this.history.clear();

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

	_reconcileSelection() {
		if (!this.sheet) return;
		if (this.selectedFrame && !this.sheet.frames[this.selectedFrame]) {
			this.selectedFrame = this.sheet.frameNames[0] ?? null;
		}
		if (this.selectedSequence && !this.sheet.sequences[this.selectedSequence]) {
			this.selectedSequence = this.sheet.sequenceNames[0] ?? null;
		}
	}

	markSaved(which = 'all') {
		this.history.markSaved(which);
	}

	// --- pixel selection --------------------------------------------------

	setSelection(rect) {
		const changed = this.selection.set(rect);
		if (changed) this.emit('selectionModified', {});
		return changed;
	}

	clearSelection() {
		if (this.selection.isEmpty) return;
		this.selection.clear();
		this.emit('selectionModified', {});
	}

	// Select the current frame's full bounds.
	selectAllOfFrame() {
		const f = this.getSelectedFrame();
		if (!f) return;
		this.setSelection({ x: f.x, y: f.y, w: f.width, h: f.height });
	}

	// Internal: the SelectionTool mutates .selection directly for live
	// feedback during a drag, then fires this to redraw.
	_emitSelectionModified() {
		this.emit('selectionModified', {});
	}

	// The rect that pixel-content operations should act on: the current
	// selection if there is one, otherwise the selected frame's bounds.
	currentOpRect() {
		if (this.selection.rect) return { ...this.selection.rect };
		const f = this.getSelectedFrame();
		if (!f) return null;
		return { x: f.x, y: f.y, w: f.width, h: f.height };
	}

	// --- frame / sequence selection --------------------------------------

	selectFrame(name, { focus = false } = {}) {
		const changed = this.selectedFrame !== name;
		this.selectedFrame = name;
		// Changing frames clears the pixel selection: a rect anchored in
		// the previous frame's neighbourhood is meaningless here.
		if (changed && !this.selection.isEmpty) {
			this.selection.clear();
			this.emit('selectionModified', {});
		}
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

	_emitDirty() {
		this.emit('dirtyChanged', {
			dirtyImage: this.dirtyImage,
			dirtyData:  this.dirtyData,
			anyDirty:   this.anyDirty,
		});
	}
}
