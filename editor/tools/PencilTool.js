import { Tool } from './Tool.js';
import { hexToRGBA, linePoints } from '../paint/pixelUtils.js';

// Freehand pixel painting. Left button paints the primary colour, right
// button paints the secondary. Interpolates between pointermove samples so
// fast drags produce continuous strokes.
//
// Each pixel is composited at most once per stroke. The tool's opacity
// interpolates between the existing pixel and the palette colour on all
// four channels (including alpha), so opacity 100% writes the palette
// colour exactly — a zero-alpha secondary erases — and lower values move
// partway toward it.
//
// Brush mask weights are ignored — this tool stamps at its own opacity
// regardless of brush shape.
export class PencilTool extends Tool {
	static displayName = 'Pencil';
	static tips = [ 'Left click to draw with the primary colour', 'Right click to draw with the secondary colour' ];

	constructor(context) {
		super(context);
		this.transaction = null;
		this.color = null;
		this.lastX = null;
		this.lastY = null;
		this.opacity = 100;
		this._touched = null;
	}

	onPointerDown(ev) {
		const tx = this.context.beginStroke();
		if (!tx) return;

		this.transaction = tx;
		this.color = this._colorFor(ev.button);
		this.lastX = ev.imageX;
		this.lastY = ev.imageY;
		this._touched = new Set();

		this._stampAt(ev.imageX, ev.imageY);
		this.transaction.flush();
	}

	onPointerMove(ev) {
		if (!this.transaction) return;
		if (ev.imageX === this.lastX && ev.imageY === this.lastY) return;

		linePoints(this.lastX, this.lastY, ev.imageX, ev.imageY, (x, y) => {
			this._stampAt(x, y);
		});

		this.lastX = ev.imageX;
		this.lastY = ev.imageY;
		this.transaction.flush();
	}

	onPointerUp() {
		if (!this.transaction) return;
		const cmd = this.transaction.commit();
		this.transaction = null;
		this.color = null;
		this._touched = null;
		if (cmd) this.context.history.push(cmd);
	}

	onCancel() {
		if (this.transaction) {
			const cmd = this.transaction.commit();
			if (cmd) this.context.history.push(cmd);
		}
		this.transaction = null;
		this.color = null;
		this._touched = null;
	}

	_stampAt(x, y) {
		const brush = this.context.brush;
		const color = this.color;
		if (!color) return;

		const t = this.opacity / 100;
		if (t <= 0) return;

		const r = this.transaction.rect;

		brush.forEachPixel(x, y, (px, py) => {
			const lx = px - r.x;
			const ly = py - r.y;
			if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return;

			const key = ly * r.w + lx;
			if (this._touched.has(key)) return;
			this._touched.add(key);

			this._lerpPixel(px, py, color, t);
		});
	}

	// Interpolate between the existing pixel and the target colour on all
	// four channels. At t = 1 the pixel becomes exactly the palette colour,
	// including its alpha — so a zero-alpha colour erases. At t = 0 nothing
	// changes. Intermediate values move toward the target uniformly.
	//
	// This is not alpha-over compositing. The source alpha is treated the
	// same way as RGB, which is what makes "opacity 100% = replace" hold
	// even when the palette alpha differs from the pixel's.
	_lerpPixel(x, y, color, t) {
		const existing = this.transaction.getPixel(x, y);
		if (!existing) return;

		const inv = 1 - t;
		this.transaction.setPixel(x, y, [
			Math.round(existing[0] * inv + color[0] * t),
			Math.round(existing[1] * inv + color[1] * t),
			Math.round(existing[2] * inv + color[2] * t),
			Math.round(existing[3] * inv + color[3] * t),
		]);
	}

	_colorFor(button) {
		const p = this.context.palette;
		const color = button === 2 ? p.secondary : p.primary;
		return hexToRGBA(color.hex, color.alpha) ?? [0, 0, 0, 255];
	}

	getSettings() {
		return [{
			key: 'opacity',
			label: 'Opacity',
			type: 'range',
			min: 0,
			max: 100,
			step: 1,
			format: (v) => `${v}%`,
		}];
	}

	getSettingValue(key) {
		if (key === 'opacity') return this.opacity;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'opacity') {
			this.opacity = Math.max(0, Math.min(100, Number(value) || 0));
		}
	}
}
