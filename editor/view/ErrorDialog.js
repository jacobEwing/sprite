// Simple modal for errors the user needs to act on. Unlike the status bar,
// this can't be missed, and it names the file it was looking for so the
// fix is obvious.

export class ErrorDialog {
	constructor() {
		this._resolve = null;
		this._build();
	}

	show(title, message) {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this.titleEl.textContent = title;
			this.messageEl.textContent = message;
			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => this.confirmBtn.focus());
		});
	}

	close() {
		if (!this._resolve) return;
		this.backdrop.classList.remove('visible');
		const r = this._resolve;
		this._resolve = null;
		r();
	}

	_build() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2 class="error-title"></h2>
				<p class="error-message"></p>
				<div class="modal-actions">
					<button class="modal-confirm primary">OK</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.titleEl    = this.backdrop.querySelector('.error-title');
		this.messageEl  = this.backdrop.querySelector('.error-message');
		this.confirmBtn = this.backdrop.querySelector('.modal-confirm');

		this.confirmBtn.addEventListener('click', () => this.close());
		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close();
		});
		this.backdrop.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' || e.key === 'Enter') {
				e.preventDefault();
				this.close();
			}
		});
	}
}
