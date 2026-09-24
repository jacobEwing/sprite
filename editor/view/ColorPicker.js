import { hsvToRgb, rgbToHsv } from '../paint/colorConvert.js';
import { hexToRGBA, rgbaToHex, normalizeHex } from '../paint/pixelUtils.js';

const SV_SIZE   = 180;
const HUE_WIDTH = 20;

// A popover colour picker: SV square on the left, hue strip on the right,
// hex field underneath. Positioned next to an anchor element; dismissed by
// clicking outside it or pressing Escape.
//
// Two callbacks:
//   onLiveChange(hex) — every change while dragging or typing
//   onCommit(hex)     — once per interaction (pointer-up or Enter)
//
// The distinction exists so the recent-colours list records one entry per
// deliberate pick, not one per pixel of drag.
export class ColorPicker {
	constructor() {
		this.h = 0;
		this.s = 1;
		this.v = 1;
		this._onLive   = null;
		this._onCommit = null;
		this._anchor   = null;
		this._drag     = null;

		this._build();
		this._bindGlobal();
	}

	onLiveChange(fn) { this._onLive   = fn; return this; }
	onCommit(fn)     { this._onCommit = fn; return this; }

	get isOpen() { return this.root.style.display !== 'none'; }

	show(hex, anchor) {
		const norm = normalizeHex(hex);
		if (norm) {
			const [r, g, b] = hexToRGBA(norm);
			const [h, s, v] = rgbToHsv(r, g, b);
			this.h = h; this.s = s; this.v = v;
		}
		this._anchor = anchor;
		this._open();
	}

	hide() {
		this.root.style.display = 'none';
		this._anchor = null;
		this._drag = null;
	}

	// --- construction -----------------------------------------------------

