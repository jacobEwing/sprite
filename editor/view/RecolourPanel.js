import { ColorPicker } from './ColorPicker.js';
import { PaintCommand } from '../history/PaintCommand.js';
import { CompositeCommand } from '../model/sheetCommands.js';
import { hexToRGBA, normalizeHex } from '../paint/pixelUtils.js';
import { rgbToHsv, hsvToRgb } from '../paint/colorConvert.js';
import { announcePanelOpen, announcePanelClosed } from '../lib/panelCoordination.js';

// Floating panel for colour replace. Matches pixels by RGB distance from
// a source colour, then shifts the matched pixels in HSV space.
//
// Scope:
//   • Frames — the current frame-list selection, or every frame when
//     "All frames" is checked.
//   • Pixels — within each frame, the whole frame rect unless a pixel
//     selection exists, in which case only the intersection is touched.
//
// Live preview overlays the affected regions. Apply writes one
// PaintCommand per affected frame, wrapped in a CompositeCommand so the
// whole operation is a single undo step.

const MAX_RGB_DIST = Math.sqrt(3) * 255;

export class RecolourPanel {
	constructor(root, doc, viewport, palette) {
		this.root = root;
		this.doc = doc;
		this.viewport = viewport;
		this.palette = palette;

		this.sourceHex = '#000000';
		this.tolerance = 10;
		this.hueShift = 0;
		this.satShift = 0;
		this.valShift = 0;
		this.applyToAll = false;

		this.previewParts = [];   // [{ region, offscreen }]
		this._pending = null;

		this.colorPicker = new ColorPicker();
		this.colorPicker.onLiveChange((hex) => this._setSource(hex, false));
		this.colorPicker.onCommit((hex)     => this._setSource(hex, true));

		this._build();
		this._bind();
		this.hide();

		doc.on('selectionChanged',  () => { if (this.visible) this._schedule(); });
		doc.on('selectionModified', () => { if (this.visible) this._schedule(); });
		doc.on('sheetChanged',      () => { if (this.visible) this._schedule(); });
		doc.on('edit',              () => { if (this.visible) this._schedule(); });

		// Palette changes — from ctrl-to-sample, the Pick tool, or the
		// palette UI itself — update the source while the panel is open.
		// The panel's own colour picker never touches the palette, so
		// there's no feedback loop.
		this.palette.on('change', () => this._onPaletteChange());
	}

	get visible() { return this.root.style.display !== 'none'; }

	show(anchor) {
		announcePanelOpen(this);
		this.sourceHex = this.palette.primary.hex;
		this._sync();
		this.root.style.display = 'block';
		this._positionBelow(anchor);
		this._schedule();
	}

	hide() {
		if (this._pending) {
			cancelAnimationFrame(this._pending);
			this._pending = null;
		}
		this.root.style.display = 'none';
		this.viewport.setPreview(null);
		this.previewParts = [];
		this.colorPicker.hide();
		announcePanelClosed(this);
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root.innerHTML = `
			<div class="fp-header">
				<span class="fp-title">Recolour</span>
				<button class="fp-close" title="Close">✕</button>
			</div>
			<div class="fp-body">
				<div class="fp-row">
					<span class="fp-label">Source</span>
					<button class="rc-swatch" title="Click to change the source colour"></button>
					<input type="text" class="rc-hex" spellcheck="false" maxlength="7">
				</div>

				<div class="fp-row">
					<span class="fp-label">Tolerance</span>
					<input type="range" class="rc-tolerance" min="0" max="100" step="1">
					<span class="rc-readout rc-tol-readout">10%</span>
				</div>

				<label class="fp-checkbox">
					<input type="checkbox" class="rc-all"> All frames
				</label>

				<div class="rc-section-label">Shift matched pixels</div>

				<div class="fp-row">
					<span class="fp-label">Hue</span>
					<input type="range" class="rc-hue" min="-180" max="180" step="1">
					<span class="rc-readout rc-hue-readout">0°</span>
				</div>
				<div class="fp-row">
					<span class="fp-label">Saturation</span>
					<input type="range" class="rc-sat" min="-100" max="100" step="1">
					<span class="rc-readout rc-sat-readout">0%</span>
				</div>
				<div class="fp-row">
					<span class="fp-label">Value</span>
					<input type="range" class="rc-val" min="-100" max="100" step="1">
					<span class="rc-readout rc-val-readout">0%</span>
				</div>

				<p class="fp-hint rc-scope-hint"></p>
			</div>
			<div class="fp-footer">
				<button class="fp-cancel">Cancel</button>
				<button class="fp-apply primary">Apply</button>
			</div>
		`;

		this.swatch       = this.root.querySelector('.rc-swatch');
		this.hexInput     = this.root.querySelector('.rc-hex');
		this.tolSlider    = this.root.querySelector('.rc-tolerance');
		this.tolReadout   = this.root.querySelector('.rc-tol-readout');
		this.allCheckbox  = this.root.querySelector('.rc-all');
		this.hueSlider    = this.root.querySelector('.rc-hue');
		this.hueReadout   = this.root.querySelector('.rc-hue-readout');
		this.satSlider    = this.root.querySelector('.rc-sat');
		this.satReadout   = this.root.querySelector('.rc-sat-readout');
		this.valSlider    = this.root.querySelector('.rc-val');
		this.valReadout   = this.root.querySelector('.rc-val-readout');
		this.scopeHint    = this.root.querySelector('.rc-scope-hint');
	}

