// Dialog for reshaping the frame grid. Asks only for the column count; the
// resulting canvas dimensions are shown live. Warns (soft, non-blocking)
// when frames are larger than the cell and would be clipped.

export class ReshapeDialog {
	constructor() {
		this._resolve = null;
		this._sheet = null;
		this._build();
	}

	open(sheet) {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this._sheet = sheet;

			const n = sheet.frameNames.length;
			const cellW = sheet.frameWidth  || 16;
			const cellH = sheet.frameHeight || 16;
			const suggested = n > 0
				? Math.max(1, Math.ceil(Math.sqrt(n * cellH / cellW)))
				: 1;

			this.inputCols.value = suggested;
			this._update();

			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => {
				this.inputCols.focus();
				this.inputCols.select();
			});
		});
	}

	close(result) {
		if (!this._resolve) return;
		this.backdrop.classList.remove('visible');
		const r = this._resolve;
		this._resolve = null;
		r(result);
	}

	_build() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2>Reshape frames</h2>
				<div class="modal-row">
					<label class="modal-field">
						<span>Columns</span>
						<input type="number" data-field="cols" min="1">
					</label>
				</div>
				<p class="modal-hint sd-dims"></p>
				<p class="sd-warning" hidden></p>
				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">Reshape</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.inputCols = this.backdrop.querySelector('[data-field="cols"]');
		this.dimsEl    = this.backdrop.querySelector('.sd-dims');
		this.warningEl = this.backdrop.querySelector('.sd-warning');
		this.confirmBtn = this.backdrop.querySelector('.modal-confirm');

		this.inputCols.addEventListener('input', () => this._update());

		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.confirmBtn
			.addEventListener('click', () => this._confirm());
		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(null);
		});
		this.backdrop.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
				e.preventDefault();
				this._confirm();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close(null);
			}
		});
	}

	_update() {
		const n = this._sheet.frameNames.length;
		const cellW = this._sheet.frameWidth  || 16;
		const cellH = this._sheet.frameHeight || 16;
		const cols = Math.max(1, parseInt(this.inputCols.value, 10) || 1);
		const rows = Math.max(1, Math.ceil(n / cols));
		const w = cols * cellW;
		const h = rows * cellH;

		this.dimsEl.textContent =
			`${n} frame${n === 1 ? '' : 's'} → ` +
			`${cols}×${rows} grid · canvas ${w}×${h}px`;

		const clipped = [];
		for (const name of this._sheet.frameNames) {
			const f = this._sheet.frames[name];
			if (f.width > cellW || f.height > cellH) clipped.push(name);
		}

		if (clipped.length > 0) {
			const preview = clipped.slice(0, 3).join(', ');
			const more = clipped.length > 3 ? ` and ${clipped.length - 3} more` : '';
			this.warningEl.textContent =
				`${clipped.length} frame${clipped.length === 1 ? '' : 's'} ` +
				`larger than the ${cellW}×${cellH} cell ` +
				`(${preview}${more}). Their content will be clipped to ` +
				`fit the new cell.`;
			this.warningEl.className = 'sd-warning soft';
			this.warningEl.hidden = false;
		} else {
			this.warningEl.hidden = true;
		}
	}

	_confirm() {
		const cols = Math.max(1, parseInt(this.inputCols.value, 10) || 1);
		this.close({ cols });
	}
}
