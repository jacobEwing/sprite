import { announceOpen, announceClosed } from '../lib/modalCoordination.js';
import { closeAllPanels } from '../lib/panelCoordination.js';

// Modal confirmation dialog. Used in place of window.confirm so the
// prompt matches the editor's visual language and can carry a proper
// title line separate from the message body.
//
// open() returns a promise that resolves to true if the user confirmed,
// false if they cancelled (Cancel button, backdrop click, or Escape).

export class ConfirmDialog {
	constructor() {
		this._resolve = null;
		this._build();
	}

	open({ title = 'Confirm', message = '', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
		// If a dialog is already open, refuse the re-entry rather than
		// silently orphaning the previous promise.
		if (this._resolve) return Promise.resolve(false);

		return new Promise((resolve) => {
			announceOpen(this);
			closeAllPanels();

			this._resolve = resolve;
			this.titleEl.textContent = title;
			this.messageEl.textContent = message;
			this.confirmBtn.textContent = confirmLabel;
			this.cancelBtn.textContent = cancelLabel;
			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => this.confirmBtn.focus());
		});
	}

	close(result) {
		if (!this._resolve) return;
		this.backdrop.classList.remove('visible');
		const r = this._resolve;
		this._resolve = null;
		announceClosed(this);
		r(result === true);
	}

	_build() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2 class="confirm-title"></h2>
				<p class="confirm-message"></p>
				<div class="modal-actions">
					<button class="modal-cancel"></button>
					<button class="modal-confirm primary"></button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.titleEl    = this.backdrop.querySelector('.confirm-title');
		this.messageEl  = this.backdrop.querySelector('.confirm-message');
		this.confirmBtn = this.backdrop.querySelector('.modal-confirm');
		this.cancelBtn  = this.backdrop.querySelector('.modal-cancel');

		this.confirmBtn.addEventListener('click', () => this.close(true));
		this.cancelBtn.addEventListener('click',  () => this.close(false));

		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(false);
		});

		this.backdrop.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.close(false);
			} else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
				// Enter on a focused button fires its click; ignore it
				// here so we don't double-handle.
				e.preventDefault();
				this.close(true);
			}
		});
	}
}