	_bind() {
		this.swatch.addEventListener('click', () => {
			this.colorPicker.show(this.sourceHex, 255, this.swatch);
		});

		this.hexInput.addEventListener('change', () => {
			this._setSource(this.hexInput.value, true);
		});
		this.hexInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); this.hexInput.blur(); }
			else if (e.key === 'Escape') {
				this.hexInput.value = this.sourceHex;
				this.hexInput.blur();
			}
		});

		const slider = (el, key) => {
			el.addEventListener('input', () => {
				this[key] = parseFloat(el.value) || 0;
				this._sync();
				this._schedule();
			});
		};
		slider(this.tolSlider, 'tolerance');
		slider(this.hueSlider, 'hueShift');
		slider(this.satSlider, 'satShift');
		slider(this.valSlider, 'valShift');

		this.allCheckbox.addEventListener('change', () => {
			this.applyToAll = this.allCheckbox.checked;
			this._schedule();
		});

		this.root.querySelector('.fp-close').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-cancel').addEventListener('click', () => this.hide());
		this.root.querySelector('.fp-apply').addEventListener('click', () => this._apply());

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.visible) this.hide();
		});
	}

	_setSource(hex, commit) {
		const norm = normalizeHex(hex);
		if (!norm) { this._sync(); return; }
		this.sourceHex = norm;
		this._sync();
		this._schedule();
	}

	// Palette events fire for many reasons; only act when the primary hex
	// actually changed and the panel is open. Alpha-only changes are
	// ignored — the source is an RGB colour, not a colour-with-alpha.
	_onPaletteChange() {
		if (!this.visible) return;
		const norm = normalizeHex(this.palette.primary.hex);
		if (!norm || norm === this.sourceHex) return;
		this.sourceHex = norm;
		this._sync();
		this._schedule();
	}

	_sync() {
		this.swatch.style.background = this.sourceHex;
		if (document.activeElement !== this.hexInput) {
			this.hexInput.value = this.sourceHex;
		}
		this.tolSlider.value = this.tolerance;
		this.tolReadout.textContent = this.tolerance + '%';
		this.hueSlider.value = this.hueShift;
		this.hueReadout.textContent = this.hueShift + '°';
		this.satSlider.value = this.satShift;
		this.satReadout.textContent = this.satShift + '%';
		this.valSlider.value = this.valShift;
		this.valReadout.textContent = this.valShift + '%';
		this.allCheckbox.checked = this.applyToAll;
	}

	_positionBelow(anchor) {
		const r = anchor.getBoundingClientRect();
		const w = this.root.offsetWidth;
		const h = this.root.offsetHeight;
		let x = r.right - w;
		let y = r.bottom + 6;
		if (x < 8) x = 8;
		if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
		if (y + h > window.innerHeight - 8) y = r.top - h - 6;
		if (y < 8) y = 8;
		this.root.style.left = x + 'px';
		this.root.style.top  = y + 'px';
	}

	// --- region selection -------------------------------------------------

	// Frames this operation will touch.
	_framesToProcess() {
		const sheet = this.doc.sheet;
		if (!sheet) return [];
		if (this.applyToAll) return sheet.frameNames;
		return this.doc.selectedFrameList;
	}

	// Within one frame, the rect to touch: the pixel selection intersected
	// with the frame's bounds, or the frame's whole rect if there's no
	// pixel selection. Returns null when the intersection is empty.
	_frameRegion(frame) {
		const frameRect = {
			x: frame.x, y: frame.y, w: frame.width, h: frame.height,
		};
		const sel = this.doc.selection.rect;
		if (!sel) return frameRect;

		const x1 = Math.max(sel.x, frameRect.x);
		const y1 = Math.max(sel.y, frameRect.y);
		const x2 = Math.min(sel.x + sel.w, frameRect.x + frameRect.w);
		const y2 = Math.min(sel.y + sel.h, frameRect.y + frameRect.h);
		if (x2 <= x1 || y2 <= y1) return null;
		return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
	}

	// --- transform --------------------------------------------------------

	_transformPixel(r, g, b, a) {
		if (a === 0) return [r, g, b, a];

		const [sr, sg, sb] = this._sourceRGB();
		const dr = r - sr;
		const dg = g - sg;
		const db = b - sb;
		const dist = Math.sqrt(dr * dr + dg * dg + db * db) / MAX_RGB_DIST;
		if (dist > this.tolerance / 100) return [r, g, b, a];

		let [h, s, v] = rgbToHsv(r, g, b);
		h = ((h + this.hueShift) % 360 + 360) % 360;
		s = Math.max(0, Math.min(1, s * (1 + this.satShift / 100)));
		v = Math.max(0, Math.min(1, v * (1 + this.valShift / 100)));
		const [nr, ng, nb] = hsvToRgb(h, s, v);
		return [nr, ng, nb, a];
	}

	_sourceRGB() {
		return hexToRGBA(this.sourceHex) ?? [0, 0, 0, 255];
	}

	_process(src) {
		const out = new ImageData(src.width, src.height);
		const sd = src.data;
		const od = out.data;
		for (let i = 0; i < sd.length; i += 4) {
			const [r, g, b, a] = this._transformPixel(
				sd[i], sd[i + 1], sd[i + 2], sd[i + 3]
			);
			od[i]     = r;
			od[i + 1] = g;
			od[i + 2] = b;
			od[i + 3] = a;
		}
		return out;
	}

	// --- preview & apply --------------------------------------------------

	_schedule() {
		if (this._pending) return;
		this._pending = requestAnimationFrame(() => {
			this._pending = null;
			this._recompute();
		});
	}

	_recompute() {
		// A queued rAF can outlive the panel when a history push fires
		// during _apply. If the panel is closed by then, bail.
		if (!this.visible) return;

		const sheet = this.doc.sheet;
		if (!sheet || !sheet.image) {
			this.viewport.setPreview(null);
			this.previewParts = [];
			return;
		}

		const frameNames = this._framesToProcess();
		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });

		const parts = [];
		for (const name of frameNames) {
			const frame = sheet.frames[name];
			if (!frame) continue;
			const region = this._frameRegion(frame);
			if (!region) continue;

			const src = ctx.getImageData(region.x, region.y, region.w, region.h);
			const result = this._process(src);

			const offscreen = document.createElement('canvas');
			offscreen.width  = result.width;
			offscreen.height = result.height;
			offscreen.getContext('2d').putImageData(result, 0, 0);

			parts.push({ region, offscreen, imageData: result });
		}

		this.previewParts = parts;

		if (parts.length === 0) {
			this.viewport.setPreview(null);
		} else {
			this.viewport.setPreview((vctx) => {
				for (const part of this.previewParts) {
					this.viewport.redrawBackgroundInRegion(vctx, part.region);
					vctx.drawImage(
						part.offscreen,
						part.region.x, part.region.y,
						part.region.w, part.region.h
					);
				}
			});
		}

		this._updateScopeHint(parts.length);
	}

	_updateScopeHint(frameCount) {
		const hasSel = !!this.doc.selection.rect;
		const total = this.doc.sheet ? this.doc.sheet.frameNames.length : 0;

		let scope;
		if (this.applyToAll) {
			scope = `all ${total} frame${total === 1 ? '' : 's'}`;
		} else {
			scope = `${frameCount} selected frame${frameCount === 1 ? '' : 's'}`;
		}
		if (hasSel) {
			scope += ', limited to the pixel selection';
		}
		this.scopeHint.textContent = `Applies to ${scope}.`;
	}

	_apply() {
		const sheet = this.doc.sheet;
		if (!sheet || this.previewParts.length === 0) { this.hide(); return; }

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const commands = [];

		for (const part of this.previewParts) {
			const { region } = part;
			const before = ctx.getImageData(region.x, region.y, region.w, region.h);
			const after  = part.imageData;
			if (imageDataEqual(before, after)) continue;

			ctx.putImageData(after, region.x, region.y);
			const cmd = new PaintCommand(
				ctx, region.x, region.y, region.w, region.h, before, after
			);
			commands.push(cmd);
		}

		if (commands.length === 0) { this.hide(); return; }

		const composite = commands.length === 1
			? commands[0]
			: new CompositeCommand(commands);
		this.doc.history.push(composite, 'pixels');

		this.hide();
		this.viewport.invalidate();
	}
}

function imageDataEqual(a, b) {
	if (a.width !== b.width || a.height !== b.height) return false;
	const ad = a.data, bd = b.data;
	for (let i = 0; i < ad.length; i++) {
		if (ad[i] !== bd[i]) return false;
	}
	return true;
}
