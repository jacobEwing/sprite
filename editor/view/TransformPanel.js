import { PaintCommand } from '../history/PaintCommand.js';
import {
	rotate90CW, rotate90CCW,
	flipVertical, flipHorizontal,
	translateWrapped, rotateArbitrary,
} from '../model/transforms.js';

// Sidebar panel for pixel transforms, rendered inside the Modifiers tab.
//
// Three sections:
//   Rotate    — arbitrary angle with pivot, plus 90° CW/CCW buttons
//   Flip      — vertical and horizontal
//   Translate — four directions
//
// The arbitrary rotation is a preview-based operation: move the slider,
// see the result, Apply to commit. The 90°, flip, and translate buttons
// are instant — one click, one undo entry.
//
// Preview semantics match FilterPanel. Preview lives on the viewport
// overlay stack.

export class TransformPanel {
	constructor(root, doc, viewport, options = {}) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.onTransform = options.onTransform || null;

		this.active = false;
		this._overlayToken = null;

		this.angle = 0;
		this.pivotX = 0;
		this.pivotY = 0;

		this._previewStale = false;

		this.previewImageData = null;
		this.previewFrame = null;
		this._pending = null;

		this._build();
		this._bind();
		this._sync();

		doc.on('selectionChanged',  () => this._onTargetChange());
		doc.on('selectionModified', () => this._onTargetChange());
		doc.on('sheetChanged',      () => this._onTargetChange());
		doc.on('edit',              () => { if (this.active) this._schedule(); });
	}

	// --- lifecycle --------------------------------------------------------

	activate() {
		this.active = true;
		this._overlayToken = this.viewport.addOverlay((ctx) => this._drawPreview(ctx));
		const rect = this.doc.currentOpRect();
		if (rect) {
			this.pivotX = rect.w / 2;
			this.pivotY = rect.h / 2;
		} else {
			this.pivotX = 0;
			this.pivotY = 0;
		}
		this._sync();
		this._schedule();
	}

	deactivate() {
		this.active = false;
		if (this._pending) {
			cancelAnimationFrame(this._pending);
			this._pending = null;
		}
		if (this._overlayToken) {
			this.viewport.removeOverlay(this._overlayToken);
			this._overlayToken = null;
		}
		this.previewImageData = null;
		this.previewFrame = null;
	}

	_onTargetChange() {
		if (!this.active) return;
		this._previewStale = false;
		this._syncHint();
		this._schedule();
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="fp-body">
				<div class="tsp-section-label">Rotate</div>
				<div class="fp-row">
					<span class="fp-label">Angle</span>
					<input type="range" class="tsp-angle" min="-180" max="180" step="1" value="0">
					<span class="rc-readout tsp-angle-readout">0°</span>
				</div>
				<div class="fp-row">
					<span class="fp-label"></span>
					<input type="number" class="tsp-angle-num" min="-360" max="360" step="1" value="0">
				</div>

				<div class="tsp-subsection">
					<div class="fp-label">Pivot</div>
					<div class="tsp-pivot-inputs">
						<input type="number" class="tsp-pivot-x" step="0.5">
						<input type="number" class="tsp-pivot-y" step="0.5">
					</div>
					<div class="tsp-pivot-presets">
						<button type="button" class="tsp-preset-btn" data-preset="selection">Selection centre</button>
						<button type="button" class="tsp-preset-btn" data-preset="frame">Frame centre</button>
					</div>
				</div>

				<button type="button" class="tsp-apply-rotation">Apply rotation</button>

				<div class="tsp-action-row">
					<button type="button" class="tsp-btn" data-action="rotate-ccw" title="Rotate 90° CCW">↺ 90°</button>
					<button type="button" class="tsp-btn" data-action="rotate-cw"  title="Rotate 90° CW">90° ↻</button>
				</div>

				<div class="tsp-section-label">Flip</div>
				<div class="tsp-action-row">
					<button type="button" class="tsp-btn" data-action="flip-v" title="Flip vertical">Vertical</button>
					<button type="button" class="tsp-btn" data-action="flip-h" title="Flip horizontal">Horizontal</button>
				</div>

				<div class="tsp-section-label">Translate</div>
				<div class="tsp-translate-grid">
					<button type="button" class="tsp-btn tsp-dir" data-action="move-up"    title="Move up">↑</button>
					<button type="button" class="tsp-btn tsp-dir" data-action="move-left"  title="Move left">←</button>
					<button type="button" class="tsp-btn tsp-dir" data-action="move-down"  title="Move down">↓</button>
					<button type="button" class="tsp-btn tsp-dir" data-action="move-right" title="Move right">→</button>
				</div>

				<p class="fp-hint tsp-hint"></p>
			</div>
			<div class="fp-footer">
				<button class="fp-reset">Reset</button>
				<button class="fp-apply primary">Apply</button>
			</div>
		`;

		this.angleSlider = this.root.querySelector('.tsp-angle');
		this.angleNum    = this.root.querySelector('.tsp-angle-num');
		this.angleRead   = this.root.querySelector('.tsp-angle-readout');
		this.pivotXIn    = this.root.querySelector('.tsp-pivot-x');
		this.pivotYIn    = this.root.querySelector('.tsp-pivot-y');
		this.hintEl      = this.root.querySelector('.tsp-hint');
	}

	_bind() {
		this.angleSlider.addEventListener('input', () =>
			this._setAngle(parseFloat(this.angleSlider.value) || 0));
		this.angleNum.addEventListener('input', () =>
			this._setAngle(parseFloat(this.angleNum.value) || 0));

		this.pivotXIn.addEventListener('input', () => {
			this.pivotX = parseFloat(this.pivotXIn.value) || 0;
			this._sync();
			this._onControlChange();
		});
		this.pivotYIn.addEventListener('input', () => {
			this.pivotY = parseFloat(this.pivotYIn.value) || 0;
			this._sync();
			this._onControlChange();
		});

		for (const btn of this.root.querySelectorAll('.tsp-preset-btn')) {
			btn.addEventListener('click', () => this._applyPreset(btn.dataset.preset));
		}

		this.root.querySelector('.tsp-apply-rotation')
			.addEventListener('click', () => this._applyRotation());

		for (const btn of this.root.querySelectorAll('.tsp-btn')) {
			btn.addEventListener('click', () => this._instantAction(btn.dataset.action));
		}

		this.root.querySelector('.fp-reset').addEventListener('click', () => this._resetControls());
		this.root.querySelector('.fp-apply').addEventListener('click', () => this._applyRotation());
	}

	_setAngle(deg) {
		this.angle = clampAngle(deg);
		this._sync();
		this._onControlChange();
	}

	_onControlChange() {
		this._previewStale = false;
		this._schedule();
	}

	_resetControls() {
		this.angle = 0;
		const rect = this.doc.currentOpRect();
		if (rect) {
			this.pivotX = rect.w / 2;
			this.pivotY = rect.h / 2;
		}
		this._sync();
		this._onControlChange();
	}

	_sync() {
		if (document.activeElement !== this.angleSlider) {
			const wrapped = ((this.angle + 180) % 360 + 360) % 360 - 180;
			this.angleSlider.value = wrapped;
		}
		if (document.activeElement !== this.angleNum) this.angleNum.value = this.angle;
		this.angleRead.textContent = this.angle + '°';

		if (document.activeElement !== this.pivotXIn) this.pivotXIn.value = this.pivotX;
		if (document.activeElement !== this.pivotYIn) this.pivotYIn.value = this.pivotY;

		this._syncHint();
	}

	_syncHint() {
		this.hintEl.textContent = this._previewStale
			? 'Applied. Adjust the rotation controls to preview again.'
			: 'Rotation previews on the selection, or the current frame.';
	}

	_applyPreset(which) {
		const rect = this.doc.currentOpRect();
		if (!rect) return;
		if (which === 'selection') {
			this.pivotX = rect.w / 2;
			this.pivotY = rect.h / 2;
		} else if (which === 'frame') {
			const frame = this.doc.getSelectedFrame();
			if (!frame) return;
			this.pivotX = frame.x + frame.centerx - rect.x;
			this.pivotY = frame.y + frame.centery - rect.y;
		}
		this._sync();
		this._onControlChange();
	}

	// --- instant actions --------------------------------------------------

	_instantAction(action) {
		const map = {
			'rotate-cw':  ['Rotated 90° CW',       rotate90CW],
			'rotate-ccw': ['Rotated 90° CCW',      rotate90CCW],
			'flip-v':     ['Flipped vertical',     flipVertical],
			'flip-h':     ['Flipped horizontal',   flipHorizontal],
			'move-up':    ['Moved up',    (d) => translateWrapped(d,  0, -1)],
			'move-down':  ['Moved down',  (d) => translateWrapped(d,  0,  1)],
			'move-left':  ['Moved left',  (d) => translateWrapped(d, -1,  0)],
			'move-right': ['Moved right', (d) => translateWrapped(d,  1,  0)],
		};
		const entry = map[action];
		if (!entry) return;

		this._previewStale = true;
		this.previewImageData = null;
		this.previewFrame = null;
		this._syncHint();
		this.viewport.invalidate();

		if (this.onTransform) this.onTransform(entry[0], entry[1]);
	}

	// --- arbitrary rotation preview & apply -------------------------------

	_schedule() {
		if (this._pending) return;
		this._pending = requestAnimationFrame(() => {
			this._pending = null;
			this._recompute();
		});
	}

	_recompute() {
		if (!this.active) return;

		if (this._previewStale || this.angle === 0) {
			this.previewImageData = null;
			this.previewFrame = null;
			this.viewport.invalidate();
			return;
		}

		const sheet = this.doc.sheet;
		const rect = this.doc.currentOpRect();
		if (!sheet || !rect) {
			this.previewImageData = null;
			this.previewFrame = null;
			this.viewport.invalidate();
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const src = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const result = rotateArbitrary(src, this.angle, this.pivotX, this.pivotY);

		this.previewImageData = result;
		this.previewFrame = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

		if (!this.offscreen) {
			this.offscreen = document.createElement('canvas');
			this.offscreenCtx = this.offscreen.getContext('2d');
		}
		this.offscreen.width  = result.width;
		this.offscreen.height = result.height;
		this.offscreenCtx.putImageData(result, 0, 0);

		this.viewport.invalidate();
	}

	_drawPreview(ctx) {
		const pf = this.previewFrame;
		if (!pf || !this.offscreen) return;
		this.viewport.redrawBackgroundInRegion(ctx, pf);
		ctx.drawImage(this.offscreen, pf.x, pf.y, pf.w, pf.h);
	}

	_applyRotation() {
		if (this.angle === 0) {
			this._previewStale = true;
			this.previewImageData = null;
			this.previewFrame = null;
			this._syncHint();
			this.viewport.invalidate();
			return;
		}

		const sheet = this.doc.sheet;
		const rect = this.doc.currentOpRect();
		if (!sheet || !rect || !this.previewImageData) {
			this._previewStale = true;
			this.previewImageData = null;
			this.previewFrame = null;
			this._syncHint();
			this.viewport.invalidate();
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const after  = this.previewImageData;

		if (!imageDataEqual(before, after)) {
			ctx.putImageData(after, rect.x, rect.y);
			const cmd = new PaintCommand(
				ctx, rect.x, rect.y, rect.w, rect.h, before, after
			);
			this.doc.history.push(cmd, 'pixels');
		}

		this._previewStale = true;
		this.previewImageData = null;
		this.previewFrame = null;
		this._syncHint();
		this.viewport.invalidate();
	}
}

function clampAngle(deg) {
	if (!Number.isFinite(deg)) return 0;
	return Math.max(-360, Math.min(360, Math.round(deg)));
}

function imageDataEqual(a, b) {
	if (a.width !== b.width || a.height !== b.height) return false;
	const ad = a.data, bd = b.data;
	for (let i = 0; i < ad.length; i++) {
		if (ad[i] !== bd[i]) return false;
	}
	return true;
}
