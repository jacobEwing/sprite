import { Tool } from './Tool.js';
import { hexToRGBA, linePoints } from '../paint/pixelUtils.js';

// Accumulative brush. Deposits a small fraction of the colour on every
// animation frame while the button is held. Dwelling builds up; fast
// strokes leave a light trail. Brush mask weights scale the deposit
// per-cell, so soft brushes fade at the edges.

export class AirbrushTool extends Tool {
	constructor(context) {
		super(context);
		this.transaction = null;
		this.color = null;
		this.lastX = null;
		this.lastY = null;
		this.currentX = null;
		this.currentY = null;
		this.rafId = null;
		this.onlyOpaque = false;

		// Slider value, 1–30. The actual deposit rate is computed from
		// this quadratically (see _depositRate), so the low end — where
		// fine control matters — gets more slider travel.
		this.flow = 8;
	}

	onPointerDown(ev) {
		const tx = this.context.beginStroke();
		if (!tx) return;
		this.transaction = tx;
		this.color = this._colorFor(ev.button);
		this.currentX = this.lastX = ev.imageX;
		this.currentY = this.lastY = ev.imageY;
		this._startLoop();
	}

	onPointerMove(ev) {
		if (!this.transaction) return;
		this.currentX = ev.imageX;
		this.currentY = ev.imageY;
	}

	onPointerUp() {
		this._stopLoop();
		if (!this.transaction) return;
		const cmd = this.transaction.commit();
		this.transaction = null;
		this.color = null;
		if (cmd) this.context.history.push(cmd);
	}

	onCancel() {
		this._stopLoop();
		if (this.transaction) {
			const cmd = this.transaction.commit();
			if (cmd) this.context.history.push(cmd);
		}
		this.transaction = null;
		this.color = null;
	}

	// --- tick loop --------------------------------------------------------

	_startLoop() {
		if (this.rafId) return;
		const tick = () => {
			this.rafId = null;
			if (!this.transaction) return;

			linePoints(this.lastX, this.lastY, this.currentX, this.currentY, (x, y) => {
				this._stampAt(x, y);
			});
			this.transaction.flush();

			// Let the viewport know the sheet's pixels changed, so it
			// redraws. Without this, stationary buildup is invisible until
			// the next mouse move triggers a redraw.
			this.context.viewport.invalidate();

			this.lastX = this.currentX;
			this.lastY = this.currentY;
			this.rafId = requestAnimationFrame(tick);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	_stopLoop() {
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.rafId = null;
	}

	// --- painting ---------------------------------------------------------

	_stampAt(x, y) {
		const brush = this.context.brush;
		const color = this.color;
		if (!color) return;
		const colorAlpha = color[3] / 255;
		const deposit = this._depositRate();

		brush.forEachPixel(x, y, (px, py, weight) => {
			const a = colorAlpha * weight * deposit;
			if (a <= 0) return;
			this._blendPixel(px, py, color, a);
		});
	}

	// Composite `color` over the existing pixel at (x, y) with source
	// alpha `a`. Reads the working buffer, so consecutive stamps within
	// the same tick accumulate.
	_blendPixel(x, y, color, a) {
		const existing = this.transaction.getPixel(x, y);
		if (!existing) return;
		if (this.onlyOpaque && existing[3] === 0) return;

		const da = existing[3] / 255;
		const outA = a + da * (1 - a);
		if (outA <= 0) return;

		const r = Math.round((color[0] * a + existing[0] * da * (1 - a)) / outA);
		const g = Math.round((color[1] * a + existing[1] * da * (1 - a)) / outA);
		const b = Math.round((color[2] * a + existing[2] * da * (1 - a)) / outA);
		this.transaction.setPixel(x, y, [r, g, b, Math.round(outA * 255)]);
	}

	_colorFor(button) {
		const p = this.context.palette;
		const color = button === 2 ? p.secondary : p.primary;
		return hexToRGBA(color.hex, color.alpha) ?? [0, 0, 0, 255];
	}

	// Deposit per tick, 0..1. Quadratic in the slider value so the low
	// end (1–3%) occupies a larger fraction of the slider's travel than
	// it would on a linear mapping. At flow=30 the rate is 30%.
	_depositRate() {
		const t = this.flow / 30;
		return t * t * 0.30;
	}

	getSettings() {
		return [
			{
				key: 'flow',
				label: 'Flow',
				type: 'range',
				min: 1, max: 30, step: 1,
				format: (v) => {
					const pct = (v / 30) ** 2 * 30;
					return pct < 1 ? pct.toFixed(2) + '%' : pct.toFixed(1) + '%';
				},
			},
			{ key: 'onlyOpaque', label: 'Opaque only', type: 'checkbox' },
		];
	}

	getSettingValue(key) {
		if (key === 'flow')       return this.flow;
		if (key === 'onlyOpaque') return this.onlyOpaque;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'flow') this.flow = Math.max(1, Math.min(30, Number(value) || 1));
		else if (key === 'onlyOpaque') this.onlyOpaque = !!value;
	}

}
