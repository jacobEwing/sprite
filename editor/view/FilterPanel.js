import { applyConvolution, matrixSum, PRESETS, defaultMatrix } from '../paint/filters.js';
import { PaintCommand } from '../history/PaintCommand.js';

// Sidebar panel for the convolution filter, rendered inside the Modifiers
// tab.
//
// Preview semantics: the preview shows what Apply would do *right now*.
// After an Apply, the preview is disabled until the user touches any
// control or changes the target — at that point the preview returns,
// reflecting the new settings against the current pixels. Controls
// themselves are never reset by Apply.
//
// The preview lives on the viewport's overlay stack, not its single-slot
// setPreview. That keeps it alive underneath transient tool previews
// (frame-drag outlines, shape previews) instead of being cleared when the
// tool clears its own.

export class FilterPanel {
	constructor(root, doc, viewport) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.active = false;
		this._overlayToken = null;

		this.matrix = defaultMatrix(3);
		this.divisor = 1;
		this.offset = 0;
		this.convolveAlpha = false;
		this.presetName = '';

		this._previewStale = false;

		this.previewImageData = null;
		this.previewFrame = null;
		this._pending = null;

		this._build();
		this._bind();
		this._renderMatrix();
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

	// The preview's target changed: a different frame is selected, the
	// pixel selection was adjusted, or a new sheet loaded. Any of those is
	// a signal of intent to see a fresh preview, so clear the stale flag
	// that Apply set and let the recompute run.
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
				<label class="fp-row">
					<span class="fp-label">Preset</span>
					<select class="fp-preset"></select>
				</label>

				<div class="fp-matrix-wrap">
					<div class="fp-matrix-header">
						<div class="fp-label">Matrix</div>
						<div class="fp-size">
							<button class="fp-size-btn" data-size="3">3×3</button>
							<button class="fp-size-btn" data-size="5">5×5</button>
						</div>
					</div>
					<div class="fp-matrix"></div>
				</div>

				<div class="fp-row-group">
					<label class="fp-row">
						<span class="fp-label">Divisor</span>
						<input type="number" class="fp-divisor" step="0.01">
					</label>
					<label class="fp-row">
						<span class="fp-label">Offset</span>
						<input type="number" class="fp-offset" step="1">
					</label>
				</div>

				<label class="fp-checkbox">
					<input type="checkbox" class="fp-alpha"> Convolve alpha
				</label>

