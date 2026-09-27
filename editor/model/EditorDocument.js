import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';
import { Selection } from './Selection.js';
import { makeSheetFromImage } from '../io/loadSheet.js';

// Holds the loaded sheet, the current selection, and the current frame /
// sequence selections. The sheet and its image can be loaded, replaced, or
// absent independently, so the editor supports sprite-only, image-only,
// and complete states.
//
// Events:
//   sheetChanged      — a new sheet has been set (full replace). Payload:
//                       { sheet }, where sheet may be null.
//   imageChanged      — the sheet's image was swapped in place. Payload: {}.
//   selectionChanged  — frame or sequence selection changed. Payload:
//                       { frame?, sequence?, changed?, focus? }.
//   selectionModified — the pixel selection rect changed. Payload: {}.
//   edit              — a mutation occurred. Payload: the EditableSheet
//                       'changed' payload, or { type: 'history' } for
//                       undo/redo, or { type: 'imageLoaded' } for setImage.
//   dirtyChanged      — dirty flags changed. Payload:
//                       { dirtyImage, dirtyData, anyDirty }.
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

	// Full replace. `keepImage` carries the current image over to the new
	// sheet — used when loading sprite data without touching pixels.
	// `imageLoaded` defaults to the inverse of keepImage: if we're not
	// keeping an image, the incoming sheet's own image counts as loaded.
	setSheet(sheet, { keepImage = false, imageLoaded = null } = {}) {
		if (keepImage && this.sheet && this.sheet.image && this.imageLoaded) {
			sheet.image = this.sheet.image;
			// Intentionally not copying imageSrc: the incoming sheet may
			// carry its own declared name (from the JSON), and that's more
			// authoritative than whatever filename the currently-loaded
			// image happens to have. Callers that need to fall back set it
			// themselves before calling setSheet.
		}
		if (!sheet.image) {
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
	// Does not clear history if a sheet already exists — the sprite data is
	// untouched, so prior edits are still meaningful.
	async setImage(canvas, imageFilename) {
		if (!this.sheet) {
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

	// EditorDocument watches the EditableSheet's 'changed' event and
	// reconciles its own selection if the change invalidated it. The
	// payload is forwarded to 'edit' listeners unchanged.
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
	// exists. Fall back to the first available item.
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
	// Called by SelectionTool during a live drag, which mutates
	// .selection directly for performance and then pings this.
	_emitSelectionModified() {
		this.emit('selectionModified', {});
	}
	// The rect a pixel-content operation should act on: the current
	// selection if there is one, otherwise the selected frame's bounds.
	currentOpRect() {
		if (this.selection.rect) return { ...this.selection.rect };
		const f = this.getSelectedFrame();
		if (!f) return null;
		return { x: f.x, y: f.y, w: f.width, h: f.height };
	}

	// --- frame / sequence selection --------------------------------------

	// `focus` is a hint for the viewport: true means "move the camera to
	// this frame", false means "just select it". List clicks pass focus;
	// canvas clicks don't.
	selectFrame(name, { focus = false } = {}) {
		const changed = this.selectedFrame !== name;
		this.selectedFrame = name;
		// Frame changes clear any pixel selection: a rect anchored in the
		// previous frame's neighbourhood is meaningless here.
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
