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
		brush.forEachPixel(x, y, (px, py) => {
			this.transaction.setPixel(px, py, [0, 0, 0, 0]);
		});
	}
}
