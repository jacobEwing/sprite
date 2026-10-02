import { PaintCommand } from '../history/PaintCommand.js';
import { CompositeCommand } from '../model/sheetCommands.js';
import {
	rotate90CW, rotate90CCW,
	flipVertical, flipHorizontal,
	translateWrapped, rotateArbitrary,
	centreContent,
} from '../model/transforms.js';
import { enableWheelStep } from '../lib/wheelStep.js';

// Sidebar panel for pixel transforms, rendered inside the Modifiers tab.
//
// Sections:
//   Rotate    — arbitrary angle with frame-local pivot, plus 90° CW/CCW
//   Flip      — vertical and horizontal
//   Translate — four directions
//
// Scope matches the other modifier panels: selected frames by default,
// every frame when "All frames" is checked. The pivot is expressed in
// frame-local coordinates, so the same pivot applies to every processed
// frame — a value of (12, 12) means "12 pixels right, 12 down from each
// frame's own origin".
//
// Translate wraps within each frame's own rect, so pixels don't bleed
// into neighbouring frames.

export class TransformPanel {
	constructor(root, doc, viewport, options = {}) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		// Callback into main.js so the instant transforms and their
		// keyboard shortcuts share one implementation. Signature:
		//   onTransform(label, fn)
		// main.js applies fn to whatever scope transformScope says.
		this.onTransform = options.onTransform || null;
		this.scope = options.scope || { applyToAll: false };

		this.active = false;
		this._overlayToken = null;

		this.angle = 0;
		this.pivotX = 0;
		this.pivotY = 0;

		this._previewStale = false;

		this.previewParts = [];
		this._pending = null;

		this._build();
		this._bind();
		this._sync();

		// Wheel stepping: the angle slider moves in 1° increments; the
		// pivot inputs in 0.5-pixel increments (their own step values).
		enableWheelStep(this.angleSlider);
		enableWheelStep(this.pivotXIn);
		enableWheelStep(this.pivotYIn);

