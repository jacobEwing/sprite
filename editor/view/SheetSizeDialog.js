// Modal dialog for specifying new canvas dimensions. Pre-fills from the
// current sheet and suggests doubling whichever dimension is smaller.
// Resolves with { width, height } on confirm, or null on cancel.

export class SheetSizeDialog {
	constructor() {
		this._resolve = null;
		this._build();
	}

	open(currentWidth, currentHeight) {
		return new Promise((resolve) => {
			this._resolve = resolve;

			// Default: grow the smaller dimension so the sheet becomes more
			// square. Most sprite sheets benefit from this; it's also
			// harmless if the user overrides the values.
			const w = currentWidth;
			const h = currentHeight > currentWidth ? currentHeight : currentHeight * 2;
			const w2 = currentWidth > currentHeight ? currentWidth : currentWidth * 2;
			this.inputW.value = currentWidth > currentHeight ? w : w2;
			this.inputH.value = currentHeight > currentWidth ? h : currentHeight;

			this.inputW.min = currentWidth;
			this.inputH.min = currentHeight;
			this.hintEl.textContent =
				`Current: ${currentWidth} × ${currentHeight}. ` +
				`Values cannot be smaller than the current size.`;

			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => {
				this.inputW.focus();
				this.inputW.select();
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
				<h2>Expand canvas</h2>
				<div class="modal-row">
					<label class="modal-field">
						<span>Width</span>
						<input type="number" data-field="w" min="1">
					</label>
					<label class="modal-field">
						<span>Height</span>
						<input type="number" data-field="h" min="1">
					</label>
				</div>
				<p class="modal-hint"></p>
				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">Expand</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.inputW = this.backdrop.querySelector('[data-field="w"]');
		this.inputH = this.backdrop.querySelector('[data-field="h"]');
		this.hintEl = this.backdrop.querySelector('.modal-hint');

		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.backdrop.querySelector('.modal-confirm')
			.addEventListener('click', () => this._confirm());

		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(null);
		});

		for (const input of [this.inputW, this.inputH]) {
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); this._confirm(); }
				else if (e.key === 'Escape') { e.preventDefault(); this.close(null); }
			});
		}
	}

	_confirm() {
		const w = parseInt(this.inputW.value, 10);
		const h = parseInt(this.inputH.value, 10);
		if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
		this.close({ width: w, height: h });
	}
}