	_build() {
		this.root = document.createElement('div');
		this.root.className = 'cp-popover';
		this.root.style.display = 'none';
		this.root.innerHTML = `
			<div class="cp-body">
				<canvas class="cp-sv"  width="${SV_SIZE}"   height="${SV_SIZE}"></canvas>
				<canvas class="cp-hue" width="${HUE_WIDTH}" height="${SV_SIZE}"></canvas>
			</div>
			<div class="cp-footer">
				<span class="cp-hash">#</span>
				<input class="cp-hex" type="text" maxlength="7" spellcheck="false">
			</div>
		`;
		document.body.appendChild(this.root);

		this.svCanvas  = this.root.querySelector('.cp-sv');
		this.hueCanvas = this.root.querySelector('.cp-hue');
		this.hexInput  = this.root.querySelector('.cp-hex');

		this.svCanvas .addEventListener('mousedown', (e) => this._startDrag(e, 'sv'));
		this.hueCanvas.addEventListener('mousedown', (e) => this._startDrag(e, 'hue'));

		this.hexInput.addEventListener('change',  () => this._commitHex());
		this.hexInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this._commitHex();
				this.hexInput.blur();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this._syncInputs();
				this.hexInput.blur();
			}
		});
	}

	_bindGlobal() {
		document.addEventListener('mousedown', (e) => {
			if (!this.isOpen) return;
			if (this.root.contains(e.target)) return;
			if (this._anchor && this._anchor.contains(e.target)) return;
			this.hide();
		});
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.isOpen) this.hide();
		});
	}

	// --- popover placement ------------------------------------------------

	_open() {
		// Show off-screen first so we can measure the rendered size.
		this.root.style.visibility = 'hidden';
		this.root.style.display = 'block';
		this._render();

		const w = this.root.offsetWidth;
		const h = this.root.offsetHeight;
		const r = this._anchor.getBoundingClientRect();

		let x = r.left;
		let y = r.bottom + 6;
		if (x + w > window.innerWidth  - 8) x = window.innerWidth  - w - 8;
		if (y + h > window.innerHeight - 8) y = r.top - h - 6;
		if (y < 8) y = 8;

		this.root.style.left = x + 'px';
		this.root.style.top  = y + 'px';
		this.root.style.visibility = '';
	}

	// --- interaction ------------------------------------------------------

	_startDrag(e, which) {
		e.preventDefault();
		this._drag = which;
		this._updateFromEvent(e, which);

		const onMove = (ev) => this._updateFromEvent(ev, which);
		const onUp   = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup',   onUp);
			this._drag = null;
			this._commit();
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup',   onUp);
	}

	_updateFromEvent(e, which) {
		const el = which === 'sv' ? this.svCanvas : this.hueCanvas;
		const r  = el.getBoundingClientRect();
		const x  = (e.clientX - r.left) / r.width;
		const y  = (e.clientY - r.top)  / r.height;

		if (which === 'sv') {
			this.s = Math.max(0, Math.min(1, x));
			this.v = 1 - Math.max(0, Math.min(1, y));
		} else {
			this.h = Math.max(0, Math.min(1, y)) * 360;
		}

		this._render();
		if (this._onLive) this._onLive(this._currentHex());
	}

	_commitHex() {
		const norm = normalizeHex(this.hexInput.value);
		if (!norm) { this._syncInputs(); return; }
		const [r, g, b] = hexToRGBA(norm);
		const [h, s, v] = rgbToHsv(r, g, b);
		this.h = h; this.s = s; this.v = v;
		this._render();
		if (this._onLive)   this._onLive(this._currentHex());
		if (this._onCommit) this._onCommit(this._currentHex());
	}

	_commit() {
		if (this._onCommit) this._onCommit(this._currentHex());
	}

	// --- rendering --------------------------------------------------------

	_currentHex() {
		const [r, g, b] = hsvToRgb(this.h, this.s, this.v);
		return rgbaToHex(r, g, b);
	}

	_render() {
		this._renderSv();
		this._renderHue();
		this._syncInputs();
	}

	_syncInputs() {
		if (document.activeElement !== this.hexInput) {
			this.hexInput.value = this._currentHex();
		}
	}

	_renderSv() {
		const ctx = this.svCanvas.getContext('2d');
		const w = this.svCanvas.width;
		const h = this.svCanvas.height;
		const [r, g, b] = hsvToRgb(this.h, 1, 1);

		const gradX = ctx.createLinearGradient(0, 0, w, 0);
		gradX.addColorStop(0, '#ffffff');
		gradX.addColorStop(1, `rgb(${r},${g},${b})`);
		ctx.fillStyle = gradX;
		ctx.fillRect(0, 0, w, h);

		const gradY = ctx.createLinearGradient(0, 0, 0, h);
		gradY.addColorStop(0, 'rgba(0,0,0,0)');
		gradY.addColorStop(1, 'rgba(0,0,0,1)');
		ctx.fillStyle = gradY;
		ctx.fillRect(0, 0, w, h);

		const cx = this.s * w;
		const cy = (1 - this.v) * h;

		ctx.strokeStyle = 'rgba(0,0,0,0.75)';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(cx, cy, 6, 0, Math.PI * 2);
		ctx.stroke();

		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, 6, 0, Math.PI * 2);
		ctx.stroke();
	}

	_renderHue() {
		const ctx = this.hueCanvas.getContext('2d');
		const w = this.hueCanvas.width;
		const h = this.hueCanvas.height;

		const grad = ctx.createLinearGradient(0, 0, 0, h);
		for (let i = 0; i <= 6; i++) {
			const [r, g, b] = hsvToRgb((i / 6) * 360, 1, 1);
			grad.addColorStop(i / 6, `rgb(${r},${g},${b})`);
		}
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);

		const cy = (this.h / 360) * h;

		ctx.strokeStyle = 'rgba(0,0,0,0.75)';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(0, cy);
		ctx.lineTo(w, cy);
		ctx.stroke();

		ctx.strokeStyle = 'white';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, cy);
		ctx.lineTo(w, cy);
		ctx.stroke();
	}
}
