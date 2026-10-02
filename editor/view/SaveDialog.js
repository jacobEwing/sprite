import { announceOpen, announceClosed } from '../lib/modalCoordination.js';
import { closeAllPanels } from '../lib/panelCoordination.js';

// Modal dialog for choosing output filenames before saving. Open with the
// proposed defaults; returns { jsonFilename, imageFilename } or null.

export class SaveDialog {
	constructor() {
		this._resolve = null;
		this._build();
	}

	open(defaults) {
		return new Promise((resolve) => {
			announceOpen(this);
			closeAllPanels();

			this._resolve = resolve;
			this.jsonInput.value  = defaults.jsonFilename;
			this.imageInput.value = defaults.imageFilename;
			this.jsonInput.setCustomValidity('');
			this.imageInput.setCustomValidity('');
			this.backdrop.classList.add('visible');
			requestAnimationFrame(() => {
				this.jsonInput.focus();
				this.jsonInput.select();
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
				<h2>Save sheet</h2>
				<label class="modal-field">
					<span>Sheet JSON</span>
					<input type="text" data-field="json" spellcheck="false" autocomplete="off">
				</label>
				<label class="modal-field">
					<span>Image PNG</span>
					<input type="text" data-field="image" spellcheck="false" autocomplete="off">
				</label>
				<p class="modal-hint">Both files are written side by side.</p>
				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
					<button class="modal-confirm primary">Save</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.jsonInput  = this.backdrop.querySelector('[data-field="json"]');
		this.imageInput = this.backdrop.querySelector('[data-field="image"]');

		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.backdrop.querySelector('.modal-confirm')
			.addEventListener('click', () => this._confirm());

		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(null);
		});

		for (const input of [this.jsonInput, this.imageInput]) {
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); this._confirm(); }
				else if (e.key === 'Escape') { e.preventDefault(); this.close(null); }
			});
		}
	}

	_confirm() {
		// Clear any previous validity message so a repeat confirm
		// re-checks fresh.
		this.jsonInput.setCustomValidity('');
		this.imageInput.setCustomValidity('');

		const jsonFilename  = this.jsonInput.value.trim();
		const imageFilename = this.imageInput.value.trim();

		if (!jsonFilename) {
			this.jsonInput.setCustomValidity('Please enter a filename.');
			this.jsonInput.reportValidity();
			return;
		}
		if (!imageFilename) {
			this.imageInput.setCustomValidity('Please enter a filename.');
			this.imageInput.reportValidity();
			return;
		}
		if (jsonFilename === imageFilename) {
			this.imageInput.setCustomValidity('The two filenames must be different.');
			this.imageInput.reportValidity();
			return;
		}

		this.close({ jsonFilename, imageFilename });
	}
}
