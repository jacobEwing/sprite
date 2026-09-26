import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';
import { Selection } from './Selection.js';

// Holds the loaded sheet, the current selection, and the current frame /
// sequence selections. The sheet and its image can be loaded, replaced, or
// absent independently.
//
// Events:
//   sheetChanged      — a new sheet has been set (full replace)
//   imageChanged      — the sheet's image was swapped
//   selectionChanged  — frame or sequence selection changed
//   selectionModified — the pixel selection rect changed
//   edit              — a mutation occurred
//   dirtyChanged      — dirty flags changed
export class EditorDocument {
	constructor(history) {
		makeEmitter(this);
		this.history = history;
		this.sheet = null;
		this.editable = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
		this.selection = new Selection();
		this.imageLoaded = false;

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

	get hasSheet()   { return !!this.sheet; }
	get hasImage()   { return !!this.imageLoaded; }
	get imageSrc()   { return this.sheet ? this.sheet.imageSrc : null; }

	// --- loading ----------------------------------------------------------

	// Full replace. Keeps the currently loaded image if `keepImage` is
	// true; otherwise the sheet's own image is used, or a placeholder is
	// installed.
	setSheet(sheet, { keepImage = false, imageLoaded = null } = {}) {
		if (keepImage && this.sheet && this.sheet.image && this.imageLoaded) {
			sheet.image = this.sheet.image;
			sheet.imageSrc = this.sheet.imageSrc;
		}
		if (!sheet.image) {
			// Shouldn't happen with the load helpers, but guard anyway.
			const c = document.createElement('canvas');
			c.width = 256; c.height = 256;
			sheet.image = c;
		}

		this.sheet = sheet;
		this.editable = new EditableSheet(sheet, this.history);
		this.editable.on('changed', (info) => this._onEdit(info));

		this.selectedFrame = sheet.frameNames[0] ?? null;
		this.selectedSequence = sheet.sequenceNames[0] ?? null;
		this.selection.clear();
		this.imageLoaded = imageLoaded !== null ? imageLoaded : !keepImage;
		this.history.clear();

		this.emit('sheetChanged', { sheet });
		this.emit('selectionChanged', { focus: false });
	}

	// Swap just the image. Creates a minimal sheet if none is loaded.
	// Does not clear history if a sheet already exists (the sprite data is
	// untouched, so prior edits are still meaningful).
	async setImage(canvas, imageFilename) {
		if (!this.sheet) {
			const { makeSheetFromImage } = await import('../io/loadSheet.js');
			const sheet = await makeSheetFromImage(canvas);
			sheet.imageSrc = imageFilename;
			this.setSheet(sheet, { imageLoaded: true });
			return;
		}
		this.sheet.image = canvas;
		this.sheet.imageSrc = imageFilename;
		this.imageLoaded = true;
		this.emit('imageChanged', {});
		this.emit('edit', { type: 'imageLoaded' });
	}

	clearAll() {
		this.sheet = null;
		this.editable = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
		this.selection.clear();
		this.imageLoaded = false;
		this.history.clear();
		this.emit('sheetChanged', { sheet: null });
		this.emit('selectionChanged', { focus: false });
	}

	// --- edits ------------------------------------------------------------

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

	markSaved(which = 'all') { this.history.markSaved(which); }

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
	selectAllOfFrame() {
		const f = this.getSelectedFrame();
		if (!f) return;
		this.setSelection({ x: f.x, y: f.y, w: f.width, h: f.height });
	}
	_emitSelectionModified() {
		this.emit('selectionModified', {});
	}
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
