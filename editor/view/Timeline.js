import { makeEmitter } from '../lib/emitter.js';
import { valueAdjuster } from '../lib/valueAdjuster.js';
import { applyIcon } from './toolIcons.js';

const THUMB_SIZE = 56;

// Horizontal strip of frame thumbnails for the selected sequence. Each
// tile carries a small toolbar for slot-level actions. Click a tile to
// select its frame; drag to reorder. The # button opens the slot
// transform editor, which expands the timeline upward over the canvas.
//
// Slot transforms are rendering-time only — they never touch the pixels
// or the frame rect. The same frame can appear multiple times in a
// sequence with different transforms, animating without duplicating
// artwork.
export class Timeline {
	constructor(root, doc, viewport) {
		makeEmitter(this);
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.drag = null;              // { index, working, moved, wasSelected } during a reorder
		this.editingIndex = null;      // index of the slot whose transform is open, or null
		this.selectedSlotIndex = null; // index of the last tile clicked in the timeline

		this._build();
		this._bind();

		doc.on('sheetChanged',     () => { this._closeEditor(); this.render(); });
		doc.on('selectionChanged', () => this._onSelectionChange());
		doc.on('edit',             () => this._onEdit());

		this.render();
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="tl-header">
				<span class="tl-title">Timeline</span>
				<span class="tl-hint">drag to reorder · click to select</span>
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
		this.root.querySelector('.tl-editor-close')
			.addEventListener('click', () => this._closeEditor());
		this.editorResetBtn
			.addEventListener('click', () => this._resetSlotTransform());
		for (const btn of this.root.querySelectorAll('.tl-editor-pivot-btn')) {
			btn.addEventListener('click', () => this._applyPivotPreset(btn.dataset.pivot));
		}

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.editingIndex !== null) this._closeEditor();
		});
	}

	// --- rendering --------------------------------------------------------

	render() {
		if (this.drag) return;  // don't clobber during drag
		this._renderFrames(null);
	}

	_renderFrames(workingList) {
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
			if (this.drag && i === this.drag.index) tile.classList.add('dragging');
			this.stripEl.appendChild(tile);
		});
	}

	_makeTile(slot, index, sheet, seq) {
		const frameName = slot.frame;
		const frame = sheet.frames[frameName];

		const tile = document.createElement('div');
		tile.className = 'tl-tile';
		const isSelectedFrame = frameName === this.doc.selectedFrame;
		const isPrimarySlot   = isSelectedFrame && this.selectedSlotIndex === index;
		if (isPrimarySlot)       tile.classList.add('selected');
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

		// Toolbar: transform for now; clone and delete land in a later
		// pass using the same shape.
		const toolbar = document.createElement('div');
		toolbar.className = 'tl-tile-toolbar';

		const tBtn = document.createElement('button');
		tBtn.className = 'tl-tile-btn';
		tBtn.dataset.icon = 'slot-transform';
		tBtn.textContent = '#';   // fallback until the icon sheet loads
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

		// Fit base dimensions.
		let scale = Math.min(availW / frame.width, availH / frame.height);
		if (scale >= 1) scale = Math.floor(scale);

		// Translate to the tile's centre, apply transform, then draw the
		// frame anchored at its origin so the transform pivots correctly.
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
		const index = this.editingIndex;
		if (!seq || index === null || index >= seq.frames.length) return;

		const slot = seq.frames[index];
		const frame = this.doc.sheet.frames[slot.frame];
		const defX = frame ? frame.centerx : 0;
		const defY = frame ? frame.centery : 0;

		const t = slot.transform || {
			translateX: 0, translateY: 0, rotation: 0,
			scaleX: 1, scaleY: 1,
			pivotX: defX, pivotY: defY,
		};

		this.editorTitleEl.textContent = `Slot ${index}: ${slot.frame}`;
		this.editorFieldsEl.innerHTML = '';

		const fields = [
			{ key: 'translateX', label: 'Translate X', step: 0.5, default: 0 },
			{ key: 'translateY', label: 'Translate Y', step: 0.5, default: 0 },
			{ key: 'rotation',   label: 'Rotation °',  step: 1,   default: 0 },
			{ key: 'scaleX',     label: 'Scale X',     step: 0.1, default: 1 },
			{ key: 'scaleY',     label: 'Scale Y',     step: 0.1, default: 1 },
			{ key: 'pivotX',     label: 'Pivot X',     step: 0.5, default: defX },
			{ key: 'pivotY',     label: 'Pivot Y',     step: 0.5, default: defY },
		];

		for (const f of fields) {
			const cell = document.createElement('div');
			cell.className = 'tl-editor-field';

			const label = document.createElement('span');
			label.className = 'insp-label';
			label.textContent = f.label;
			cell.appendChild(label);

			const visible = document.createElement('input');
			visible.type = 'number';
			visible.className = 'tl-editor-num';
			visible.step = String(f.step);
			visible.value = t[f.key] !== undefined ? t[f.key] : f.default;
			cell.appendChild(visible);

			const raw = document.createElement('input');
			raw.type = 'number';
			raw.step = String(f.step);
			raw.value = visible.value;
			cell.appendChild(raw);

			this.editorFieldsEl.appendChild(cell);

			valueAdjuster(raw, {
				stepSize: f.step,
				displayElement: visible,
				onAdjust: (v) => {
					const num = Number.isFinite(v) ? v : f.default;
					this.doc.editable.setSlotTransform(
						seq.name, index,
						{ [f.key]: num }
					);
				},
			});
		}

		this.editorResetBtn.disabled = !slot.transform;
	}

	_resetSlotTransform() {
		const seq = this.doc.getSelectedSequence();
		const index = this.editingIndex;
		if (!seq || index === null) return;
		this.doc.editable.setSlotTransform(seq.name, index, null);
	}

	_applyPivotPreset(which) {
		const seq = this.doc.getSelectedSequence();
		const index = this.editingIndex;
		if (!seq || index === null) return;

		const slot = seq.frames[index];
		const frame = this.doc.sheet.frames[slot.frame];
		if (!frame) return;

		let px, py;
		if (which === 'origin') {
			px = frame.centerx;
			py = frame.centery;
		} else if (which === 'centre') {
			px = frame.width  / 2;
			py = frame.height / 2;
		} else return;

		this.doc.editable.setSlotTransform(seq.name, index, {
			pivotX: px, pivotY: py,
		});
	}

	_onSelectionChange() {
		const seq = this.doc.getSelectedSequence();
		const selectedFrame = this.doc.selectedFrame;

		// Close the editor if the selected sequence changed or shrank
		// past the slot we were editing.
		if (this.editingIndex !== null) {
			if (!seq || this.editingIndex >= seq.frames.length) {
				this._closeEditor();
			}
		}

		// Reconcile the timeline's slot hint with the current frame
		// selection. If the tracked slot no longer matches, forget it;
		// then, if the selected frame appears in the sequence, promote
		// its first occurrence to the primary slot.
		//
		// This keeps a bright highlight visible whenever the current
		// frame is in the sequence, regardless of where the selection
		// came from — timeline, sequence inspector, frame list, or
		// canvas.
		if (this.selectedSlotIndex !== null) {
			const slot = seq && seq.frames[this.selectedSlotIndex];
			if (!slot || slot.frame !== selectedFrame) {
				this.selectedSlotIndex = null;
			}
		}
		if (this.selectedSlotIndex === null && seq && selectedFrame) {
			const idx = seq.frames.findIndex(s => s.frame === selectedFrame);
			if (idx !== -1) this.selectedSlotIndex = idx;
		}

		this.render();
	}

	_onEdit() {
		// Slot data may have changed underneath us (transform edited here,
		// reorder via the inspector, undo). Re-render the editor fields
		// and the strip.
		if (this.editingIndex !== null) this._renderEditor();
		this.render();
	}

	// --- drag reorder -----------------------------------------------------

	_onDown(e) {
		if (e.button !== 0) return;

		// Clicking a toolbar button shouldn't start a drag.
		if (e.target.closest && e.target.closest('.tl-tile-btn')) return;

		const tile = e.target.closest && e.target.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) return;

		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		e.preventDefault();
		const index = parseInt(tile.dataset.index, 10);
		this.selectedSlotIndex = index;

		const wasSelected = this.doc.selectedFrame === seq.frames[index].frame;

		this.drag = {
			index,
			working: seq.frames.map(s => ({
				frame: s.frame,
				transform: s.transform ? { ...s.transform } : null,
			})),
			moved: false,
			wasSelected,
		};

		this.doc.selectFrame(seq.frames[index].frame);

		const onMove = (ev) => this._onMove(ev);
		const onUp   = (ev) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup',   onUp);
			this._onUp(ev);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup',   onUp);

		tile.classList.add('dragging');
	}

	_onMove(e) {
		if (!this.drag) return;
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const tile = el && el.closest && el.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) return;

		const overIndex = parseInt(tile.dataset.index, 10);
		if (overIndex === this.drag.index) return;

		const [item] = this.drag.working.splice(this.drag.index, 1);
		this.drag.working.splice(overIndex, 0, item);
		this.drag.index = overIndex;
		this.drag.moved = true;

		this._renderFrames(this.drag.working);
	}

	_onUp() {
		if (!this.drag) return;
		const { working, moved, wasSelected, index } = this.drag;
		const slotName = working[index] ? working[index].frame : null;
		this.drag = null;

		if (!moved) {
			if (wasSelected || !this.viewport.sheetFits) {
				if (slotName) this.viewport.focusFrame(slotName);
			}
			// If the transform editor is open, follow the click to the
			// newly-selected slot.
			if (this.editingIndex !== null && this.editingIndex !== index) {
				this._openEditor(index);
			}
			this.render();
			return;
		}

		// Reordering shifts indices; the editor's slot index no longer
		// points at the same thing. Close it rather than trying to
		// track the moved slot.
		if (this.editingIndex !== null) this._closeEditor();

		const seq = this.doc.getSelectedSequence();
		if (!seq) { this.render(); return; }

		// Compare on frame names only — slot order, not transforms.
		const same = working.length === seq.frames.length &&
			working.every((s, i) => s.frame === seq.frames[i].frame);
		if (same) { this.render(); return; }

		this.doc.editable.setSequence(seq.name, { frames: working });
	}
}
