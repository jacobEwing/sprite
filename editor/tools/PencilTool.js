import { Tool } from './Tool.js';
import { hexToRGBA, linePoints } from '../paint/pixelUtils.js';

// Freehand pixel painting. Left button paints the primary colour, right
// button paints the secondary. Interpolates between pointermove samples so
// fast drags produce continuous strokes.
export class PencilTool extends Tool {
	constructor(context) {
		super(context);
		this.transaction = null;
		this.color = null;
		this.lastX = null;
		this.lastY = null;
	}

	onPointerDown(ev) {
		const tx = this.context.beginStroke();
		if (!tx) return;

		this.transaction = tx;
		this.color = this._colorFor(ev.button);
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
		this.color = null;
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
		this.color = null;
		this.lastX = null;
		this.lastY = null;
	}

	_stampAt(x, y) {
		const brush = this.context.brush;
		const color = this.color;
		brush.forEachPixel(x, y, (px, py) => {
			this.transaction.setPixel(px, py, color);
		});
	}

	_colorFor(button) {
		const hex = button === 2
			? this.context.palette.secondary
			: this.context.palette.primary;
		return hexToRGBA(hex) ?? [0, 0, 0, 255];
	}
}
