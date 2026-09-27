import { makeEmitter } from '../lib/emitter.js';
import { EditableSheet } from './EditableSheet.js';
import { Selection } from './Selection.js';
import { makeSheetFromImage } from '../io/loadSheet.js';

// Holds the loaded sheet, the current selection, and the current frame /
// sequence selections. The sheet and its image can be loaded, replaced, or
// absent independently, so the editor supports sprite-only, image-only,
// and complete states.
//
// Selection model:
//   selectedFrames / selectedSequences — the full set, for bulk operations
//   primaryFrame / primarySequence     — the "focused" one tools act on
//   _frameAnchor / _sequenceAnchor     — anchor for shift-click range select
//
// A single click sets the set to one item and makes it primary. Ctrl-click
// toggles membership. Shift-click extends a contiguous range from the
// anchor. The set is never empty while the corresponding list is non-empty;
// ctrl-clicking the last item away is a no-op.
//
// Events:
//   sheetChanged      — { sheet } (may be null)
//   imageChanged      — {}
//   selectionChanged  — { frame?, sequence?, changed?, focus? }
//   selectionModified — {} — the pixel selection rect changed
//   edit              — the EditableSheet 'changed' payload, or
//                       { type: 'history' } for undo/redo, or
//                       { type: 'imageLoaded' } for setImage
//   dirtyChanged      — { dirtyImage, dirtyData, anyDirty }
export class EditorDocument {
	constructor(history) {
		makeEmitter(this);
		this.history = history;
		this.sheet = null;
		this.editable = null;

		this.selectedFrames = new Set();
		this.primaryFrame = null;
		this._frameAnchor = null;

		this.selectedSequences = new Set();
		this.primarySequence = null;
		this._sequenceAnchor = null;

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

	// Primary selections, read by tools and inspectors.
	get selectedFrame()    { return this.primaryFrame; }
	get selectedSequence() { return this.primarySequence; }

	// Selected items as an array, ordered by their position in the sheet.
	get selectedFrameList() {
		if (!this.sheet) return [];
		const set = this.selectedFrames;
		return this.sheet.frameNames.filter(n => set.has(n));
	}
	get selectedSequenceList() {
		if (!this.sheet) return [];
		const set = this.selectedSequences;
		return this.sheet.sequenceNames.filter(n => set.has(n));
	}

	// --- loading ----------------------------------------------------------

	setSheet(sheet, { keepImage = false, imageLoaded = null } = {}) {
		if (keepImage && this.sheet && this.sheet.image && this.imageLoaded) {
			sheet.image = this.sheet.image;
		}
		if (!sheet.image) {
			const c = document.createElement('canvas');
			c.width = 256; c.height = 256;
			sheet.image = c;
		}

		this.sheet = sheet;
		this.editable = new EditableSheet(sheet, this.history);
		this.editable.on('changed', (info) => this._onEdit(info));

		this._resetFrameSelection();
		this._resetSequenceSelection();
		this.selection.clear();
		this.imageLoaded = imageLoaded !== null ? imageLoaded : !keepImage;
		this.history.clear();

		this.emit('sheetChanged', { sheet });
		this.emit('selectionChanged', { focus: false });
	}

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
		this.selectedFrames.clear();
		this.selectedSequences.clear();
		this.primaryFrame = null;
		this.primarySequence = null;
		this._frameAnchor = null;
		this._sequenceAnchor = null;
		this.selection.clear();
		this.imageLoaded = false;
		this.history.clear();
		this.emit('sheetChanged', { sheet: null });
		this.emit('selectionChanged', { focus: false });
	}

	// --- selection helpers ------------------------------------------------

	_resetFrameSelection() {
		this.selectedFrames = new Set();
		this.primaryFrame = null;
		this._frameAnchor = null;
		if (this.sheet && this.sheet.frameNames.length > 0) {
			const first = this.sheet.frameNames[0];
			this.selectedFrames.add(first);
			this.primaryFrame = first;
			this._frameAnchor = first;
		}
	}

