// Small live preview of the selected sequence, driven by the same Sprite
// runtime the game uses. Rebuilds its sprite when the sheet changes;
// otherwise the getters on Sprite (frame, image) keep it in sync with edits.
//
// If no sequence is selected, draws the currently-selected frame statically.

const CANVAS_SIZE = 160;

export class SpritePreview {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.sprite = null;
		this.playing = true;
		this.staticFrameName = null;
		this.staticFrameFollowsSequence = false;
		this.loopAnyway = false;
		this.rafId = null;
		this.lastTime = 0;
		this.loopAnyway = false;

		this._build();
		doc.on('sheetChanged', () => this._rebuild());
		doc.on('selectionChanged', (info) => this._onSelectionChange(info));
		doc.on('edit', () => this._onEdit());
	}

	_build() {
		this.root.innerHTML = `
			<div class="preview-canvas-wrap">
				<canvas class="preview-canvas"></canvas>
			</div>
			<div class="preview-controls">
				<button class="preview-toggle" title="Play / pause">⏸</button>
				<label class="preview-loop" title="Restart when the sequence finishes">
					<input type="checkbox" class="preview-loop-input"> Loop
				</label>
				<span class="preview-status">-</span>
			</div>
		`;
		this.canvas = this.root.querySelector('.preview-canvas');
		this.ctx = this.canvas.getContext('2d');
		this.statusEl = this.root.querySelector('.preview-status');

		this.toggleBtn = this.root.querySelector('.preview-toggle');
		this.toggleBtn.addEventListener('click', () => this._togglePlay());

		this.loopInput = this.root.querySelector('.preview-loop-input');
		this.loopInput.checked = this.loopAnyway;
		this.loopInput.addEventListener('change', () => {
			this.loopAnyway = this.loopInput.checked;
		});

		const dpr = window.devicePixelRatio || 1;
		this.dpr = dpr;
		this.canvas.width = CANVAS_SIZE * dpr;
		this.canvas.height = CANVAS_SIZE * dpr;
		this.canvas.style.width = CANVAS_SIZE + 'px';
		this.canvas.style.height = CANVAS_SIZE + 'px';
	}

	// --- lifecycle --------------------------------------------------------

	_rebuild() {
		this._stopLoop();
		this.sprite = null;

		const sheet = this.doc.sheet;
		if (!sheet || !sheet.ready) { this._draw(); return; }

		try {
			this.sprite = sheet.newSprite();
		} catch (err) {
			console.warn('Preview: could not create sprite:', err.message);
			this.sprite = null;
			this._draw();
			return;
		}

		this._recompute();
	}

	// Central dispatch: decide what the preview should be showing, and
	// make it so. Called whenever anything relevant changes - selection,
	// playback state, or an edit.
	_recompute() {
		if (!this.sprite) return;

		const seqName = this.doc.selectedSequence;
		const seq = seqName ? this.doc.sheet.sequences[seqName] : null;
		const hasSequence = seq && seq.frames.length > 0;

		if (this.playing && hasSequence) {
			if (this.sprite.sequenceName !== seqName) {
				this.sprite.play(seqName);
			}
			if (!this.rafId) this._startLoop();
			return;
		}

		this._stopLoop();
		if (this.sprite.sequenceName) this.sprite.stop();

		const slotIdx = this.doc.selectedSlotIndex;
		if (seq && slotIdx !== null && slotIdx >= 0 && slotIdx < seq.frames.length) {
			const slot = seq.frames[slotIdx];
			if (this.doc.sheet.frames[slot.frame]) {
				this.sprite.setSlot(slot);
				this._draw();
				this._updateStatus();
				return;
			}
		}

		// Fall back: static frame based on the document's frame selection.
		let frameName = this.staticFrameName;
		const inSheet = !!frameName && !!this.doc.sheet.frames[frameName];
		const inSeq = !this.staticFrameFollowsSequence || !seq
			|| seq.frames.some(s => s.frame === frameName);

		if (!frameName || !inSheet || !inSeq) {
			if (seq && seq.frames.length > 0) {
				frameName = seq.frames[0].frame;
				this.staticFrameFollowsSequence = true;
			} else if (this.doc.selectedFrame && this.doc.sheet.frames[this.doc.selectedFrame]) {
				frameName = this.doc.selectedFrame;
				this.staticFrameFollowsSequence = false;
			} else if (this.doc.sheet.frameNames.length > 0) {
				frameName = this.doc.sheet.frameNames[0];
				this.staticFrameFollowsSequence = false;
			} else {
				frameName = null;
				this.staticFrameFollowsSequence = false;
			}
			this.staticFrameName = frameName;
		}

		if (frameName) this.sprite.setFrame(frameName);
		else           this.sprite.clearFrame();

		this._draw();
		this._updateStatus();
	}

	_onSelectionChange(info = {}) {
		if (!this.playing) {
			if (info.sequence !== undefined) {
				const seq = this.doc.sheet.sequences[info.sequence];
				this.staticFrameName = (seq && seq.frames[0]?.frame) || null;
				this.staticFrameFollowsSequence = true;
			} else if (info.frame !== undefined) {
				this.staticFrameName = info.frame;
				this.staticFrameFollowsSequence = false;
			}
		}
		this._recompute();
	}

	// Edits made through the inspector or undo are reflected via the live
	// getters on Sprite, so we only need to redraw. A stopped preview with
	// no sequence needs its static frame re-resolved in case the selected
	// frame was deleted or renamed.
	_onEdit(info) {
		if (!this.sprite) return;

		// When paused and viewing a sequence, if the frame we're showing is
		// removed from that sequence, clear it so _recompute picks a fresh
		// frame from the same sequence.
		if (!this.playing && info && info.type === 'sequenceUpdated' &&
		    info.name === this.doc.selectedSequence) {
			const seq = this.doc.sheet.sequences[this.doc.selectedSequence];
			if (seq && this.staticFrameName &&
			    !seq.frames.some(s => s.frame === this.staticFrameName)) {
				this.staticFrameName = null;
			}
		}

		this._recompute();
	}

	_togglePlay() {
		this.playing = !this.playing;
		this.toggleBtn.textContent = this.playing ? '⏸' : '▶';

		if (this.playing) {
			// Starting playback: let the sequence drive the frame again.
			this.staticFrameName = null;
		} else {
			this.staticFrameName = this.sprite ? this.sprite.frameName : null;
			this.staticFrameFollowsSequence = !!(this.sprite && this.sprite.sequenceName);
		}
		this._recompute();
	}

	_startLoop() {
		if (this.rafId || !this.sprite) return;
		if (!this.sprite.sequenceName) return;   // nothing to animate
		this.lastTime = 0;
		this.rafId = requestAnimationFrame((t) => this._loop(t));
	}

	_stopLoop() {
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.rafId = null;
		this.lastTime = 0;
	}

	_loop(time) {
		this.rafId = null;
		if (!this.playing || !this.sprite || !this.sprite.sequenceName) return;

		const dt = this.lastTime ? Math.min(time - this.lastTime, 100) : 16;
		this.lastTime = time;

		this.sprite.update(dt);
		this._draw();
		this._updateStatus();

		// A finite sequence has finished: the runtime clears sequenceName.
		if (!this.sprite.sequenceName) {
			if (this.loopAnyway) {
				const seqName = this.doc.selectedSequence;
				const seq = seqName ? this.doc.sheet.sequences[seqName] : null;
				if (seq && seq.frames.length > 0) {
					this.sprite.play(seqName);
					this.lastTime = 0;
					this.rafId = requestAnimationFrame((t) => this._loop(t));
					return;
				}
			}
			// No loop, no restart: flip the button to "play" so the user
			// knows the animation completed rather than is paused.
			this.playing = false;
			this.toggleBtn.textContent = '▶';
			return;
		}

		this.rafId = requestAnimationFrame((t) => this._loop(t));
	}

	// --- drawing ----------------------------------------------------------

	_draw() {
		const w = this.canvas.width;
		const h = this.canvas.height;
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, w, h);
		this.ctx.scale(this.dpr, this.dpr);
		this.ctx.imageSmoothingEnabled = false;

		if (!this.sprite) return;
		const frame = this.sprite.frame;
		if (!frame) return;

		// Fit to the current frame's dimensions, recomputed every draw.
		// Recomputing here rather than caching in _fitScale() means a
		// change to a frame's size, or a switch to a differently-sized
		// frame, is reflected immediately.
		const avail = CANVAS_SIZE - 20;
		let scale = Math.min(avail / frame.width, avail / frame.height);
		if (scale >= 1) scale = Math.max(1, Math.floor(scale));
		else scale = Math.max(0.25, scale);
		this.sprite.setScale(scale);

		const cw = CANVAS_SIZE;
		const ch = CANVAS_SIZE;
		const fw = frame.width * scale;
		const fh = frame.height * scale;

		// Position the sprite so that the frame rect lands centered,
		// regardless of where the origin sits within it.
		const originScreenX = (cw - fw) / 2 + frame.centerx * scale;
		const originScreenY = (ch - fh) / 2 + frame.centery * scale;

		this.sprite.position.x = originScreenX / scale;
		this.sprite.position.y = originScreenY / scale;

		this.sprite.draw(this.ctx);
	}

	_updateStatus() {
		if (!this.sprite || !this.sprite.frameName) {
			this.statusEl.textContent = '-';
			return;
		}
		const name = this.sprite.frameName;
		const seqName = this.sprite.sequenceName;
		if (!seqName) {
			// Paused / static: read the position from the document's
			// slot selection, which is what a paused preview shows.
			const seq = this.doc.selectedSequence
				? this.doc.sheet.sequences[this.doc.selectedSequence]
				: null;
			const slotIdx = this.doc.selectedSlotIndex;
			if (seq && slotIdx !== null && seq.frames[slotIdx]) {
				this.statusEl.textContent =
					`${name}  ${slotIdx + 1}/${seq.frames.length}`;
				return;
			}
			this.statusEl.textContent = name;
			return;
		}
		// Playing: read the runtime's current slot index, so a frame
		// that appears more than once in the sequence shows the position
		// the animation is actually on.
		const seq = this.doc.sheet.sequences[seqName];
		if (!seq) { this.statusEl.textContent = name; return; }
		const idx = this.sprite.frameIndex;
		this.statusEl.textContent = idx >= 0 && idx < seq.frames.length
			? `${name}  ${idx + 1}/${seq.frames.length}`
			: name;
	}
}
