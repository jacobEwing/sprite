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
//   selectedFrames / selectedSequences - the full set, for bulk operations
//   primaryFrame / primarySequence     - the "focused" one tools act on
//   _frameAnchor / _sequenceAnchor     - anchor for shift-click range select
//
// A single click sets the set to one item and makes it primary. Ctrl-click
// toggles membership. Shift-click extends a contiguous range from the
// anchor. The set is never empty while the corresponding list is non-empty;
// ctrl-clicking the last item away is a no-op.
//
// Events:
//   sheetChanged      - { sheet } (may be null)
//   imageChanged      - {}
//   selectionChanged  - { frame?, sequence?, changed?, focus? }
//   selectionModified - {} - the pixel selection rect changed
//   edit              - the EditableSheet 'changed' payload, or
//                       { type: 'history' } for undo/redo, or
//                       { type: 'imageLoaded' } for setImage
//   dirtyChanged      - { dirtyImage, dirtyData, anyDirty }
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

		this.selectedSlotIndex = null;

		this.selection = new Selection();
		this.imageLoaded = false;

		history.on('change', ({ source }) => {
			if (source === 'undo' || source === 'redo') {
				this._reconcileSelection();
				this.emit('selectionChanged', { changed: true });
				this.emit('edit', { type: 'history', source });
			} else if (source === 'push') {
				// A commit happened. Operations that go through EditableSheet already emit
				// 'edit' via the 'changed' path, but pixel operations that push directly to
				// history (tools' stroke transactions, panels' apply steps) would otherwise be
				// invisible to views that re-render from sheet state. Emitting here covers
				// both, at the cost of a redundant redraw for the EditableSheet path. Harmless
				// and cheap.
				this.emit('edit', { type: 'pixelsPushed' });
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
		this.selectedSlotIndex = null;
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

		// Slot indices are sequence-relative; after undo/redo they may
		// point at a different slot. Clear and let the timeline re-derive.
		this.selectedSlotIndex = null;
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
	_emitSelectionModified() {
		this.emit('selectionModified', {});
	}
	currentOpRect() {
		if (this.selection.rect) return { ...this.selection.rect };
		const f = this.getSelectedFrame();
		if (!f) return null;
		return { x: f.x, y: f.y, w: f.width, h: f.height };
	}

	// Returns one entry per frame the current operation should apply to.
	// `allFrames` overrides the default scope (selected frames) with every
	// frame in the sheet. Each entry carries:
	//   { name, frame, rect }
	// where `rect` is the region to process: the frame's bounds, or the
	// intersection with the pixel selection when one exists. Frames whose
	// intersection is empty are skipped.
	opRectsFor({ allFrames = false } = {}) {
		if (!this.sheet) return [];
		const names = allFrames ? this.sheet.frameNames : this.selectedFrameList;
		const sel = this.selection.rect;
		const out = [];
		for (const name of names) {
			const f = this.sheet.frames[name];
			if (!f) continue;
			if (!sel) {
				out.push({
					name,
					frame: f,
					rect: { x: f.x, y: f.y, w: f.width, h: f.height },
				});
				continue;
			}
			const x1 = Math.max(sel.x, f.x);
			const y1 = Math.max(sel.y, f.y);
			const x2 = Math.min(sel.x + sel.w, f.x + f.width);
			const y2 = Math.min(sel.y + sel.h, f.y + f.height);
			if (x2 <= x1 || y2 <= y1) continue;
			out.push({
				name,
				frame: f,
				rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
			});
		}
		return out;
	}

	// --- frame selection --------------------------------------------------

	// Options:
	//   focus    - hint for the viewport to move the camera
	//   additive - ctrl/cmd-click: toggle membership
	//   range    - shift-click: extend from the anchor
	selectFrame(name, { focus = false, additive = false, range = false, keepSet = false } = {}) {
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

		} else if (keepSet && this.selectedFrames.has(name)) {
			// Click on a member of the current multi-selection: move the
			// primary but keep the set intact, so a group drag can start
			// from any member. Anchor follows the primary so a subsequent
			// shift-click extends from where the user last clicked.
			if (this.primaryFrame !== name) {
				this.primaryFrame = name;
				changed = true;
			}
			this._frameAnchor = name;

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

		// Reconcile the shared slot index against the new frame. If the tracked slot
		// no longer matches, forget it; then, if the new frame appears in the current
		// sequence, promote its first occurrence to be the primary slot.
		//
		// Runs here rather than in a view so every listener sees a consistent value on
		// the same event — the preview in particular reads it when paused.
		const seq = this.getSelectedSequence();
		if (this.selectedSlotIndex !== null) {
			const slot = seq && seq.frames[this.selectedSlotIndex];
			if (!slot || slot.frame !== name) this.selectedSlotIndex = null;
		}
		if (this.selectedSlotIndex === null && seq) {
			const idx = seq.frames.findIndex(s => s.frame === name);
			if (idx !== -1) this.selectedSlotIndex = idx;
		}

		this.emit('selectionChanged', {
			frame: name,
			changed: changed || prevPrimary !== this.primaryFrame,
			focus,
		});
	}

	// Extend the selection to a rectangular block of frames: every frame
	// whose origin (x + centerx, y + centery) falls within the bounding
	// box of the anchor frame and the target frame. Used by the Frame
	// tool's shift-click.
	//
	// The anchor is preserved across repeated shift-clicks, matching the
	// list-based range select.
	selectFrameRectRange(targetName) {
		if (!this.sheet) return;
		const anchorName = this._frameAnchor ?? this.primaryFrame;
		if (!anchorName) return;

		const anchor = this.sheet.frames[anchorName];
		const target = this.sheet.frames[targetName];
		if (!anchor || !target) return;

		const acx = anchor.x + anchor.centerx;
		const acy = anchor.y + anchor.centery;
		const tcx = target.x + target.centerx;
		const tcy = target.y + target.centery;

		const minX = Math.min(acx, tcx);
		const maxX = Math.max(acx, tcx);
		const minY = Math.min(acy, tcy);
		const maxY = Math.max(acy, tcy);

		const chosen = new Set();
		for (const name of this.sheet.frameNames) {
			const f = this.sheet.frames[name];
			const cx = f.x + f.centerx;
			const cy = f.y + f.centery;
			if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
				chosen.add(name);
			}
		}
		// Both endpoints always included, whatever their origins say.
		chosen.add(anchorName);
		chosen.add(targetName);

		this.selectedFrames = chosen;
		this.primaryFrame = targetName;
		// _frameAnchor deliberately not updated here.

		if (!this.selection.isEmpty) {
			this.selection.clear();
			this.emit('selectionModified', {});
		}
		this.emit('selectionChanged', { frame: targetName, changed: true, focus: false });
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

		if (changed) this.selectedSlotIndex = null;
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
