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
// Alpha is part of the colour: the swatches show it, recents preserve it,
// and presets always set it back to 255.

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
			this.palette.setPrimary(hex, alpha, { pushRecent });
		} else if (this._openSlot === 'secondary') {
			this.palette.setSecondary(hex, alpha, { pushRecent });
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
					input.value = this.palette[slot].hex;
					input.blur();
				}
			});
		}

		this.root.querySelector('.pal-swap')
			.addEventListener('click', () => this.palette.swap());

		this._buildPresetGrid(this.presetsGrid, PRESETS);
	}

	_openPicker(slot) {
		this._openSlot = slot;
		const color = this.palette[slot];
		const anchor = slot === 'primary' ? this.swatchPrimary : this.swatchSecondary;
		this.picker.show(color.hex, color.alpha, anchor);
	}

	_buildPresetGrid(container, hexes) {
		container.innerHTML = '';
		for (const hex of hexes) this._makeColorCell(container, { hex, alpha: 255 });
	}

	_buildRecentGrid(container, colors) {
		container.innerHTML = '';
		for (const color of colors) this._makeColorCell(container, color);
	}

	_makeColorCell(container, color) {
		const btn = document.createElement('button');
		btn.className = 'pal-cell';
		btn.dataset.hex = color.hex;
		btn.dataset.alpha = String(color.alpha);
		btn.title = color.alpha === 255
			? color.hex
			: `${color.hex} α${color.alpha}`;
		btn.style.setProperty('--cell-color', _cssFor(color));

		// Use mousedown rather than click so right-click registers before
		// the browser's contextmenu fires.
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			if (e.button === 2) this.palette.setSecondary(color.hex, color.alpha);
			else                this.palette.setPrimary(color.hex, color.alpha);
		});
		btn.addEventListener('contextmenu', (e) => e.preventDefault());

		container.appendChild(btn);
	}

	_commitHex(slot, raw) {
		const hex = normalizeHex(raw);
		if (!hex) { this._sync(); return; }
		// Preserve the current alpha; the hex field only edits the hex part.
		if (slot === 'primary') this.palette.setPrimary(hex);
		else                    this.palette.setSecondary(hex);
	}

	_sync() {
		const p = this.palette;

		this._paintSwatch(this.swatchPrimary,   p.primary);
		this._paintSwatch(this.swatchSecondary, p.secondary);

		if (document.activeElement !== this.hexPrimary)   this.hexPrimary.value   = p.primary.hex;
		if (document.activeElement !== this.hexSecondary) this.hexSecondary.value = p.secondary.hex;

		this._buildRecentGrid(this.recentGrid, p.recent);
	}

	_paintSwatch(swatchEl, color) {
		const inner = swatchEl.querySelector('.pal-swatch-color');
		if (inner) inner.style.background = _cssFor(color);
	}
}

function _cssFor(color) {
	const [r, g, b] = hexToRGBA(color.hex) ?? [0, 0, 0];
	return `rgba(${r}, ${g}, ${b}, ${color.alpha / 255})`;
}
