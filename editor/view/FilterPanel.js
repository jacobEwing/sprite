import { applyConvolution, matrixSum, PRESETS } from '../paint/filters.js';
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

		doc.on('selectionChanged', () => { if (this.visible) this._schedule(); });
		doc.on('sheetChanged',     () => { if (this.visible) this._schedule(); });
		doc.on('edit',             () => { if (this.visible) this._schedule(); });
	}

	get visible() { return this.root.style.display !== 'none'; }

	show(anchor) {
		this.root.style.display = 'block';
		this._positionBelow(anchor);
		this._sync();
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
					<div class="fp-label">Matrix</div>
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
			this._renderMatrix();
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
			edge: 'clamp',
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
		const frame = this.doc.getSelectedFrame();
		if (!sheet || !frame) {
			this.viewport.setPreview(null);
			this.previewImageData = null;
			this.previewFrame = null;
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const src = ctx.getImageData(frame.x, frame.y, frame.width, frame.height);
		const result = applyConvolution(src, this._kernel());

		this.previewImageData = result;
		this.previewFrame = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };

		// Draw the result into an offscreen canvas that the viewport preview
		// callback can blit over the frame's region.
		if (!this.offscreen) {
			this.offscreen = document.createElement('canvas');
			this.offscreenCtx = this.offscreen.getContext('2d');
		}
		this.offscreen.width  = result.width;
		this.offscreen.height = result.height;
		this.offscreenCtx.putImageData(result, 0, 0);

		this.viewport.setPreview((vctx) => {
			if (!this.previewFrame || !this.offscreen) return;
			vctx.drawImage(
				this.offscreen,
				this.previewFrame.x,
				this.previewFrame.y,
				this.previewFrame.width,
				this.previewFrame.height
			);
		});
	}

	_apply() {
		const sheet = this.doc.sheet;
		const frame = this.doc.getSelectedFrame();
		if (!sheet || !frame || !this.previewImageData) {
			this.hide();
			return;
		}

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const before = ctx.getImageData(frame.x, frame.y, frame.width, frame.height);
		const after = this.previewImageData;

		ctx.putImageData(after, frame.x, frame.y);
		const cmd = new PaintCommand(
			ctx,
			frame.x, frame.y, frame.width, frame.height,
			before, after
		);
		this.doc.history.push(cmd);

		this.hide();
		this.viewport.invalidate();
	}
}

function cloneMatrix(m) { return m.map(row => row.slice()); }

function formatNumber(v) {
	if (Number.isInteger(v)) return String(v);
	return String(Math.round(v * 1000) / 1000);
}