		doc.on('selectionChanged',  () => this._onTargetChange());
		doc.on('selectionModified', () => this._onTargetChange());
		doc.on('sheetChanged',      () => this._onTargetChange());
		doc.on('edit',              () => { if (this.active) this._schedule(); });
	}

	// --- lifecycle --------------------------------------------------------

	activate() {
		this.active = true;
		this._overlayToken = this.viewport.addOverlay((ctx) => this._drawPreview(ctx));
		this._resetPivotToDefault();
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
		this.previewParts = [];
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
					<div class="fp-label">Pivot (frame-local)</div>
					<div class="tsp-pivot-inputs">
						<input type="number" class="tsp-pivot-x" step="0.5">
						<input type="number" class="tsp-pivot-y" step="0.5">
					</div>
					<div class="tsp-pivot-presets">
						<button type="button" class="tsp-preset-btn" data-preset="selection">Selection centre</button>
						<button type="button" class="tsp-preset-btn" data-preset="frame">Frame origin</button>
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

				<button type="button" class="tsp-btn tsp-centre"
				        data-action="centre"
				        title="Centre each frame's content within its rect">Centre content</button>

				<label class="fp-checkbox">
					<input type="checkbox" class="tsp-all"> All frames
				</label>

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
		this.allInput    = this.root.querySelector('.tsp-all');
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

		this.allInput.addEventListener('change', () => {
			this.scope.applyToAll = this.allInput.checked;
			this._onControlChange();
		});

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
		this._resetPivotToDefault();
		this.scope.applyToAll = false;
		this._sync();
		this._onControlChange();
	}

	// Pivot default in frame-local coordinates:
	//   • with a pixel selection, the centre of the selection ∩ the
	//     primary frame
	//   • without, the frame's origin (centerx, centery) — matching both
	//     the "Frame origin" preset and the runtime's effective default
	//     when a transform has no explicit pivot
	_resetPivotToDefault() {
		const primary = this.doc.getSelectedFrame();
		if (!primary) {
			this.pivotX = 0;
			this.pivotY = 0;
			return;
		}
		const sel = this.doc.selection.rect;
		if (!sel) {
			this.pivotX = primary.centerx;
			this.pivotY = primary.centery;
		} else {
			const x1 = Math.max(sel.x, primary.x);
			const y1 = Math.max(sel.y, primary.y);
			const x2 = Math.min(sel.x + sel.w, primary.x + primary.width);
			const y2 = Math.min(sel.y + sel.h, primary.y + primary.height);
			this.pivotX = (x1 + x2) / 2 - primary.x;
			this.pivotY = (y1 + y2) / 2 - primary.y;
		}
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

		this.allInput.checked = this.scope.applyToAll;
		this._syncHint();
	}

	_syncHint() {
		if (this._previewStale) {
			this.hintEl.textContent = 'Applied. Adjust the rotation controls to preview again.';
			return;
		}
		const hasSel = !!this.doc.selection.rect;
		const total = this.doc.sheet ? this.doc.sheet.frameNames.length : 0;

		let scope;
		if (this.scope.applyToAll) scope = `all ${total} frame${total === 1 ? '' : 's'}`;
		else                       scope = `${this.previewParts.length} selected frame${this.previewParts.length === 1 ? '' : 's'}`;
		if (hasSel) scope += ', limited to the pixel selection';

		this.hintEl.textContent = `Rotation applies to ${scope}.`;
	}

	_applyPreset(which) {
		const primary = this.doc.getSelectedFrame();
		if (!primary) return;

		if (which === 'selection') {
			// Centre of the pixel selection ∩ the primary frame, in
			// frame-local coordinates.
			const sel = this.doc.selection.rect;
			if (!sel) {
				this.pivotX = primary.width / 2;
				this.pivotY = primary.height / 2;
			} else {
				const x1 = Math.max(sel.x, primary.x);
				const y1 = Math.max(sel.y, primary.y);
				const x2 = Math.min(sel.x + sel.w, primary.x + primary.width);
				const y2 = Math.min(sel.y + sel.h, primary.y + primary.height);
				this.pivotX = (x1 + x2) / 2 - primary.x;
				this.pivotY = (y1 + y2) / 2 - primary.y;
			}
		} else if (which === 'frame') {
			// Frame origin, already frame-local.
			this.pivotX = primary.centerx;
			this.pivotY = primary.centery;
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
			'centre':     ['Centred content',      centreContent],
		};
		const entry = map[action];
		if (!entry) return;

		this._previewStale = true;
		this.previewParts = [];
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
			this.previewParts = [];
			this.viewport.invalidate();
			this._syncHint();
			return;
		}

		this._computePreview();
		this.viewport.invalidate();
		this._syncHint();
	}

	_computePreview() {
		const sheet = this.doc.sheet;
		if (!sheet || !sheet.image) {
			this.previewParts = [];
			return;
		}

		const entries = this.doc.opRectsFor({ allFrames: this.scope.applyToAll });
		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });

		const parts = [];
		for (const entry of entries) {
			const { rect, frame } = entry;
			const src = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

			const lx = this.pivotX - (rect.x - frame.x);
			const ly = this.pivotY - (rect.y - frame.y);
			const result = rotateArbitrary(src, this.angle, lx, ly);

			const offscreen = document.createElement('canvas');
			offscreen.width  = result.width;
			offscreen.height = result.height;
			offscreen.getContext('2d').putImageData(result, 0, 0);

			parts.push({ region: rect, offscreen, imageData: result });
		}

		this.previewParts = parts;
	}

	_drawPreview(ctx) {
		for (const part of this.previewParts) {
			this.viewport.redrawBackgroundInRegion(ctx, part.region);
			ctx.drawImage(
				part.offscreen,
				part.region.x, part.region.y,
				part.region.w, part.region.h
			);
		}
	}

	_applyRotation() {
		if (this.angle === 0) {
			// Nothing to apply. Leave the preview and hint alone — the
			// preview is already empty at angle 0, and marking it stale
			// would produce a misleading "Applied..." message.
			return;
		}

		const sheet = this.doc.sheet;
		if (!sheet) return;

		if (this._previewStale || this.previewParts.length === 0) {
			this._computePreview();
		}

		if (this.previewParts.length === 0) {
			this._previewStale = true;
			this._syncHint();
			this.viewport.invalidate();
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const commands = [];

		for (const part of this.previewParts) {
			const { region } = part;
			const before = ctx.getImageData(region.x, region.y, region.w, region.h);
			const after  = part.imageData;
			if (imageDataEqual(before, after)) continue;

			ctx.putImageData(after, region.x, region.y);
			commands.push(new PaintCommand(
				ctx, region.x, region.y, region.w, region.h, before, after
			));
		}

		if (commands.length > 0) {
			const composite = commands.length === 1
				? commands[0]
				: new CompositeCommand(commands);
			this.doc.history.push(composite, 'pixels');
		}

		this._previewStale = true;
		this.previewParts = [];
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
