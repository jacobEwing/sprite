import { Tool } from './Tool.js';
import { linePoints } from '../paint/pixelUtils.js';

// Eraser. Writes transparent pixels through the same stroke transaction the
// pencil uses. Both mouse buttons erase — there is no secondary colour for
// an eraser, so left and right behave identically.
export class EraserTool extends Tool {
	constructor(context) {
		super(context);
		this.transaction = null;
		this.lastX = null;
		this.lastY = null;
		this.opacity = 100;
	}

	onPointerDown(ev) {
		const tx = this.context.beginStroke();
		if (!tx) return;
		this.transaction = tx;
		this.lastX = ev.imageX;
		this.lastY = ev.imageY;
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
		this.lastX = null;
		this.lastY = null;
		if (cmd) this.context.history.push(cmd);
	}

	onCancel() {
		if (this.transaction) {
			const cmd = this.transaction.commit();
			if (cmd) this.context.history.push(cmd);
		}
		this.transaction = null;
		this.lastX = null;
		this.lastY = null;
	}

	_stampAt(x, y) {
		const brush = this.context.brush;
		const opacity = this.opacity / 100;

		// Effective erase strength is opacity × mask weight. At full
		// opacity and weight 1 the pixel's alpha goes to 0; at half and
		// half it retains 75%; at any weight with opacity 0 it's unchanged.
		// RGB is preserved so a later paint at partial alpha blends with
		// the underlying colour rather than the erased residue.
		brush.forEachPixel(x, y, (px, py, weight) => {
			if (weight <= 0) return;
			const existing = this.transaction.getPixel(px, py);
			if (!existing) return;
			const retain = 1 - opacity * weight;
			const newA = Math.round(existing[3] * retain);
			this.transaction.setPixel(px, py, [existing[0], existing[1], existing[2], newA]);
		});
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
		if (key === 'opacity') this.opacity = Math.max(0, Math.min(100, Number(value) || 0));
	}
}
