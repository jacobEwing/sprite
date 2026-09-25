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
		this.rafId = null;
		this.lastTime = 0;

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
				<span class="preview-status">—</span>
			</div>
		`;
		this.canvas = this.root.querySelector('.preview-canvas');
		this.ctx = this.canvas.getContext('2d');
		this.statusEl = this.root.querySelector('.preview-status');
		this.toggleBtn = this.root.querySelector('.preview-toggle');

		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = CANVAS_SIZE * dpr;
		this.canvas.height = CANVAS_SIZE * dpr;
		this.canvas.style.width = CANVAS_SIZE + 'px';
		this.canvas.style.height = CANVAS_SIZE + 'px';
		this.dpr = dpr;

		this.toggleBtn.addEventListener('click', () => this._togglePlay());
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

		this._fitScale();
		this._recompute();
	}

	_fitScale() {
		if (!this.sprite) return;
		const sheet = this.doc.sheet;
		const fw = sheet.frameWidth || sheet.imageWidth || 1;
		const fh = sheet.frameHeight || sheet.imageHeight || 1;
		const avail = CANVAS_SIZE - 20;
		let scale = Math.min(avail / fw, avail / fh);
		if (scale >= 1) scale = Math.max(1, Math.floor(scale));
		else scale = Math.max(0.25, scale);
		this.sprite.setScale(scale);
	}

	// Central dispatch: decide what the preview should be showing, and
	// make it so. Called whenever anything relevant changes — selection,
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

		// Validity: the frame must exist in the sheet, and — if it was
		// chosen from the sequence — must still be a member of it.
		let frameName = this.staticFrameName;
		const inSheet = !!frameName && !!this.doc.sheet.frames[frameName];
		const inSeq = !this.staticFrameFollowsSequence
			|| !seq
			|| seq.frames.includes(frameName);

		if (!frameName || !inSheet || !inSeq) {
			// Fallback chain. Track which source supplied the replacement
			// so the follow flag stays accurate for the *next* edit.
			if (seq && seq.frames.length > 0) {
				frameName = seq.frames[0];
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
		if (!this.sprite) return;

		if (!this.playing) {
			if (info.sequence !== undefined) {
				const seq = this.doc.sheet.sequences[info.sequence];
				this.staticFrameName = (seq && seq.frames[0]) || null;
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
			    !seq.frames.includes(this.staticFrameName)) {
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

		const cw = CANVAS_SIZE;
		const ch = CANVAS_SIZE;
		const scale = this.sprite.scale;
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
			this.statusEl.textContent = '—';
			return;
		}
		const name = this.sprite.frameName;
		const seqName = this.sprite.sequenceName;
		if (!seqName) {
			this.statusEl.textContent = name;
			return;
		}
		const seq = this.doc.sheet.sequences[seqName];
		if (!seq) { this.statusEl.textContent = name; return; }
		const idx = seq.frames.indexOf(name);
		this.statusEl.textContent = idx >= 0
			? `${name}  ${idx + 1}/${seq.frames.length}`
			: name;
	}
}
