import {
	pickFile,
	makeEditable,
	_isAbsoluteImageRef,
	_basename,
	_loadImageFromURL,
	_loadImageFromFile,
} from '../io/loadSheet.js';

// Two-picker flow for loading a sheet from local files. Each button is its
// own click, so each picker gets a fresh user activation — this is what
// works around Chromium's "one activation per picker" rule.
//
// Auto-closes and resolves with { sheet, jsonFilename, imageFilename } when
// both halves are loaded. Can be cancelled at any point.
export class DiskLoadDialog {
	constructor() {
		this._resolve = null;
		this._jsonFile = null;
		this._jsonData = null;
		this._imageSource = null;
		this._imageFilename = null;
		this._build();
	}

	open() {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this._jsonFile = null;
			this._jsonData = null;
			this._imageSource = null;
			this._imageFilename = null;
			this._sync();
			this.backdrop.classList.add('visible');
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
				<h2>Open from disk</h2>

				<div class="dl-step">
					<button class="dl-pick" data-pick="json">Load sprite JSON…</button>
					<span class="dl-status" data-status="json">No file selected</span>
				</div>

				<div class="dl-step">
					<button class="dl-pick" data-pick="image">Load image…</button>
					<span class="dl-status" data-status="image">No file selected</span>
				</div>

				<p class="dl-hint">
					Pick the sheet JSON first. If it names a relative image
					path, pick that image next. Sheets whose image is an
					absolute URL skip the second step.
				</p>

				<p class="dl-error" hidden></p>

				<div class="modal-actions">
					<button class="modal-cancel">Cancel</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.backdrop);

		this.statusJson  = this.backdrop.querySelector('[data-status="json"]');
		this.statusImage = this.backdrop.querySelector('[data-status="image"]');
		this.errorEl     = this.backdrop.querySelector('.dl-error');

		this.backdrop.querySelector('[data-pick="json"]')
			.addEventListener('click', () => this._pickJson());
		this.backdrop.querySelector('[data-pick="image"]')
			.addEventListener('click', () => this._pickImage());
		this.backdrop.querySelector('.modal-cancel')
			.addEventListener('click', () => this.close(null));
		this.backdrop.addEventListener('mousedown', (e) => {
			if (e.target === this.backdrop) this.close(null);
		});
		this.backdrop.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') { e.preventDefault(); this.close(null); }
		});
	}

	async _pickJson() {
		this._clearError();
		const file = await pickFile({
			accept: 'application/json',
			description: 'Sprite sheet JSON',
			extensions: ['.json'],
		});
		if (!file) return;

		let data;
		try {
			data = JSON.parse(await file.text());
		} catch (err) {
			this._showError(`Invalid JSON in ${file.name}: ${err.message}`);
			return;
		}

		this._jsonFile = file;
		this._jsonData = data;
		this._sync();

		const ref = data.image;
		if (ref && _isAbsoluteImageRef(ref)) {
			try {
				this._imageSource = await _loadImageFromURL(ref);
				this._imageFilename = _basename(ref);
				this._sync();
				await this._maybeFinish();
			} catch (err) {
				this._showError(`Could not load image URL: ${err.message}`);
			}
		}
	}

	async _pickImage() {
		this._clearError();
		const file = await pickFile({
			accept: 'image/*',
			description: 'Sheet image',
			extensions: ['.png', '.gif', '.jpg', '.jpeg', '.webp'],
		});
		if (!file) return;

		try {
			this._imageSource = await _loadImageFromFile(file);
			this._imageFilename = file.name;
		} catch (err) {
			this._imageSource = null;
			this._showError(`Could not load image: ${err.message}`);
			return;
		}
		this._sync();
		await this._maybeFinish();
	}

	async _maybeFinish() {
		if (!this._jsonFile || !this._imageSource) return;
		try {
			const sheet = await window.SpriteSheet.fromJSON({
				...this._jsonData,
				image: this._imageSource,
			});
			makeEditable(sheet);
			sheet.imageSrc = this._imageFilename;
			this.close({
				sheet,
				jsonFilename: this._jsonFile.name,
				imageFilename: this._imageFilename,
			});
		} catch (err) {
			this._showError(`Could not build sheet: ${err.message}`);
		}
	}

	_sync() {
		this.statusJson.textContent  = this._jsonFile
			? this._jsonFile.name
			: 'No file selected';
		this.statusJson.classList.toggle('loaded', !!this._jsonFile);

		this.statusImage.textContent = this._imageSource
			? (this._imageFilename || 'Image loaded')
			: 'No file selected';
		this.statusImage.classList.toggle('loaded', !!this._imageSource);
	}

	_showError(msg) {
		this.errorEl.textContent = msg;
		this.errorEl.hidden = false;
	}

	_clearError() {
		this.errorEl.hidden = true;
		this.errorEl.textContent = '';
	}
}
