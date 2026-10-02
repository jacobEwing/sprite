import { makeEmitter } from '../lib/emitter.js';
import { valueAdjuster } from '../lib/valueAdjuster.js';
import { applyIcon } from './toolIcons.js';
import { escapeBlurs } from '../lib/fieldEscape.js';

const THUMB_SIZE = 56;

// Auto-scroll behaviour while dragging a block near the strip's edges.
// AUTOSCROLL_EDGE_PX is how close the cursor must be to trigger scrolling;
// AUTOSCROLL_MAX_SPEED_PX is the per-frame scroll speed at the very edge,
// falling off linearly to zero at AUTOSCROLL_EDGE_PX away.
const AUTOSCROLL_EDGE_PX      = 48;
const AUTOSCROLL_MAX_SPEED_PX = 12;

// Horizontal strip of frame thumbnails for the selected sequence. Each
// tile carries a small toolbar for slot-level actions.
//
// Selection mirrors the frame and sequence lists: plain click replaces,
// ctrl/cmd toggles, shift extends a range from the anchor. The primary
// (last-clicked) drives the paused preview; the full set is what the
// transform editor targets.
//
// Drag reorder: the block spans from the min to the max of the current
// selection, gaps included. The whole span moves as one unit. Selected
// indices, the primary, the anchor, and the open transform editor all
// shift to stay on the same slots.
//
// A left-click on empty strip space collapses a multi-selection down to
// the primary, mirroring the canvas behaviour for frames.
//
// The # button opens the slot transform editor, which expands the
// timeline upward over the canvas.
export class Timeline {
	constructor(root, doc, viewport) {
		makeEmitter(this);
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.drag = null;              // see _onDown for the shape
		this.editingIndex = null;      // non-null when the transform editor is open
		this.scaleLocked = false;

		this._build();
		this._bind();

		this._adjusters = [];

		doc.on('sheetChanged',     () => { this._closeEditor(); this.render(); });
		doc.on('selectionChanged', () => this._onSelectionChange());
		doc.on('edit',             () => this._onEdit());

		this._updateAddButtonState();
		this.render();

	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="tl-header">
				<span class="tl-title">Timeline</span>
				<span class="tl-hint">drag to reorder · click to select</span>
				<button class="tl-add-btn" title="Add the selected frames to this sequence">
					+ Add selected frames
				</button>
			</div>
			<div class="tl-strip"></div>
			<div class="tl-editor">
				<div class="tl-editor-header">
					<span class="tl-editor-title">Slot transform</span>
					<button class="tl-editor-close" title="Close (Esc)">×</button>
				</div>
				<div class="tl-editor-body">
					<div class="tl-editor-fields"></div>
					<div class="tl-editor-actions">
						<div class="tl-editor-actions-left">
							<span class="tl-editor-hint">Pivot:</span>
							<button class="tl-editor-pivot-btn" data-pivot="origin">Origin</button>
							<button class="tl-editor-pivot-btn" data-pivot="centre">Centre</button>
							<label class="tl-editor-lock">
								<input type="checkbox" class="tl-editor-lock-input"> Lock scale
							</label>
						</div>
						<button class="tl-editor-reset">Reset transform</button>
					</div>
				</div>
			</div>
		`;

		this.stripEl        = this.root.querySelector('.tl-strip');
		this.editorEl       = this.root.querySelector('.tl-editor');
		this.editorTitleEl  = this.root.querySelector('.tl-editor-title');
		this.editorFieldsEl = this.root.querySelector('.tl-editor-fields');
		this.editorResetBtn = this.root.querySelector('.tl-editor-reset');
	}

	_bind() {
		this.stripEl.addEventListener('mousedown', (e) => this._onDown(e));
		this.stripEl.addEventListener('dblclick', (e) => this._onDoubleClick(e));

		this.addBtn = this.root.querySelector('.tl-add-btn');
		this.addBtn.addEventListener('click', () => this._addSelectedFrames());

		this.root.querySelector('.tl-editor-close')
			.addEventListener('click', () => this._closeEditor());
		this.editorResetBtn
			.addEventListener('click', () => this._resetSlotTransform());
		for (const btn of this.root.querySelectorAll('.tl-editor-pivot-btn')) {
			btn.addEventListener('click', () => this._applyPivotPreset(btn.dataset.pivot));
		}

		this.scaleLockInput = this.root.querySelector('.tl-editor-lock-input');
		this.scaleLockInput.checked = this.scaleLocked;
		this.scaleLockInput.addEventListener('change', () => {
			this.scaleLocked = this.scaleLockInput.checked;
			this._renderEditor();
		});

		document.addEventListener('keydown', (e) => {
			if (document.activeElement !== document.body) return;
			if (e.key === 'Escape' && this.editingIndex !== null) this._closeEditor();
		});
	}

	// --- rendering --------------------------------------------------------

	render() {
		if (this.drag) return;
		this._renderFrames(null);
	}

	_renderFrames(workingList) {
		const scrollLeft = this.stripEl.scrollLeft;
		const sheet = this.doc.sheet;
		const seq = this.doc.getSelectedSequence();
		this.stripEl.innerHTML = '';

		if (!seq || !sheet) {
			this.stripEl.innerHTML = '<div class="tl-empty">No sequence selected.</div>';
			return;
		}

		const slots = workingList || seq.frames;
		if (slots.length === 0) {
			this.stripEl.innerHTML = '<div class="tl-empty">This sequence has no frames.</div>';
			return;
		}

		slots.forEach((slot, i) => {
			const tile = this._makeTile(slot, i, sheet, seq);
			if (this.drag && i >= this.drag.blockStart && i <= this.drag.blockEnd) {
				tile.classList.add('dragging');
			}
			this.stripEl.appendChild(tile);
		});
		this.stripEl.scrollLeft = scrollLeft;
	}

	_makeTile(slot, index, sheet, seq) {
		const frameName = slot.frame;
		const frame = sheet.frames[frameName];

		const tile = document.createElement('div');
		tile.className = 'tl-tile';

		const isPrimarySlot   = this.doc.selectedSlotIndex === index;
		const isInSet         = this.doc.selectedSlotIndices.has(index);
		const isSelectedFrame = frameName === this.doc.selectedFrame;

		if (isPrimarySlot)        tile.classList.add('selected');
		else if (isInSet)         tile.classList.add('multi-selected');
		else if (isSelectedFrame) tile.classList.add('same-frame');

		tile.dataset.index = index;
		tile.dataset.frame = frameName;

		const canvas = document.createElement('canvas');
		canvas.width = THUMB_SIZE;
		canvas.height = THUMB_SIZE;
		canvas.className = 'tl-thumb';
		if (frame) this._drawThumb(canvas, sheet, frame, slot.transform);
		tile.appendChild(canvas);

		const label = document.createElement('div');
		label.className = 'tl-tile-label';
		label.textContent = frameName;
		label.title = frameName;
		tile.appendChild(label);

		const idx = document.createElement('div');
		idx.className = 'tl-tile-index';
		idx.textContent = index;
		tile.appendChild(idx);

		const toolbar = document.createElement('div');
		toolbar.className = 'tl-tile-toolbar';

		const tBtn = document.createElement('button');
		tBtn.className = 'tl-tile-btn';
		tBtn.dataset.icon = 'slot-transform';
		tBtn.textContent = '#';
		tBtn.title = slot.transform
			? 'Edit slot transform (currently set)'
			: 'Add slot transform';
		if (slot.transform) tBtn.classList.add('active');
		tBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this._openEditor(index);
		});
		applyIcon(tBtn, 'slot-transform');
		toolbar.appendChild(tBtn);

		const dBtn = document.createElement('button');
		dBtn.className = 'tl-tile-btn';
		dBtn.dataset.icon = 'slot-duplicate';
		dBtn.textContent = '+';
		dBtn.title = 'Duplicate slot';
		dBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this._duplicateSlot(index);
		});
		applyIcon(dBtn, 'slot-duplicate');
		toolbar.appendChild(dBtn);

		const xBtn = document.createElement('button');
		xBtn.className = 'tl-tile-btn';
		xBtn.dataset.icon = 'slot-delete';
		xBtn.textContent = '×';
		xBtn.title = 'Delete slot';
		xBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this._deleteSlot(index);
		});
		applyIcon(xBtn, 'slot-delete');
		toolbar.appendChild(xBtn);

		tile.appendChild(toolbar);
		return tile;
	}

	_drawThumb(canvas, sheet, frame, transform) {
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		const pad = 2;
		const availW = canvas.width - pad * 2;
		const availH = canvas.height - pad * 2;

		let scale = Math.min(availW / frame.width, availH / frame.height);
		if (scale >= 1) scale = Math.floor(scale);

		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		if (transform) {
			ctx.translate(
				(transform.translateX || 0) * scale,
				(transform.translateY || 0) * scale
			);
			if (transform.rotation) ctx.rotate(transform.rotation * Math.PI / 180);
			ctx.scale(
				(transform.scaleX ?? 1),
				(transform.scaleY ?? 1)
			);
		}

		ctx.drawImage(
			sheet.image,
			frame.x, frame.y, frame.width, frame.height,
			(-frame.width  / 2) * scale,
			(-frame.height / 2) * scale,
			frame.width  * scale,
			frame.height * scale
		);
		ctx.restore();
	}

	// --- transform editor -------------------------------------------------

	_openEditor(index) {
		const seq = this.doc.getSelectedSequence();
		if (!seq || index < 0 || index >= seq.frames.length) return;

		if (!this.doc.selectedSlotIndices.has(index)) {
			this.doc.selectSlot(index);
		}

		this.editingIndex = index;
		this.root.classList.add('editing');
		this._renderEditor();
	}

	_closeEditor() {
		if (this.editingIndex === null) return;
		this.editingIndex = null;
		this.root.classList.remove('editing');
	}

	_renderEditor() {
		const seq = this.doc.getSelectedSequence();
		const indices = [...this.doc.selectedSlotIndices].sort((a, b) => a - b);
		if (!seq || indices.length === 0) return;

		const primaryIdx = this.doc.selectedSlotIndex ?? indices[indices.length - 1];
		const primarySlot = seq.frames[primaryIdx];
		if (!primarySlot) return;

		const primaryFrame = this.doc.sheet.frames[primarySlot.frame];
		const defX = primaryFrame ? primaryFrame.centerx : 0;
		const defY = primaryFrame ? primaryFrame.centery : 0;

		for (const w of this._adjusters) w.destroy();
		this._adjusters = [];

		this.editorTitleEl.textContent = indices.length === 1
			? `Slot ${primaryIdx}: ${primarySlot.frame}`
			: `${indices.length} slots selected`;
		this.editorFieldsEl.innerHTML = '';

		const fieldSpecs = [
			{ key: 'translateX', label: 'Translate X', step: 1, default: 0 },
			{ key: 'translateY', label: 'Translate Y', step: 1, default: 0 },
			{ key: 'rotation',   label: 'Rotation °',  step: 1,   default: 0 },
			{ key: 'scaleX',     label: 'Scale X',     step: 0.5,   default: 1 },
			{ key: 'scaleY',     label: 'Scale Y',     step: 0.5,   default: 1 },
			{ key: 'pivotX',     label: 'Pivot X',     step: 0.5, default: defX },
			{ key: 'pivotY',     label: 'Pivot Y',     step: 0.5, default: defY },
		];

		for (const f of fieldSpecs) {
			const values = indices.map(i => {
				const slot = seq.frames[i];
				if (!slot) return 0;
				const t = slot.transform || {};
				const sf = this.doc.sheet.frames[slot.frame];
				const dfX = sf ? sf.centerx : 0;
				const dfY = sf ? sf.centery : 0;
				if (f.key === 'pivotX') return t.pivotX ?? dfX;
				if (f.key === 'pivotY') return t.pivotY ?? dfY;
				return t[f.key] ?? f.default;
			});
			const first = values[0];
			const mixed = !values.every(v => v === first);

			const cell = document.createElement('div');
			cell.className = 'tl-editor-field';

			const label = document.createElement('span');
			label.className = 'insp-label';
			label.textContent = f.label;
			cell.appendChild(label);

			if (mixed) {
				const input = document.createElement('input');
				input.type = 'number';
				input.className = 'tl-editor-num mixed';
				input.step = String(f.step);
				input.placeholder = '—';
				input.value = '';
				input.addEventListener('change', () => {
					const v = parseFloat(input.value);
					if (!Number.isFinite(v)) return;
					const patch = { [f.key]: v };
					if (this.scaleLocked && (f.key === 'scaleX' || f.key === 'scaleY')) {
						patch.scaleX = v;
						patch.scaleY = v;
					}
					this.doc.editable.setSlotTransforms(seq.name, indices, patch);
				});

				escapeBlurs(input);
				cell.appendChild(input);
			} else {
				const visible = document.createElement('input');
				visible.type = 'number';
				visible.className = 'tl-editor-num';
				visible.step = String(f.step);
				visible.value = first;
				escapeBlurs(visible);
				cell.appendChild(visible);

				const raw = document.createElement('input');
				raw.type = 'number';
				raw.step = String(f.step);
				raw.value = first;
				cell.appendChild(raw);
				this._adjusters.push(valueAdjuster(raw, {
					stepSize: f.step,
					displayElement: visible,
					onAdjust: (v) => {
						const num = Number.isFinite(v) ? v : f.default;
						const patch = { [f.key]: num };
						if (this.scaleLocked && (f.key === 'scaleX' || f.key === 'scaleY')) {
							patch.scaleX = num;
							patch.scaleY = num;
						}
						this.doc.editable.setSlotTransforms(seq.name, indices, patch);
					},
				}));

				const handle = raw.nextElementSibling
					? raw.nextElementSibling.querySelector('.value-adjuster-handle')
					: null;
				if (handle) handle.tabIndex = -1;
			}

			this.editorFieldsEl.appendChild(cell);
		}

		this.editorResetBtn.disabled =
			!indices.some(i => seq.frames[i] && seq.frames[i].transform);
	}

	_resetSlotTransform() {
		const seq = this.doc.getSelectedSequence();
		const indices = [...this.doc.selectedSlotIndices];
		if (!seq || indices.length === 0) return;
		this.doc.editable.setSlotTransforms(seq.name, indices, null);
	}

	_applyPivotPreset(which) {
		const seq = this.doc.getSelectedSequence();
		const indices = [...this.doc.selectedSlotIndices].sort((a, b) => a - b);
		if (!seq || indices.length === 0) return;

		const frames = seq.frames.map(s => ({
			frame: s.frame,
			transform: s.transform ? { ...s.transform } : null,
		}));

		for (const i of indices) {
			const slot = frames[i];
			if (!slot) continue;
			const f = this.doc.sheet.frames[slot.frame];
			if (!f) continue;

			const base = slot.transform || {
				translateX: 0, translateY: 0, rotation: 0,
				scaleX: 1, scaleY: 1,
				pivotX: f.centerx, pivotY: f.centery,
			};
			const next = { ...base };
			if (which === 'origin') {
				next.pivotX = f.centerx;
				next.pivotY = f.centery;
			} else if (which === 'centre') {
				next.pivotX = f.width  / 2;
				next.pivotY = f.height / 2;
			} else return;

			// Mirror the identity check from EditableSheet.setSlotTransforms
			const isIdentity =
				next.translateX === 0 && next.translateY === 0 &&
				next.rotation === 0 &&
				next.scaleX === 1 && next.scaleY === 1 &&
				next.pivotX === f.centerx && next.pivotY === f.centery;

			slot.transform = isIdentity ? null : next;
		}

		this.doc.editable.setSequence(seq.name, { frames });
	}

	// Add the currently-selected frames to the current sequence. Mirrors
	// the SequenceInspector's button.
	_addSelectedFrames() {
		const seq = this.doc.getSelectedSequence();
		const frames = this.doc.selectedFrameList;
		if (!seq || frames.length === 0) return;
		this.doc.editable.addFramesToSequence(seq.name, frames);
	}

	_updateAddButtonState() {
		if (!this.addBtn) return;
		const hasSeq = !!this.doc.getSelectedSequence();
		const hasFrames = this.doc.selectedFrameList.length > 0;
		this.addBtn.disabled = !hasSeq || !hasFrames;
	}

	_onSelectionChange() {
		const seq = this.doc.getSelectedSequence();

		if (this.editingIndex !== null) {
			if (!seq || this.doc.selectedSlotIndices.size === 0) {
				this._closeEditor();
			} else {
				this._renderEditor();
			}
		}

		this._updateAddButtonState();
		this.render();
	}

	_onEdit() {
		if (this.editingIndex !== null) this._renderEditor();
		this.render();
	}

	// --- slot buttons -----------------------------------------------------

	_duplicateSlot(index) {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		const newSet = new Set();
		for (const i of this.doc.selectedSlotIndices) {
			newSet.add(i > index ? i + 1 : i);
		}
		this.doc.selectedSlotIndices = newSet;
		if (this.doc.selectedSlotIndex !== null && this.doc.selectedSlotIndex > index) {
			this.doc.selectedSlotIndex += 1;
		}
		if (this.doc._slotAnchor !== null && this.doc._slotAnchor > index) {
			this.doc._slotAnchor += 1;
		}
		if (this.editingIndex !== null && this.editingIndex > index) {
			this.editingIndex += 1;
		}

		this.doc.editable.duplicateSequenceSlot(seq.name, index);
	}

	_deleteSlot(index) {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		// Compute the post-delete list locally so we can pick a new
		// primary from it before committing.
		const newFrames = seq.frames.slice();
		newFrames.splice(index, 1);

		// Remap the selection: drop the deleted index; shift the rest.
		const newSet = new Set();
		for (const i of this.doc.selectedSlotIndices) {
			if (i === index) continue;
			newSet.add(i > index ? i - 1 : i);
		}

		// Primary: shift if after the deletion; clear if it was the
		// deleted slot and let the promotion step below pick a new one.
		let newPrimary = this.doc.selectedSlotIndex;
		if (newPrimary !== null) {
			if (newPrimary === index)    newPrimary = null;
			else if (newPrimary > index) newPrimary -= 1;
		}

		// Ensure something is selected after the delete, matching the
		// frame and sequence lists.
		//   - If the set still has members, promote the lowest-indexed.
		//   - If the set is now empty but slots remain, pick the slot at
		//     the deleted index, or the new last slot if we removed the
		//     tail.
		if (newPrimary === null) {
			if (newSet.size > 0) {
				newPrimary = [...newSet].sort((a, b) => a - b)[0];
			} else if (newFrames.length > 0) {
				newPrimary = Math.min(index, newFrames.length - 1);
				newSet.add(newPrimary);
			}
		}

		this.doc.selectedSlotIndices = newSet;
		this.doc.selectedSlotIndex = newPrimary;

		// Anchor: shift with the deletion, or fall back to the new
		// primary if it was the deleted slot.
		if (this.doc._slotAnchor !== null) {
			if (this.doc._slotAnchor === index)    this.doc._slotAnchor = newPrimary;
			else if (this.doc._slotAnchor > index) this.doc._slotAnchor -= 1;
		}

		// Sync the frame selection to the new primary slot's frame.
		if (newPrimary !== null && newFrames[newPrimary]) {
			const newFrame = newFrames[newPrimary].frame;
			if (newFrame !== this.doc.primaryFrame) {
				this.doc.primaryFrame = newFrame;
				this.doc.selectedFrames = new Set([newFrame]);
				this.doc._frameAnchor = newFrame;
			}
		}

		// Close the editor if it was on the deleted slot; shift if after.
		if (this.editingIndex !== null) {
			if (this.editingIndex === index)    this._closeEditor();
			else if (this.editingIndex > index) this.editingIndex -= 1;
		}

		this.doc.editable.removeFrameFromSequence(seq.name, index);
	}

	// --- drag reorder -----------------------------------------------------

	_onDown(e) {
		if (e.button !== 0) return;

		if (e.target.closest && e.target.closest('.tl-tile-btn')) return;

		const tile = e.target.closest && e.target.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) {
			// Click on empty strip space: collapse a multi-selection down
			// to the primary, mirroring the frame-list behaviour on the
			// canvas. Plain left-click only.
			if (!e.shiftKey && !e.altKey) this._collapseMultiSelection();
			return;
		}

		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		e.preventDefault();
		const index = parseInt(tile.dataset.index, 10);

		const additive = e.ctrlKey || e.metaKey;
		const range    = e.shiftKey;

		this.doc.selectSlot(index, { additive, range });

		const selected = [...this.doc.selectedSlotIndices].sort((a, b) => a - b);
		if (selected.length === 0) return;
		const blockStart = selected[0];
		const blockEnd   = selected[selected.length - 1];

		this.drag = {
			blockStart,
			blockEnd,
			originalBlockStart: blockStart,
			originalBlockEnd:   blockEnd,
			working: seq.frames.map(s => ({
				frame: s.frame,
				transform: s.transform ? { ...s.transform } : null,
			})),
			moved: false,
			lastClientX: e.clientX,
			lastClientY: e.clientY,
			autoScrollRaf: null,
			autoScrollSpeed: 0,
		};

		const onMove = (ev) => this._onMove(ev);
		const onUp   = (ev) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup',   onUp);
			this._stopAutoScroll();
			this._onUp(ev);
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup',   onUp);

		tile.classList.add('dragging');
	}

	_collapseMultiSelection() {
		if (this.doc.selectedSlotIndices.size <= 1) return;
		const primary = this.doc.selectedSlotIndex;
		if (primary === null) return;
		this.doc.selectedSlotIndices = new Set([primary]);
		this.doc._slotAnchor = primary;
		this.doc.emit('selectionChanged', { changed: true });
	}

	_onMove(e) {
		if (!this.drag) return;
		this.drag.lastClientX = e.clientX;
		this.drag.lastClientY = e.clientY;
		this._handleDragMove();
		this._updateAutoScroll();
	}

	// Re-evaluate the drag against the current cursor position. Called
	// from both the mousemove handler and the auto-scroll rAF loop, since
	// the strip can move under a stationary cursor while scrolling.
	_handleDragMove() {
		const el = document.elementFromPoint(this.drag.lastClientX, this.drag.lastClientY);
		const tile = el && el.closest && el.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) return;

		const overIndex = parseInt(tile.dataset.index, 10);

		if (overIndex >= this.drag.blockStart && overIndex <= this.drag.blockEnd) return;

		let moved = false;
		let guard = 0;
		if (overIndex < this.drag.blockStart) {
			while (overIndex < this.drag.blockStart && guard++ < 64) {
				if (!this._shiftBlock(-1)) break;
				moved = true;
			}
		} else {
			while (overIndex > this.drag.blockEnd && guard++ < 64) {
				if (!this._shiftBlock(+1)) break;
				moved = true;
			}
		}

		if (moved) {
			this.drag.moved = true;
			this._renderFrames(this.drag.working);
		}
	}

	_onDoubleClick(e) {
		if (e.target.closest && e.target.closest('.tl-tile-btn')) return;
		const tile = e.target.closest && e.target.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) return;
		const index = parseInt(tile.dataset.index, 10);
		const seq = this.doc.getSelectedSequence();
		if (!seq || index < 0 || index >= seq.frames.length) return;
		const frameName = seq.frames[index].frame;
		if (frameName) this.viewport.focusFrame(frameName);
	}

	_shiftBlock(direction) {
		const w = this.drag.working;
		const { blockStart, blockEnd } = this.drag;

		if (direction < 0) {
			if (blockStart <= 0) return false;
			const item = w.splice(blockStart - 1, 1)[0];
			w.splice(blockEnd, 0, item);
			this.drag.blockStart -= 1;
			this.drag.blockEnd   -= 1;
		} else {
			if (blockEnd >= w.length - 1) return false;
			const item = w.splice(blockEnd + 1, 1)[0];
			w.splice(blockStart, 0, item);
			this.drag.blockStart += 1;
			this.drag.blockEnd   += 1;
		}
		return true;
	}

	// Trigger auto-scroll when the drag's cursor is near the strip's left
	// or right edge. Speed scales with how far into the edge zone the
	// cursor is: max at the very edge, zero at AUTOSCROLL_EDGE_PX away.
	_updateAutoScroll() {
		const rect = this.stripEl.getBoundingClientRect();
		const x = this.drag.lastClientX;
		let speed = 0;

		if (x < rect.left + AUTOSCROLL_EDGE_PX) {
			const t = Math.min(1, (rect.left + AUTOSCROLL_EDGE_PX - x) / AUTOSCROLL_EDGE_PX);
			speed = -Math.round(AUTOSCROLL_MAX_SPEED_PX * t);
		} else if (x > rect.right - AUTOSCROLL_EDGE_PX) {
			const t = Math.min(1, (x - (rect.right - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX);
			speed = Math.round(AUTOSCROLL_MAX_SPEED_PX * t);
		}

		this.drag.autoScrollSpeed = speed;

		if (speed !== 0 && this.drag.autoScrollRaf === null) {
			this._startAutoScrollLoop();
		} else if (speed === 0 && this.drag.autoScrollRaf !== null) {
			cancelAnimationFrame(this.drag.autoScrollRaf);
			this.drag.autoScrollRaf = null;
		}
	}

	_startAutoScrollLoop() {
		const step = () => {
			// Defensive: the loop can outlive the drag by one frame if
			// mouseup fires between the rAF scheduling and the callback.
			if (!this.drag || this.drag.autoScrollSpeed === 0) {
				if (this.drag) this.drag.autoScrollRaf = null;
				return;
			}

			const before = this.stripEl.scrollLeft;
			this.stripEl.scrollLeft = before + this.drag.autoScrollSpeed;
			const after = this.stripEl.scrollLeft;

			// Hit the scroll boundary. Keep the rAF alive so a direction
			// reversal resumes smoothly - the loop no-ops until the
			// cursor leaves the edge zone or reverses.
			if (before !== after) {
				// The strip moved under the cursor, so the tile the
				// cursor is over may have changed. Re-evaluate.
				this._handleDragMove();
			}

			this.drag.autoScrollRaf = requestAnimationFrame(step);
		};
		this.drag.autoScrollRaf = requestAnimationFrame(step);
	}

	_stopAutoScroll() {
		if (!this.drag) return;
		if (this.drag.autoScrollRaf !== null) {
			cancelAnimationFrame(this.drag.autoScrollRaf);
			this.drag.autoScrollRaf = null;
		}
		this.drag.autoScrollSpeed = 0;
	}

	// Map an old index to its new position given the block reorder. Slots
	// in the block shift by `shift`. Slots consumed from just before the
	// block (when moving up) land just after it, and vice versa.
	_translateIndex(i, bs, be, shift) {
		const L = be - bs + 1;
		if (i >= bs && i <= be) return i + shift;
		if (shift < 0 && i >= bs + shift && i < bs) return i + L;
		if (shift > 0 && i > be && i <= be + shift) return i - L;
		return i;
	}

	_onUp() {
		if (!this.drag) return;
		const {
			working, moved,
			blockStart, originalBlockStart, originalBlockEnd,
		} = this.drag;
		this.drag = null;

		if (!moved) {
			if (this.editingIndex !== null) this._renderEditor();
			this.render();
			return;
		}

		const seq = this.doc.getSelectedSequence();
		if (!seq) { this.render(); return; }

		const same = working.length === seq.frames.length &&
			working.every((s, i) => s.frame === seq.frames[i].frame);
		if (same) { this.render(); return; }

		const shift = blockStart - originalBlockStart;

		// Remap every index that tracked a specific slot.
		if (shift !== 0) {
			const newSet = new Set();
			for (const i of this.doc.selectedSlotIndices) {
				newSet.add(this._translateIndex(i, originalBlockStart, originalBlockEnd, shift));
			}
			this.doc.selectedSlotIndices = newSet;

			if (this.doc.selectedSlotIndex !== null) {
				this.doc.selectedSlotIndex = this._translateIndex(
					this.doc.selectedSlotIndex, originalBlockStart, originalBlockEnd, shift
				);
			}
			if (this.doc._slotAnchor !== null) {
				this.doc._slotAnchor = this._translateIndex(
					this.doc._slotAnchor, originalBlockStart, originalBlockEnd, shift
				);
			}
			if (this.editingIndex !== null) {
				this.editingIndex = this._translateIndex(
					this.editingIndex, originalBlockStart, originalBlockEnd, shift
				);
			}
		}

		this.doc.editable.setSequence(seq.name, { frames: working });

		// If the editor is still open, re-render so its title reflects the
		// new index. The content is unchanged; the fields already show the
		// correct values.
		if (this.editingIndex !== null) this._renderEditor();
	}
}
