import { normalizeHex, hexToRGBA } from '../paint/pixelUtils.js';
import { ColorPicker } from './ColorPicker.js';

const PRESETS = [
	'#000000', '#1d2b53', '#7e2553', '#008751',
	'#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
	'#ff004d', '#ffa300', '#ffec27', '#00e436',
	'#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

// Owns the entire Colours pane. Renders primary/secondary swatches, hex
// inputs, swap button, recent-colours grid, and a preset grid.
//
// Interaction model:
//   • Click primary/secondary swatch → opens the colour picker popover
//   • Type in a hex field → sets that slot
//   • Click ⇄ → swaps primary and secondary
//   • Left-click a recent or preset → sets primary
//   • Right-click a recent or preset → sets secondary
export class PalettePanel {
	constructor(root, palette) {
		this.root = root;
		this.palette = palette;
		this._openSlot = null;

		this.picker = new ColorPicker();
		this.picker.onLiveChange((hex, alpha) => this._applySlot(hex, alpha, false));
		this.picker.onCommit((hex, alpha)     => this._applySlot(hex, alpha, true));

		this._build();
		this.palette.on('change', () => this._sync());
		this._sync();
	}

	_applySlot(hex, alpha, pushRecent) {
		if (this._openSlot === 'primary') {
			this.palette.setPrimary(hex, { pushRecent });
			this.palette.setPrimaryAlpha(alpha);
		} else if (this._openSlot === 'secondary') {
			this.palette.setSecondary(hex, { pushRecent });
			this.palette.setSecondaryAlpha(alpha);
		}
	}

	_build() {
		this.root.innerHTML = `
			<div class="pal-slots">
				<div class="pal-slot">
					<div class="pal-slot-label">Primary</div>
					<button class="pal-swatch" data-slot="primary" title="Click to pick a colour">
						<span class="pal-swatch-color"></span>
					</button>
					<input class="pal-hex" type="text" spellcheck="false" maxlength="7" data-slot="primary">
				</div>
				<div class="pal-slot">
					<div class="pal-slot-label">Secondary</div>
					<button class="pal-swatch" data-slot="secondary" title="Click to pick a colour">
						<span class="pal-swatch-color"></span>
					</button>
					<input class="pal-hex" type="text" spellcheck="false" maxlength="7" data-slot="secondary">
				</div>
				<button class="pal-swap" title="Swap primary and secondary (X)">⇄</button>
			</div>

			<div class="pal-section">
				<div class="pal-section-label">Recent</div>
				<div class="pal-grid" data-grid="recent"></div>
			</div>

			<div class="pal-section">
				<div class="pal-section-label">Presets</div>
				<div class="pal-grid" data-grid="presets"></div>
			</div>

			<p class="hint">
				Left-click a swatch to set primary · right-click to set secondary.
			</p>
		`;

		this.swatchPrimary   = this.root.querySelector('.pal-swatch[data-slot="primary"]');
		this.swatchSecondary = this.root.querySelector('.pal-swatch[data-slot="secondary"]');
		this.hexPrimary      = this.root.querySelector('.pal-hex[data-slot="primary"]');
		this.hexSecondary    = this.root.querySelector('.pal-hex[data-slot="secondary"]');
		this.recentGrid      = this.root.querySelector('[data-grid="recent"]');
		this.presetsGrid     = this.root.querySelector('[data-grid="presets"]');

		this.swatchPrimary  .addEventListener('click', () => this._openPicker('primary'));
		this.swatchSecondary.addEventListener('click', () => this._openPicker('secondary'));

		for (const input of [this.hexPrimary, this.hexSecondary]) {
			const slot = input.dataset.slot;
			input.addEventListener('change', () => this._commitHex(slot, input.value));
			input.addEventListener('blur',   () => this._commitHex(slot, input.value));
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
				else if (e.key === 'Escape') {
					input.value = this.palette[slot];
					input.blur();
				}
			});
		}

		this.root.querySelector('.pal-swap')
			.addEventListener('click', () => this.palette.swap());

		this._buildGrid(this.presetsGrid, PRESETS);
	}

	_openPicker(slot) {
		this._openSlot = slot;
		const hex   = slot === 'primary' ? this.palette.primary   : this.palette.secondary;
		const alpha = slot === 'primary' ? this.palette.primaryAlpha : this.palette.secondaryAlpha;
		const anchor = slot === 'primary' ? this.swatchPrimary : this.swatchSecondary;
		this.picker.show(hex, alpha, anchor);
	}

	_buildGrid(container, hexes) {
		container.innerHTML = '';
		for (const hex of hexes) {
			const btn = document.createElement('button');
			btn.className = 'pal-cell';
			btn.dataset.hex = hex;
			btn.title = hex;
			btn.style.background = hex;

			// mousedown rather than click so right-click registers reliably
			// before the browser's contextmenu logic kicks in.
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				if (e.button === 2) {
					this.palette.setSecondary(hex);
					this.palette.setSecondaryAlpha(255);
				} else {
					this.palette.setPrimary(hex);
					this.palette.setPrimaryAlpha(255);
				}
			});

			btn.addEventListener('contextmenu', (e) => e.preventDefault());

			container.appendChild(btn);
		}
	}

	_commitHex(slot, raw) {
		const hex = normalizeHex(raw);
		if (!hex) { this._sync(); return; }
		if (slot === 'primary') this.palette.setPrimary(hex);
		else                    this.palette.setSecondary(hex);
	}

	_sync() {
		const p = this.palette;

		this._paintSwatch(this.swatchPrimary,   p.primary,   p.primaryAlpha);
		this._paintSwatch(this.swatchSecondary, p.secondary, p.secondaryAlpha);

		if (document.activeElement !== this.hexPrimary)   this.hexPrimary.value   = p.primary;
		if (document.activeElement !== this.hexSecondary) this.hexSecondary.value = p.secondary;

		this._buildGrid(this.recentGrid, p.recent);
	}

	_paintSwatch(swatchEl, hex, alpha) {
		const [r, g, b] = hexToRGBA(hex) ?? [0, 0, 0];
		const inner = swatchEl.querySelector('.pal-swatch-color');
		if (inner) inner.style.background = `rgba(${r},${g},${b},${alpha / 255})`;
	}
}
