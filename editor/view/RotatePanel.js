import { rotateArbitrary } from '../model/transforms.js';
import { PaintCommand } from '../history/PaintCommand.js';
import { announcePanelOpen, announcePanelClosed } from '../lib/panelCoordination.js';

// Floating panel for arbitrary-angle rotation. Slider plus numeric input
// for the angle; two numeric inputs and two preset buttons for the pivot.
// Live preview over the viewport, Apply pushes one PaintCommand.
//
// The pivot is expressed in region-relative coordinates: (0, 0) is the
// top-left of the region being rotated (either the pixel selection or the
// whole frame). Values outside the region are allowed - the maths doesn't
// clip, and rotating around a point off the sprite is sometimes useful.

export class RotatePanel {
	constructor(root, doc, viewport) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.angle = 0;
		this.pivotX = 0;
		this.pivotY = 0;

		this.previewImageData = null;
		this.previewFrame = null;
		this._pending = null;

		this._build();
		this._bind();
		this.hide();

		doc.on('selectionChanged',  () => { if (this.visible) this._schedule(); });
		doc.on('selectionModified', () => { if (this.visible) this._schedule(); });
		doc.on('sheetChanged',      () => { if (this.visible) this._schedule(); });
		doc.on('edit',              () => { if (this.visible) this._schedule(); });
	}

	get visible() { return this.root.style.display !== 'none'; }

	show(anchor) {
		announcePanelOpen(this);
		this.root.style.display = 'block';
		this._positionBelow(anchor);
		this._sync();
		this._schedule();
	}

	hide() {
		if (this._pending) {
			cancelAnimationFrame(this._pending);
			this._pending = null;
		}
		this.root.style.display = 'none';
		this.viewport.setPreview(null);
		this.previewImageData = null;
		this.previewFrame = null;
		announcePanelClosed(this);
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="fp-header">
				<span class="fp-title">Rotate</span>
				<button class="fp-close" title="Close">✕</button>
			</div>
			<div class="fp-body">
				<div class="fp-row">
					<span class="fp-label">Angle</span>
					<input type="range" class="rp-slider" min="-180" max="180" step="1" value="0">
					<span class="rp-angle-value">0°</span>
				</div>
				<div class="fp-row">
					<span class="fp-label"></span>
					<input type="number" class="rp-number" min="-360" max="360" step="1" value="0">
				</div>

				<div class="rp-pivot-section">
					<div class="fp-label">Pivot</div>
					<div class="rp-pivot-inputs">
						<input type="number" class="rp-pivot-x" step="0.5">
						<input type="number" class="rp-pivot-y" step="0.5">
					</div>
					<div class="rp-pivot-presets">
						<button type="button" class="rp-preset-btn" data-preset="selection">Selection centre</button>
						<button type="button" class="rp-preset-btn" data-preset="frame">Frame centre</button>
					</div>
				</div>

				<p class="fp-hint">
					Rotates clockwise. Pivot is measured from the top-left
					of the region being rotated (selection, or the whole
					frame). Pixels that rotate past the edge are clipped.
				</p>
			</div>
			<div class="fp-footer">
				<button class="fp-cancel">Cancel</button>
				<button class="fp-apply primary">Apply</button>
			</div>
		`;

		this.slider     = this.root.querySelector('.rp-slider');
		this.number     = this.root.querySelector('.rp-number');
		this.readout    = this.root.querySelector('.rp-angle-value');
		this.pivotXIn   = this.root.querySelector('.rp-pivot-x');
		this.pivotYIn   = this.root.querySelector('.rp-pivot-y');
	}

	_bind() {
		const setAngle = (deg) => {
			deg = clampAngle(deg);
			this.angle = deg;
			this._sync();
			this._schedule();
		};
		const setPivot = (x, y) => {
			this.pivotX = x;
			this.pivotY = y;
			this._sync();
			this._schedule();
		};

		this.slider.addEventListener('input', () =>
			setAngle(parseFloat(this.slider.value) || 0));
		this.number.addEventListener('input', () =>
			setAngle(parseFloat(this.number.value) || 0));
		this.pivotXIn.addEventListener('input', () =>
			setPivot(parseFloat(this.pivotXIn.value) || 0, this.pivotY));
		this.pivotYIn.addEventListener('input', () =>
			setPivot(this.pivotX, parseFloat(this.pivotYIn.value) || 0));

		for (const btn of this.root.querySelectorAll('.rp-preset-btn')) {
			btn.addEventListener('click', () => this._applyPreset(btn.dataset.preset));
		}

		this.root.querySelector('.fp-close').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-cancel').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-apply').addEventListener('click', () => this._apply());

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.visible) this.hide();
		});
	}

	_applyPreset(which) {
		const rect = this.doc.currentOpRect();
		if (!rect) return;

		if (which === 'selection') {
			// Region-relative centre. For an odd-sized region this lands
			// on the middle pixel; for even, on the half-pixel boundary.
			this.pivotX = rect.w / 2;
			this.pivotY = rect.h / 2;
		} else if (which === 'frame') {
			const frame = this.doc.getSelectedFrame();
			if (!frame) return;
			// Frame origin is at (frame.x + centerx, frame.y + centery)
			// in image coordinates. Convert to region-relative.
			this.pivotX = frame.x + frame.centerx - rect.x;
			this.pivotY = frame.y + frame.centery - rect.y;
		}
		this._sync();
		this._schedule();
	}

	_sync() {
		if (document.activeElement !== this.slider) {
			const wrapped = ((this.angle + 180) % 360 + 360) % 360 - 180;
			this.slider.value = wrapped;
		}
		if (document.activeElement !== this.number) {
			this.number.value = this.angle;
		}
		this.readout.textContent = this.angle + '°';

		if (document.activeElement !== this.pivotXIn) this.pivotXIn.value = this.pivotX;
		if (document.activeElement !== this.pivotYIn) this.pivotYIn.value = this.pivotY;
	}

	_positionBelow(anchor) {
		const r = anchor.getBoundingClientRect();
		const w = this.root.offsetWidth;
		const h = this.root.offsetHeight;
		let x = r.right - w;
		let y = r.bottom + 6;
		if (x < 8) x = 8;
		if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
		if (y + h > window.innerHeight - 8) y = r.top - h - 6;
		if (y < 8) y = 8;
		this.root.style.left = x + 'px';
		this.root.style.top  = y + 'px';
	}

	// --- preview & apply --------------------------------------------------

	_schedule() {
		if (this._pending) return;
		this._pending = requestAnimationFrame(() => {
			this._pending = null;
			this._recompute();
		});
	}

	_recompute() {
		if (!this.visible) return;

		const sheet = this.doc.sheet;
		const rect = this.doc.currentOpRect();
		if (!sheet || !rect) {
			this.viewport.setPreview(null);
			this.previewImageData = null;
			this.previewFrame = null;
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const src = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const result = (this.angle === 0 && this._pivotIsCentre(rect))
			? src
			: rotateArbitrary(src, this.angle, this.pivotX, this.pivotY);

		this.previewImageData = result;
		this.previewFrame = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

		if (!this.offscreen) {
			this.offscreen = document.createElement('canvas');
			this.offscreenCtx = this.offscreen.getContext('2d');
		}
		this.offscreen.width  = result.width;
		this.offscreen.height = result.height;
		this.offscreenCtx.putImageData(result, 0, 0);

		this.viewport.setPreview((vctx) => {
			const pf = this.previewFrame;
			if (!pf || !this.offscreen) return;
			this.viewport.redrawBackgroundInRegion(vctx, pf);
			vctx.drawImage(this.offscreen, pf.x, pf.y, pf.w, pf.h);
		});
	}

	// True when the pivot equals the region's default centre, within a
	// rounding tolerance. Used to skip the rotation when nothing has
	// actually changed - a no-op apply doesn't belong in the undo stack.
	_pivotIsCentre(rect) {
		return Math.abs(this.pivotX - rect.w / 2) < 1e-6
		    && Math.abs(this.pivotY - rect.h / 2) < 1e-6;
	}

	_apply() {
		const rect = this.doc.currentOpRect();
		const noop = this.angle === 0 || (rect && this._pivotIsCentre(rect));
		if (noop) { this.hide(); return; }

		const sheet = this.doc.sheet;
		if (!sheet || !rect || !this.previewImageData) { this.hide(); return; }

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const after = this.previewImageData;

		// If the rotation happens to be a no-op on this region (e.g. 360°),
		// skip writing. Comparing pixel arrays isn't free, but the history
		// layer is better off without a redundant entry.
		if (imageDataEqual(before, after)) { this.hide(); return; }

		ctx.putImageData(after, rect.x, rect.y);
		const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
		this.doc.history.push(cmd, 'pixels');

		this.hide();
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
