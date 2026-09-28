import { ColorPicker } from './ColorPicker.js';
import { announcePanelOpen, announcePanelClosed } from '../lib/panelCoordination.js';

// Floating popover for choosing the viewport background: a texture
// (checker, dots, stripes, none) and two colours - the A/B pair used by
// the patterned textures.
//
// Uses the same ColorPicker the palette uses. Clicking a swatch opens it
// next to that swatch.

const TEXTURES = [
	{ value: 'checker',  label: 'Checker' },
	{ value: 'dots',     label: 'Dots' },
	{ value: 'stripes',  label: 'Stripes' },
	{ value: 'none',     label: 'None' },
];

export class BackgroundPicker {
	constructor(viewport) {
		this.viewport = viewport;
		this._activeSlot = null;

		this.picker = new ColorPicker();
		this.picker.onLiveChange((hex) => this._apply(hex, false));
		this.picker.onCommit((hex)     => this._apply(hex, true));

		this._build();
	}

	toggle(anchor) {
		if (this.isOpen) this.hide();
		else this.show(anchor);
	}

	get isOpen() { return this.root.style.display !== 'none'; }

	show(anchor) {
		announcePanelOpen(this);
		this.root.style.display = 'block';
		this._position(anchor);
		this._sync();
	}

	hide() {
		this.root.style.display = 'none';
		this.picker.hide();
		announcePanelClosed(this);
	}

	_build() {
		this.root = document.createElement('div');
		this.root.className = 'bg-popover';
		this.root.style.display = 'none';
		this.root.innerHTML = `
			<div class="bg-row">
				<span class="bg-label">Texture</span>
				<select class="bg-texture">
					${TEXTURES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
				</select>
			</div>
			<div class="bg-row">
				<span class="bg-label">Colours</span>
				<button class="bg-swatch" data-slot="a" title="Primary background colour"></button>
				<button class="bg-swatch" data-slot="b" title="Secondary background colour"></button>
			</div>
			<p class="bg-hint">Click a swatch to change its colour.</p>
		`;
		document.body.appendChild(this.root);

		this.textureSelect = this.root.querySelector('.bg-texture');
		this.swatchA = this.root.querySelector('[data-slot="a"]');
		this.swatchB = this.root.querySelector('[data-slot="b"]');

		this.textureSelect.addEventListener('change', () => {
			this.viewport.setBackground({ texture: this.textureSelect.value });
		});
		this.swatchA.addEventListener('click', () => this._openPicker('a'));
		this.swatchB.addEventListener('click', () => this._openPicker('b'));

		document.addEventListener('mousedown', (e) => {
			if (!this.isOpen) return;
			if (this.root.contains(e.target)) return;
			if (this.picker.root && this.picker.root.contains(e.target)) return;
			this.hide();
		});
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.isOpen) this.hide();
		});
	}

	_openPicker(slot) {
		this._activeSlot = slot;
		const hex = slot === 'a' ? this.viewport.background.colorA : this.viewport.background.colorB;
		const anchor = slot === 'a' ? this.swatchA : this.swatchB;
		this.picker.show(hex, 255, anchor);
	}

	_apply(hex, commit) {
		if (this._activeSlot === 'a') this.viewport.setBackground({ colorA: hex });
		else if (this._activeSlot === 'b') this.viewport.setBackground({ colorB: hex });
		this._sync();
	}

	_position(anchor) {
		const r = anchor.getBoundingClientRect();
		const w = this.root.offsetWidth;
		const h = this.root.offsetHeight;
		let x = r.left;
		let y = r.bottom + 6;
		if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
		if (y + h > window.innerHeight - 8) y = r.top - h - 6;
		if (x < 8) x = 8;
		if (y < 8) y = 8;
		this.root.style.left = x + 'px';
		this.root.style.top  = y + 'px';
	}

	_sync() {
		this.textureSelect.value = this.viewport.background.texture;
		this.swatchA.style.background = this.viewport.background.colorA;
		this.swatchB.style.background = this.viewport.background.colorB;
	}
}
