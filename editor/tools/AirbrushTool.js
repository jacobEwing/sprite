import { Tool } from './Tool.js';
import { hexToRGBA, linePoints } from '../paint/pixelUtils.js';

// Accumulative brush with two deposit modes.
//
// Smooth (default): every pixel under the brush receives a small
// fraction of the palette colour per animation tick. Dwelling builds
// up; fast strokes leave a light trail. Brush mask weights scale the
// per-cell deposit, so soft brushes feather at the edges.
//
// Random pixels: each tick picks `flow` pixel positions at random from
// the brush mask (weighted, so soft brushes still concentrate in the
// centre) and composites the palette colour onto each. Repeated hits
// accumulate, matching a classic spray-can airbrush. No interpolation
// between ticks — dwelling in one spot hammers it; sweeping spreads
// the deposits over a wider area.

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
		this.randomMode = false;
		this._randomAccumulator = 0;

		// Slider value, 1–30. In smooth mode this drives a quadratic
		// deposit rate (see _depositRate); in random mode it's the number
		// of pixel attempts per animation tick.
		this.flow = 8;
	}

	onPointerDown(ev) {
		const tx = this.context.beginStroke();
		if (!tx) return;
		this.transaction = tx;
		this.color = this._colorFor(ev.button);
		this.currentX = this.lastX = ev.imageX;
		this.currentY = this.lastY = ev.imageY;
		this._randomAccumulator = 0;
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
		let lastTime = 0;

		const tick = (time) => {
			this.rafId = null;
			if (!this.transaction) return;

			const dtMs = lastTime ? Math.min(time - lastTime, 100) : 16;
			lastTime = time;

			if (this.randomMode) {
				// Accumulate the desired number of pixels since the
				// previous tick. Emit the integer part now, carry the
				// remainder to the next tick. Keeps long-run average
				// exactly at the requested rate, regardless of frame
				// timing.
				this._randomAccumulator += this._pixelsPerSecond() * (dtMs / 1000);
				const attempts = Math.floor(this._randomAccumulator);
				if (attempts > 0) {
					this._randomAccumulator -= attempts;
					this._stampRandom(this.currentX, this.currentY, attempts);
				}
			} else {
				linePoints(this.lastX, this.lastY, this.currentX, this.currentY, (x, y) => {
					this._stampAt(x, y);
				});
			}

			this.transaction.flush();
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

	// Smooth mode: deposit on every pixel under the brush.
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

	// Random mode: pick `flow` pixel positions from the mask at random,
	// weighted by mask value, and composite the palette colour onto each.
	// The colour's own alpha governs how strongly each deposit mixes in.
	//
	// Attempt count follows a quadratic curve against the slider value,
	// matching smooth mode: the low end (where fine control matters) gets
	// far more slider travel than it would on a linear mapping. At
	// slider=30 the rate is the maximum; at slider=1 it's one pixel per
	// tick, the sparsest setting that still produces output.
	_stampRandom(cx, cy, attempts) {
		const brush = this.context.brush;
		const color = this.color;
		if (!color) return;

		const cells = [];
		let total = 0;
		for (let my = 0; my < brush.height; my++) {
			for (let mx = 0; mx < brush.width; mx++) {
				const w = brush.mask[my][mx];
				if (w > 0) { cells.push({ mx, my, w }); total += w; }
			}
		}
		if (total <= 0) return;

		const ox = Math.floor(cx) - brush.anchorX;
		const oy = Math.floor(cy) - brush.anchorY;
		const sourceAlpha = color[3] / 255;

		for (let i = 0; i < attempts; i++) {
			let r = Math.random() * total;
			let pick = cells[cells.length - 1];
			for (const c of cells) {
				r -= c.w;
				if (r <= 0) { pick = c; break; }
			}
			this._blendPixel(ox + pick.mx, oy + pick.my, color, sourceAlpha);
		}
	}

	// Emission rate in random mode, in pixels per second. Quadratic in
	// the slider value, with a floor of 1 so the minimum setting still
	// produces output. At slider 30 the rate is 300 px/s — roughly five
	// pixels per animation frame at 60Hz, which reads as a dense spray
	// without being instant.
	_pixelsPerSecond(sliderValue = this.flow) {
		const t = sliderValue / 30;
		return Math.max(1, t * t * 300);
	}

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
		const flowSetting = this.randomMode
			? {
				key: 'flow',
				label: 'Flow',
				type: 'range',
				min: 1, max: 30, step: 1,
				format: (v) => `${Math.round(this._pixelsPerSecond(v))} px/s`,
			}
			: {
				key: 'flow',
				label: 'Flow',
				type: 'range',
				min: 1, max: 30, step: 1,
				format: (v) => {
					const pct = (v / 30) ** 2 * 30;
					return pct < 1 ? pct.toFixed(2) + '%' : pct.toFixed(1) + '%';
				},
			};

		return [
			{ key: 'randomMode', label: 'Random pixels', type: 'checkbox' },
			flowSetting,
			{ key: 'onlyOpaque', label: 'Opaque only', type: 'checkbox' },
		];
	}

	getSettingValue(key) {
		if (key === 'flow')       return this.flow;
		if (key === 'onlyOpaque') return this.onlyOpaque;
		if (key === 'randomMode') return this.randomMode;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'flow')            this.flow = Math.max(1, Math.min(30, Number(value) || 1));
		else if (key === 'onlyOpaque') this.onlyOpaque = !!value;
		else if (key === 'randomMode') this.randomMode = !!value;
	}
}