	_resetSequenceSelection() {
		this.selectedSequences = new Set();
		this.primarySequence = null;
		this._sequenceAnchor = null;
		if (this.sheet && this.sheet.sequenceNames.length > 0) {
			const first = this.sheet.sequenceNames[0];
			this.selectedSequences.add(first);
			this.primarySequence = first;
			this._sequenceAnchor = first;
		}
	}

	// --- edits ------------------------------------------------------------

	_onEdit(info) {
		let selectionChanged = false;

		if (info.type === 'frameRemoved') {
			if (this.selectedFrames.has(info.name)) {
				this.selectedFrames.delete(info.name);
				selectionChanged = true;
			}
			if (this.primaryFrame === info.name) {
				this.primaryFrame = this.selectedFrameList[0] ?? null;
			}
			if (this._frameAnchor === info.name) {
				this._frameAnchor = this.primaryFrame;
			}
			// If the frame set is now empty but frames remain, pick the first.
			if (this.selectedFrames.size === 0 && this.sheet.frameNames.length > 0) {
				const first = this.sheet.frameNames[0];
				this.selectedFrames.add(first);
				this.primaryFrame = first;
				this._frameAnchor = first;
			}
		} else if (info.type === 'frameRenamed') {
			if (this.selectedFrames.has(info.from)) {
				this.selectedFrames.delete(info.from);
				this.selectedFrames.add(info.to);
				selectionChanged = true;
			}
			if (this.primaryFrame === info.from) this.primaryFrame = info.to;
			if (this._frameAnchor === info.from)  this._frameAnchor = info.to;
		} else if (info.type === 'sequenceRemoved') {
			if (this.selectedSequences.has(info.name)) {
				this.selectedSequences.delete(info.name);
				selectionChanged = true;
			}
			if (this.primarySequence === info.name) {
				this.primarySequence = this.selectedSequenceList[0] ?? null;
			}
			if (this._sequenceAnchor === info.name) {
				this._sequenceAnchor = this.primarySequence;
			}
			if (this.selectedSequences.size === 0 && this.sheet.sequenceNames.length > 0) {
				const first = this.sheet.sequenceNames[0];
				this.selectedSequences.add(first);
				this.primarySequence = first;
				this._sequenceAnchor = first;
			}
		} else if (info.type === 'sequenceRenamed') {
			if (this.selectedSequences.has(info.from)) {
				this.selectedSequences.delete(info.from);
				this.selectedSequences.add(info.to);
				selectionChanged = true;
			}
			if (this.primarySequence === info.from) this.primarySequence = info.to;
			if (this._sequenceAnchor === info.from) this._sequenceAnchor = info.to;
		}

		if (selectionChanged) this.emit('selectionChanged', { changed: true });
		this.emit('edit', info);
	}

