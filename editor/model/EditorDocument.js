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
//   selectedSlotIndices / selectedSlotIndex / _slotAnchor
//     Timeline slots in the current sequence. Same modifier semantics as
//     the lists: plain click replaces, ctrl/cmd toggles, shift extends a
//     range. The primary is the last-clicked member and drives the paused
//     preview's display; the full set is what a multi-slot edit targets.
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
		this.selectedSlotIndices = new Set();
		this._slotAnchor = null;

		this.selection = new Selection();
		this.imageLoaded = false;

		history.on('change', ({ source }) => {
			if (source === 'undo' || source === 'redo') {
				this._reconcileSelection();
				this.emit('selectionChanged', { changed: true });
				this.emit('edit', { type: 'history', source });
			} else if (source === 'push') {
				// A commit happened. Operations that go through EditableSheet
				// already emit 'edit' via the 'changed' path, but pixel
				// operations that push directly to history would otherwise
				// be invisible to views that re-render from sheet state.
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
		this._resetSlotSelection();
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
		this.selectedSlotIndex = null;
		this.selectedSlotIndices = new Set();
		this._slotAnchor = null;
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

	// Seed the timeline's slot selection from the current frame. If the
	// primary frame appears in the primary sequence, its first occurrence
	// becomes the primary slot. Otherwise the timeline sets it on first
	// interaction.
	_resetSlotSelection() {
		this.selectedSlotIndex = null;
		this.selectedSlotIndices = new Set();
		this._slotAnchor = null;

		const seq = this.getSelectedSequence();
		if (seq && this.primaryFrame) {
			const idx = seq.frames.findIndex(s => s.frame === this.primaryFrame);
			if (idx !== -1) {
				this.selectedSlotIndex = idx;
				this.selectedSlotIndices = new Set([idx]);
				this._slotAnchor = idx;
			}
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
		this.selectedSlotIndices = new Set();
		this._slotAnchor = null;
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
	//   keepSet  - plain click on a member of the current set preserves it
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

		// Reconcile the shared slot selection against the new frame. If
		// the tracked slot no longer matches, forget it; then, if the new
		// frame appears in the current sequence, promote its first
		// occurrence. The multi-selection collapses to just the primary —
		// a frame change invalidates any previous multi-slot choice.
		const seq = this.getSelectedSequence();
		if (this.selectedSlotIndex !== null) {
			const slot = seq && seq.frames[this.selectedSlotIndex];
			if (!slot || slot.frame !== name) this.selectedSlotIndex = null;
		}
		if (this.selectedSlotIndex === null && seq) {
			const idx = seq.frames.findIndex(s => s.frame === name);
			if (idx !== -1) this.selectedSlotIndex = idx;
		}
		this.selectedSlotIndices = this.selectedSlotIndex !== null
			? new Set([this.selectedSlotIndex])
			: new Set();
		this._slotAnchor = this.selectedSlotIndex;

		this.emit('selectionChanged', {
			frame: name,
			changed: changed || prevPrimary !== this.primaryFrame,
			focus,
		});
	}

	// Extend the selection to a rectangular block of frames: every frame
	// whose origin (x + centerx, y + centery) falls within the bounding
	// box of the anchor frame and the target frame.
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
		chosen.add(anchorName);
		chosen.add(targetName);

		this.selectedFrames = chosen;
		this.primaryFrame = targetName;

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

		// A sequence change invalidates the slot selection; the timeline
		// re-derives it from the primary frame.
		if (changed) {
			this.selectedSlotIndex = null;
			this.selectedSlotIndices = new Set();
			this._slotAnchor = null;
		}

		this.emit('selectionChanged', {
			sequence: name,
			changed: changed || prevPrimary !== this.primarySequence,
		});
	}

	// --- slot selection ---------------------------------------------------

	// Timeline entry point. Mirrors selectFrame's modifier semantics:
	//   plain    - replace the set with the clicked slot
	//   ctrl/cmd - toggle membership; clicked slot becomes primary if added
	//   shift    - extend from the last-clicked anchor
	//
	// keepSet: when true (the timeline's default), a plain click on a slot
	// that's already in the selection preserves the set and moves the
	// primary. This lets a group drag start from any member. Clicks
	// outside the set still replace it.
	selectSlot(index, { additive = false, range = false, keepSet = true } = {}) {
		const seq = this.getSelectedSequence();
		if (!seq) return;
		if (index < 0 || index >= seq.frames.length) return;

		let changed = false;
		const prevPrimary = this.selectedSlotIndex;

		if (range && this._slotAnchor !== null) {
			const a = this._slotAnchor;
			const b = index;
			const [lo, hi] = a < b ? [a, b] : [b, a];
			this.selectedSlotIndices = new Set();
			for (let i = lo; i <= hi; i++) this.selectedSlotIndices.add(i);
			this.selectedSlotIndex = index;
			changed = true;

		} else if (additive) {
			if (this.selectedSlotIndices.has(index)) {
				if (this.selectedSlotIndices.size > 1) {
					this.selectedSlotIndices.delete(index);
					changed = true;
				}
				if (this.selectedSlotIndex === index) {
					const sorted = [...this.selectedSlotIndices].sort((a, b) => a - b);
					this.selectedSlotIndex = sorted[0] ?? null;
				}
			} else {
				this.selectedSlotIndices.add(index);
				this.selectedSlotIndex = index;
				this._slotAnchor = index;
				changed = true;
			}

		} else if (keepSet && this.selectedSlotIndices.has(index)) {
			if (this.selectedSlotIndex !== index) {
				this.selectedSlotIndex = index;
				changed = true;
			}
			this._slotAnchor = index;

		} else {
			if (this.selectedSlotIndices.size !== 1 || this.selectedSlotIndex !== index) {
				this.selectedSlotIndices = new Set([index]);
				changed = true;
			}
			this.selectedSlotIndex = index;
			this._slotAnchor = index;
		}

		// Sync the frame selection to the primary slot's frame. Collapses
		// the frame selection to that one frame, matching what a plain
		// frame click would do. Done directly rather than via selectFrame,
		// which would collapse the slot set back to a singleton.
		const primarySlot = seq.frames[this.selectedSlotIndex];
		if (primarySlot && primarySlot.frame !== this.primaryFrame) {
			this.primaryFrame = primarySlot.frame;
			this.selectedFrames = new Set([primarySlot.frame]);
			this._frameAnchor = primarySlot.frame;
			if (!this.selection.isEmpty) {
				this.selection.clear();
				this.emit('selectionModified', {});
			}
			changed = true;
		}

		if (changed || prevPrimary !== this.selectedSlotIndex) {
			this.emit('selectionChanged', { changed: true });
		}
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
