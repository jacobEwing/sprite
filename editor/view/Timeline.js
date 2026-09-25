import { makeEmitter } from '../lib/emitter.js';

const THUMB_SIZE = 56;

// Horizontal strip of frame thumbnails for the selected sequence. Click a
// tile to select that frame; drag to reorder. Drag interactions are
// committed as a single setSequence command on release, so one drag is one
// undo step.
export class Timeline {
	constructor(root, doc, viewport) {
		makeEmitter(this);
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.drag = null;  // { index, working, moved } while dragging
		this._listeners = null;

		this.root.innerHTML = `
			<div class="tl-header">
				<span class="tl-title">Timeline</span>
				<span class="tl-hint">drag to reorder · click to select</span>
			</div>
			<div class="tl-strip"></div>
		`;
		this.stripEl = this.root.querySelector('.tl-strip');

		doc.on('sheetChanged',     () => this.render());
		doc.on('selectionChanged', () => this.render());
		doc.on('edit',             () => this.render());

		this.stripEl.addEventListener('mousedown', (e) => this._onDown(e));
		this.render();
	}

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

		const frames = workingList || seq.frames;
		if (frames.length === 0) {
			this.stripEl.innerHTML = '<div class="tl-empty">This sequence has no frames.</div>';
			return;
		}

		frames.forEach((frameName, i) => {
			const tile = this._makeTile(frameName, i, sheet);
			if (this.drag && i === this.drag.index) tile.classList.add('dragging');
			this.stripEl.appendChild(tile);
		});
	}

	_makeTile(frameName, index, sheet) {
		const frame = sheet.frames[frameName];
		const tile = document.createElement('div');
		tile.className = 'tl-tile';
		if (frameName === this.doc.selectedFrame) tile.classList.add('selected');
		tile.dataset.index = index;
		tile.dataset.frame = frameName;

		const canvas = document.createElement('canvas');
		canvas.width = THUMB_SIZE;
		canvas.height = THUMB_SIZE;
		canvas.className = 'tl-thumb';
		if (frame) this._drawThumb(canvas, sheet, frame);
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

		return tile;
	}

	_drawThumb(canvas, sheet, frame) {
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const pad = 2;
		const availW = canvas.width - pad * 2;
		const availH = canvas.height - pad * 2;
		let scale = Math.min(availW / frame.width, availH / frame.height);
		if (scale >= 1) scale = Math.floor(scale);
		const dw = frame.width * scale;
		const dh = frame.height * scale;
		const dx = Math.floor((canvas.width - dw) / 2);
		const dy = Math.floor((canvas.height - dh) / 2);
		ctx.drawImage(sheet.image,
			frame.x, frame.y, frame.width, frame.height,
			dx, dy, dw, dh);
	}

	// --- drag -----------------------------------------------------------

	_onDown(e) {
		if (e.button !== 0) return;
		const tile = e.target.closest && e.target.closest('.tl-tile');
		if (!tile || !this.stripEl.contains(tile)) return;

		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		e.preventDefault();
		const index = parseInt(tile.dataset.index, 10);

		// Select without focus: if the user is about to drag, we don't want
		// the camera moving mid-gesture. If they release without moving,
		// _onUp applies the focus rule.
		const wasSelected = this.doc.selectedFrame === seq.frames[index];

		this.drag = {
			index,
			name: seq.frames[index],
			working: seq.frames.slice(),
			moved: false,
			wasSelected,
		};

		this.doc.selectFrame(seq.frames[index]);

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

		// Move the dragged item to the new index in the working list.
		const [item] = this.drag.working.splice(this.drag.index, 1);
		this.drag.working.splice(overIndex, 0, item);
		this.drag.index = overIndex;
		this.drag.moved = true;

		this._renderFrames(this.drag.working);
	}

	_onUp() {
		if (!this.drag) return;
		const { name, working, moved, wasSelected } = this.drag;
		this.drag = null;

		if (!moved) {
			// Click without drag. Apply the focus rule directly — the frame
			// is already selected from mousedown, so we don't need to go
			// through the document again.
			if (wasSelected || !this.viewport.sheetFits) {
				this.viewport.focusFrame(name);
			}
			this.render();
			return;
		}

		const seq = this.doc.getSelectedSequence();
		if (!seq) { this.render(); return; }

		const same = working.length === seq.frames.length &&
			working.every((f, i) => f === seq.frames[i]);
		if (same) { this.render(); return; }

		this.doc.editable.setSequence(seq.name, { frames: working });
	}
}
