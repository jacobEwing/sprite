import { applyConvolution, matrixSum, PRESETS, defaultMatrix } from '../paint/filters.js';
import { PaintCommand } from '../history/PaintCommand.js';

// Floating panel for the convolution filter. Shows a preset dropdown, a
// matrix editor, divisor/offset fields, and an alpha toggle. Live-previews
// the filtered frame over the viewport; on Apply, writes pixels and pushes
// a single PaintCommand to history.

const DEFAULT_MATRIX = [[0,-1,0],[-1,5,-1],[0,-1,0]];

export class FilterPanel {
	constructor(root, doc, viewport) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;

		this.matrix = cloneMatrix(DEFAULT_MATRIX);
		this.divisor = 1;
		this.offset = 0;
		this.convolveAlpha = false;
		this.presetName = 'Sharpen';

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
		this.root.style.display = 'block';
		this._positionBelow(anchor);
		this._sync();
		this._schedule();
	}

	hide() {
		this.root.style.display = 'none';
		this.viewport.setPreview(null);
		this.previewImageData = null;
		this.previewFrame = null;
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="fp-header">
				<span class="fp-title">Filter</span>
				<button class="fp-close" title="Close">✕</button>
			</div>
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

				<p class="fp-hint">
					Applies to the selected frame. Pixels outside the frame
					clamp to the frame's edge.
				</p>
			</div>
			<div class="fp-footer">
				<button class="fp-cancel">Cancel</button>
				<button class="fp-apply primary">Apply</button>
			</div>
		`;

		this.presetSelect = this.root.querySelector('.fp-preset');
		this.matrixEl     = this.root.querySelector('.fp-matrix');
		this.divisorInput = this.root.querySelector('.fp-divisor');
		this.offsetInput  = this.root.querySelector('.fp-offset');
		this.alphaInput   = this.root.querySelector('.fp-alpha');
		this.sizeButtons = Array.from(this.root.querySelectorAll('.fp-size-btn'));
		for (const btn of this.sizeButtons) {
			btn.addEventListener('click', () => {
				this._setSize(parseInt(btn.dataset.size, 10));
			});
		}
		for (const p of PRESETS) {
			const opt = document.createElement('option');
			opt.value = p.name;
			opt.textContent = p.name;
			this.presetSelect.appendChild(opt);
		}

		this._renderMatrix();
	}

	_bind() {
		this.presetSelect.addEventListener('change', () => {
			const p = PRESETS.find(x => x.name === this.presetSelect.value);
			if (!p) return;
			this.matrix = cloneMatrix(p.matrix);
			this.divisor = p.divisor ?? matrixSum(p.matrix);
			this.offset = 0;
			this.presetName = p.name;
			this._renderMatrix();     // also updates size buttons
			this._sync();
			this._schedule();
		});
		this.divisorInput.addEventListener('input', () => {
			this.divisor = parseFloat(this.divisorInput.value) || 0;
			this._schedule();
		});
		this.offsetInput.addEventListener('input', () => {
			this.offset = parseFloat(this.offsetInput.value) || 0;
			this._schedule();
		});
		this.alphaInput.addEventListener('change', () => {
			this.convolveAlpha = this.alphaInput.checked;
			this._schedule();
		});

		this.root.querySelector('.fp-close').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-cancel').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-apply').addEventListener('click', () => this._apply());

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.visible) this.hide();
		});
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
					this._schedule();
				});
				this.matrixEl.appendChild(input);
				row.push(input);
			}
			this.matrixInputs.push(row);
		}
		this.matrixEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

		if (this.sizeButtons) {
			for (const btn of this.sizeButtons) {
				btn.classList.toggle('selected',
					parseInt(btn.dataset.size, 10) === size);
			}
		}
	}

	_sync() {
		this.presetSelect.value = this.presetName;
		this.divisorInput.value = formatNumber(this.divisor);
		this.offsetInput.value = this.offset;
		this.alphaInput.checked = this.convolveAlpha;
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
		const result = applyConvolution(src, this._kernel());

		this.previewImageData = result;
		// The region is stored as { x, y, w, h } — matching what
		// redrawBackgroundInRegion and the rest of the editor use.
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

			// Replace the region's pixels with the background, then draw
			// the filter result over it — matching the putImageData that
			// _apply performs.
			this.viewport.redrawBackgroundInRegion(vctx, pf);

			vctx.drawImage(this.offscreen, pf.x, pf.y, pf.w, pf.h);
		});
	}

	_apply() {
		const sheet = this.doc.sheet;
		const rect = this.doc.currentOpRect();
		if (!sheet || !rect || !this.previewImageData) {
			this.hide();
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		const after = this.previewImageData;

		ctx.putImageData(after, rect.x, rect.y);
		const cmd = new PaintCommand(ctx, rect.x, rect.y, rect.w, rect.h, before, after);
		this.doc.history.push(cmd, 'pixels');

		this.hide();
		this.viewport.invalidate();
	}

	_setSize(size) {
		if (size !== 3 && size !== 5) return;
		if (this.matrix.length === size) return;

		this.matrix = defaultMatrix(size);
		this.divisor = 1;
		this.offset = 0;
		this._renderMatrix();
		this._sync();
		this._schedule();
	}
}

function cloneMatrix(m) { return m.map(row => row.slice()); }

function formatNumber(v) {
	if (Number.isInteger(v)) return String(v);
	return String(Math.round(v * 1000) / 1000);
}