	_reconcileSelection() {
		if (!this.sheet) return;

		const liveFrames = new Set(this.sheet.frameNames);
		const kept = [...this.selectedFrames].filter(n => liveFrames.has(n));
		this.selectedFrames = new Set(kept);
		if (this.selectedFrames.size === 0 && this.sheet.frameNames.length > 0) {
			const first = this.sheet.frameNames[0];
			this.selectedFrames.add(first);
			this.primaryFrame = first;
			this._frameAnchor = first;
		} else if (!this.selectedFrames.has(this.primaryFrame)) {
			this.primaryFrame = this.selectedFrameList[0] ?? null;
			this._frameAnchor = this.primaryFrame;
		}

		const liveSeqs = new Set(this.sheet.sequenceNames);
		const keptSeqs = [...this.selectedSequences].filter(n => liveSeqs.has(n));
		this.selectedSequences = new Set(keptSeqs);
		if (this.selectedSequences.size === 0 && this.sheet.sequenceNames.length > 0) {
			const first = this.sheet.sequenceNames[0];
			this.selectedSequences.add(first);
			this.primarySequence = first;
			this._sequenceAnchor = first;
		} else if (!this.selectedSequences.has(this.primarySequence)) {
			this.primarySequence = this.selectedSequenceList[0] ?? null;
			this._sequenceAnchor = this.primarySequence;
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

	// --- frame selection --------------------------------------------------

	// Options:
	//   focus    — hint for the viewport to move the camera
	//   additive — ctrl/cmd-click: toggle membership
	//   range    — shift-click: extend from the anchor
	selectFrame(name, { focus = false, additive = false, range = false } = {}) {
		if (!this.sheet) return;
		const allNames = this.sheet.frameNames;
		if (!allNames.includes(name)) return;

		let changed = false;
		const prevPrimary = this.primaryFrame;

		if (range && this._frameAnchor && allNames.includes(this._frameAnchor)) {
			const a = allNames.indexOf(this._frameAnchor);
			const b = allNames.indexOf(name);
			const [lo, hi] = a < b ? [a, b] : [b, a];
			this.selectedFrames = new Set(allNames.slice(lo, hi + 1));
			this.primaryFrame = name;
			changed = true;

		} else if (additive) {
			if (this.selectedFrames.has(name)) {
				if (this.selectedFrames.size > 1) {
					this.selectedFrames.delete(name);
					changed = true;
				}
				if (this.primaryFrame === name) {
					this.primaryFrame = this.selectedFrameList[0] ?? null;
				}
			} else {
				this.selectedFrames.add(name);
				this.primaryFrame = name;
				this._frameAnchor = name;
				changed = true;
			}

		} else {
			if (this.selectedFrames.size !== 1 || this.primaryFrame !== name) {
				this.selectedFrames = new Set([name]);
				changed = true;
			}
			this.primaryFrame = name;
			this._frameAnchor = name;
		}

		if (changed && !this.selection.isEmpty) {
			this.selection.clear();
			this.emit('selectionModified', {});
		}
		this.emit('selectionChanged', {
			frame: name,
			changed: changed || prevPrimary !== this.primaryFrame,
			focus,
		});
	}

	// --- sequence selection -----------------------------------------------

	selectSequence(name, { additive = false, range = false } = {}) {
		if (!this.sheet) return;
		const allNames = this.sheet.sequenceNames;
		if (!allNames.includes(name)) return;

		let changed = false;
		const prevPrimary = this.primarySequence;

		if (range && this._sequenceAnchor && allNames.includes(this._sequenceAnchor)) {
			const a = allNames.indexOf(this._sequenceAnchor);
			const b = allNames.indexOf(name);
			const [lo, hi] = a < b ? [a, b] : [b, a];
			this.selectedSequences = new Set(allNames.slice(lo, hi + 1));
			this.primarySequence = name;
			changed = true;

		} else if (additive) {
			if (this.selectedSequences.has(name)) {
				if (this.selectedSequences.size > 1) {
					this.selectedSequences.delete(name);
					changed = true;
				}
				if (this.primarySequence === name) {
					this.primarySequence = this.selectedSequenceList[0] ?? null;
				}
			} else {
				this.selectedSequences.add(name);
				this.primarySequence = name;
				this._sequenceAnchor = name;
				changed = true;
			}

		} else {
			if (this.selectedSequences.size !== 1 || this.primarySequence !== name) {
				this.selectedSequences = new Set([name]);
				changed = true;
			}
			this.primarySequence = name;
			this._sequenceAnchor = name;
		}

		this.emit('selectionChanged', {
			sequence: name,
			changed: changed || prevPrimary !== this.primarySequence,
		});
	}

	getSelectedFrame() {
		return this.sheet && this.primaryFrame
			? this.sheet.frames[this.primaryFrame]
			: null;
	}

	getSelectedSequence() {
		return this.sheet && this.primarySequence
			? this.sheet.sequences[this.primarySequence]
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