				<p class="fp-hint"></p>
			</div>
			<div class="fp-footer">
				<button class="fp-reset">Reset</button>
				<button class="fp-apply primary">Apply</button>
			</div>
		`;

		this.presetSelect = this.root.querySelector('.fp-preset');
		this.matrixEl     = this.root.querySelector('.fp-matrix');
		this.divisorInput = this.root.querySelector('.fp-divisor');
		this.offsetInput  = this.root.querySelector('.fp-offset');
		this.alphaInput   = this.root.querySelector('.fp-alpha');
		this.hintEl       = this.root.querySelector('.fp-hint');
		this.sizeButtons  = Array.from(this.root.querySelectorAll('.fp-size-btn'));

		for (const btn of this.sizeButtons) {
			btn.addEventListener('click', () => {
				this._setSize(parseInt(btn.dataset.size, 10));
			});
		}

		const placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.textContent = 'Custom';
		this.presetSelect.appendChild(placeholder);

		for (const p of PRESETS) {
			const opt = document.createElement('option');
			opt.value = p.name;
			opt.textContent = p.name;
			this.presetSelect.appendChild(opt);
		}
	}

	_bind() {
		this.presetSelect.addEventListener('change', () => {
			const p = PRESETS.find(x => x.name === this.presetSelect.value);
			if (!p) return;
			this.matrix = cloneMatrix(p.matrix);
			this.divisor = p.divisor ?? matrixSum(p.matrix);
			this.offset = 0;
			this.presetName = p.name;
			this._renderMatrix();
			this._sync();
			this._onControlChange();
		});
		this.divisorInput.addEventListener('input', () => {
			this.divisor = parseFloat(this.divisorInput.value) || 0;
			this._onControlChange();
		});
		this.offsetInput.addEventListener('input', () => {
			this.offset = parseFloat(this.offsetInput.value) || 0;
			this._onControlChange();
		});
		this.alphaInput.addEventListener('change', () => {
			this.convolveAlpha = this.alphaInput.checked;
			this._onControlChange();
		});

		this.root.querySelector('.fp-reset').addEventListener('click', () => this._resetControls());
		this.root.querySelector('.fp-apply').addEventListener('click', () => this._apply());
	}

	_onControlChange() {
		this._previewStale = false;
		this._schedule();
	}

	// --- state ------------------------------------------------------------

	_resetControls() {
		this.matrix = defaultMatrix(3);
		this.divisor = 1;
		this.offset = 0;
		this.convolveAlpha = false;
		this.presetName = '';
		this._renderMatrix();
		this._sync();
		this._onControlChange();
	}

	_renderMatrix() {
		this.matrixEl.innerHTML = '';
		this.matrixInputs = [];
		const size = this.matrix.length;

		for (let y = 0; y < size; y++) {
			const row = [];
			for (let x = 0; x < size; x++) {
				const input = document.createElement('input');
				input.type = 'text';
				input.className = 'fp-cell';
				input.value = formatNumber(this.matrix[y][x]);
				input.addEventListener('input', () => {
					const v = parseFloat(input.value);
					this.matrix[y][x] = Number.isFinite(v) ? v : 0;
					this.presetName = '';
					this.presetSelect.value = '';
					this._onControlChange();
				});
				this.matrixEl.appendChild(input);
				row.push(input);
			}
			this.matrixInputs.push(row);
		}
		this.matrixEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

		for (const btn of this.sizeButtons) {
			btn.classList.toggle('selected', parseInt(btn.dataset.size, 10) === size);
		}
	}

	_sync() {
		this.presetSelect.value = this.presetName;
		this.divisorInput.value = formatNumber(this.divisor);
		this.offsetInput.value = this.offset;
		this.alphaInput.checked = this.convolveAlpha;
		this._syncHint();
	}

	_syncHint() {
		if (this._previewStale) {
			this.hintEl.textContent = 'Applied. Adjust any control to preview again.';
		} else {
			this.hintEl.textContent =
				'Applies to the pixel selection, or the current frame. ' +
				'Pixels outside the region clamp to its edge.';
		}
	}

	_setSize(size) {
		if (size !== 3 && size !== 5) return;
		if (this.matrix.length === size) return;

		this.matrix = defaultMatrix(size);
		this.divisor = 1;
		this.offset = 0;
		this.presetName = '';
		this._renderMatrix();
		this._sync();
		this._onControlChange();
	}

	// --- preview & apply --------------------------------------------------

	_kernel() {
		return {
			matrix: this.matrix,
			divisor: this.divisor,
			offset: this.offset,
			convolveAlpha: this.convolveAlpha,
		};
	}

	_schedule() {
		if (this._pending) return;
		this._pending = requestAnimationFrame(() => {
			this._pending = null;
			this._recompute();
		});
	}

	_recompute() {
		if (!this.active) return;

		if (this._previewStale) {
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
		const result = applyConvolution(src, this._kernel());

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

	_apply() {
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

		const identity = imageDataEqual(before, after);
		if (!identity) {
			ctx.putImageData(after, rect.x, rect.y);
			const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
			this.doc.history.push(cmd, 'pixels');
		}

		this._previewStale = true;
		this.previewImageData = null;
		this.previewFrame = null;
		this._syncHint();
		this.viewport.invalidate();
	}
}

function cloneMatrix(m) { return m.map(row => row.slice()); }

function formatNumber(v) {
	if (Number.isInteger(v)) return String(v);
	return String(Math.round(v * 1000) / 1000);
}

function imageDataEqual(a, b) {
	if (a.width !== b.width || a.height !== b.height) return false;
	const ad = a.data, bd = b.data;
	for (let i = 0; i < ad.length; i++) {
		if (ad[i] !== bd[i]) return false;
	}
	return true;
}
