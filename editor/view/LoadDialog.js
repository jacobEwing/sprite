// Modal dialog for entering a sheet path. open() returns a promise that
// resolves with the trimmed path on confirm, or null on cancel.
//
// The dialog is a singleton: it owns its DOM once, and each open() reuses
// it. Input value is remembered across opens within a session.
export class LoadDialog {
	constructor(defaultPath = 'player.json') {
		this._resolve = null;
		this._build(defaultPath);
	}

	open() {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this.backdrop.classList.add('visible');
			// Focus after the layout has settled; select-all makes it easy
			// to paste a new path over the default.
			requestAnimationFrame(() => {
				this.input.focus();
				this.input.select();
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

	_build(defaultPath) {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2>Open sheet</h2>
				<label class="modal-field">
					<span>JSON path</span>
					<input type="text" spellcheck="false" autocomplete="off">
				</label>
				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">Open</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.input = this.backdrop.querySelector('input');
		this.input.value = defaultPath;

		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.backdrop.querySelector('.modal-confirm')
			.addEventListener('click', () => this._confirm());

		// Click on the dim backdrop (but not the modal panel) cancels.
		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(null);
		});

		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this._confirm();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close(null);
			}
		});
	}

	_confirm() {
		const value = this.input.value.trim();
		if (!value) return;
		this.close(value);
	}
}
