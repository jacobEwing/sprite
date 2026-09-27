import { announceOpen, announceClosed } from '../lib/modalCoordination.js';
import { closeAllPanels } from '../lib/panelCoordination.js';

// Small dialog for creating a blank image. Two fields, no sprite data
// involved: the frame layout, sequences, and settings of whatever sheet is
// currently loaded are left untouched.

export class NewImageDialog {
	constructor() {
		this._resolve = null;
		this._build();
	}

	open(defaults = {}) {
		return new Promise((resolve) => {
			announceOpen(this);
			closeAllPanels();
			this._resolve = resolve;
			this.inputW.value = defaults.width  || 256;
			this.inputH.value = defaults.height || 256;
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
		announceClosed(this);
		r(result);
	}

	_build() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = 'modal-backdrop';
		this.backdrop.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true">
				<h2>New image</h2>
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
				<p class="modal-hint">
					Creates a blank transparent image. Frames, sequences, and
					settings are not affected.
				</p>
				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">Create</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.inputW = this.backdrop.querySelector('[data-field="w"]');
		this.inputH = this.backdrop.querySelector('[data-field="h"]');

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
