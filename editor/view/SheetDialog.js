// Modal for creating a new sheet or editing an existing one's defaults.
//
// New mode: image size, frame size, cell count, plus a "Suggest dimensions"
// button and a live warning if the cells won't fit.
//
// Edit mode: frame size, centre, and default frame rate. Image size is not
// editable here; use Sheet → Expand canvas… for that, so an undo only ever
// walks back one logical change.
//
// open() returns a promise: the form data on confirm, null on cancel.

export class SheetDialog {
	constructor() {
		this._resolve = null;
		this._mode = 'new';
		this._build();
	}

	openForNew() {
		this._mode = 'new';
		return this._open({
			title: 'New sheet',
			imageWidth: 192,
			imageHeight: 192,
			imageSrc : '',
			frameWidth: 24,
			frameHeight: 24,
			cellCount: 1,
			centerx: 0,
			centery: 0,
			defaultFrameRate: 12,
		});
	}

	openForEdit(sheet) {
		this._mode = 'edit';
		return this._open({
			title: 'Sheet settings',
			imageWidth: sheet.imageWidth,
			imageHeight: sheet.imageHeight,
			frameWidth: sheet.frameWidth || 24,
			frameHeight: sheet.frameHeight || 24,
			imageSrc: sheet.imageSrc || '',
			cellCount: 1,
			centerx: sheet.centerx,
			centery: sheet.centery,
			defaultFrameRate: sheet.defaultFrameRate ?? 12,
		});
	}

	_open(values) {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this.titleEl.textContent = values.title;
			this._populate(values);
			this._updateVisibility();
			this._validate();
			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => {
				this.fields.imageWidth.focus();
				this.fields.imageWidth.select();
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

	// --- construction -----------------------------------------------------

	_build() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2 class="sd-title"></h2>

				<div class="sd-section">
					<div class="sd-section-label">Image</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Width</span>
							<input type="number" data-field="imageWidth" min="1">
						</label>
						<label class="modal-field">
							<span>Height</span>
							<input type="number" data-field="imageHeight" min="1">
						</label>
					</div>
				</div>

				<div class="sd-section">
					<div class="sd-section-label">Frame grid</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Frame width</span>
							<input type="number" data-field="frameWidth" min="1">
						</label>
						<label class="modal-field">
							<span>Frame height</span>
							<input type="number" data-field="frameHeight" min="1">
						</label>
					</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Cells</span>
							<input type="number" data-field="cellCount" min="1">
						</label>
						<label class="modal-field sd-placeholder"></label>
					</div>
					<button class="sd-suggest" type="button">Suggest dimensions</button>
				</div>

				<div class="sd-section">
					<div class="sd-section-label">Defaults</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Centre X</span>
							<input type="number" data-field="centerx">
						</label>
						<label class="modal-field">
							<span>Centre Y</span>
							<input type="number" data-field="centery">
						</label>
					</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Image file</span>
							<input type="text" data-field="imageSrc" spellcheck="false">
						</label>
						<label class="modal-field sd-placeholder"></label>
					</div>
					<div class="modal-row">
						<label class="modal-field">
							<span>Frame rate</span>
							<input type="number" data-field="defaultFrameRate" min="1">
						</label>
						<label class="modal-field sd-placeholder"></label>
					</div>
				</div>

				<p class="sd-warning" hidden></p>

				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">OK</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.titleEl  = this.backdrop.querySelector('.sd-title');
		this.warningEl = this.backdrop.querySelector('.sd-warning');
		this.confirmBtn = this.backdrop.querySelector('.modal-confirm');

		this.fields = {};
		for (const el of this.backdrop.querySelectorAll('[data-field]')) {
			this.fields[el.dataset.field] = el;
			el.addEventListener('input', () => this._validate());
		}

		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.confirmBtn
			.addEventListener('click', () => this._confirm());
		this.backdrop.querySelector('.sd-suggest')
			.addEventListener('click', () => this._suggest());

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

	// --- population & mode switching -------------------------------------

	_populate(values) {
		for (const [k, v] of Object.entries(values)) {
			if (k === 'title') continue;
			const el = this.fields[k];
			if (el) el.value = v;
		}
	}

	_updateVisibility() {
		const isNew = this._mode === 'new';
		// New mode shows image dimensions and cell count; edit mode shows
		// the sheet's image-source path. Frame size, centre and rate are
		// shown in both.
		for (const key of ['imageWidth', 'imageHeight', 'cellCount']) {
			this._rowFor(key).hidden = !isNew;
		}
		this._rowFor('imageSrc').hidden = isNew;
		this.backdrop.querySelector('.sd-suggest').hidden = !isNew;
	}

	_rowFor(fieldName) {
		return this.fields[fieldName].closest('.modal-field');
	}

	// --- suggestion -------------------------------------------------------

	_suggest() {
		const fw = this._num('frameWidth');
		const fh = this._num('frameHeight');
		const n  = this._num('cellCount');
		if (fw <= 0 || fh <= 0 || n <= 0) return;

		// Roughly square overall image, given each cell's own aspect ratio.
		// Solve cols * rows >= n, cols*fw ≈ rows*fh.
		const cols = Math.max(1, Math.ceil(Math.sqrt(n * fh / fw)));
		const rows = Math.max(1, Math.ceil(n / cols));
		this.fields.imageWidth.value  = cols * fw;
		this.fields.imageHeight.value = rows * fh;
		this._validate();
	}

	// --- validation -------------------------------------------------------

	_validate() {
		let problem = null;

		if (this._mode === 'new') {
			const iw = this._num('imageWidth');
			const ih = this._num('imageHeight');
			const fw = this._num('frameWidth');
			const fh = this._num('frameHeight');
			const n  = this._num('cellCount');

			if (fw <= 0 || fh <= 0) problem = 'Frame size must be at least 1×1.';
			else if (iw <= 0 || ih <= 0) problem = 'Image size must be at least 1×1.';
			else if (n <= 0) problem = 'Cell count must be at least 1.';
			else {
				const capacity = Math.floor(iw / fw) * Math.floor(ih / fh);
				if (capacity < n) {
					const fitW = Math.floor(iw / fw);
					const fitH = Math.floor(ih / fh);
					problem = `Image fits ${capacity} cells (${fitW}×${fitH}); ` +
						`the sheet needs ${n}.`;
				}
			}
		} else {
			const fw = this._num('frameWidth');
			const fh = this._num('frameHeight');
			if (fw <= 0 || fh <= 0) problem = 'Frame size must be at least 1×1.';
		}

		if (problem) {
			this.warningEl.textContent = problem;
			this.warningEl.hidden = false;
			this.confirmBtn.disabled = true;
		} else {
			this.warningEl.hidden = true;
			this.confirmBtn.disabled = false;
		}
	}

	_num(name) {
		return parseFloat(this.fields[name].value) || 0;
	}

	_confirm() {
		if (this.confirmBtn.disabled) return;
		const out = {};
		for (const [k, el] of Object.entries(this.fields)) {
			if (el.type === 'text') {
				out[k] = el.value.trim();
			} else {
				const v = parseFloat(el.value);
				out[k] = Number.isFinite(v) ? v : 0;
			}
		}
		this.close(out);
	}
}
