import { Tool } from './Tool.js';
import { hexToRGBA } from '../paint/pixelUtils.js';

// Base class for the drag-a-shape tools. Captures start and end in image
// coordinates, keeps a preview drawn on the viewport during the drag, and
// commits a single StrokeTransaction on release.
//
// Subclasses implement:
//   _drawPreview(ctx, hex)             — draw the shape preview (image space)
//   _paint(transaction, rgba)          — write the shape's pixels
export class ShapeTool extends Tool {
	constructor(context) {
		super(context);
		this.startX = null;
		this.startY = null;
		this.endX = null;
		this.endY = null;
		this.button = null;
	}

	onPointerDown(ev) {
		if (!this.context.selectedFrame()) return;
		this.startX = Math.floor(ev.imageX);
		this.startY = Math.floor(ev.imageY);
		this.endX = this.startX;
		this.endY = this.startY;
		this.button = ev.button;
		this._updatePreview();
	}

	onPointerMove(ev) {
		if (this.startX === null) return;
		this.endX = Math.floor(ev.imageX);
		this.endY = Math.floor(ev.imageY);
		this._updatePreview();
	}

	onPointerUp() {
		if (this.startX === null) return;
		this._commit();
		this._reset();
	}

	onCancel() {
		this._reset();
	}

	// --- internals --------------------------------------------------------

	_reset() {
		this.startX = null;
		this.startY = null;
		this.endX = null;
		this.endY = null;
		this.button = null;
		this.context.viewport.setPreview(null);
	}

	_updatePreview() {
		const tool = this;
		const hex = this._colorHex();
		this.context.viewport.setPreview((ctx) => tool._drawPreview(ctx, hex));
	}

	_commit() {
		const tx = this.context.beginStroke();
		if (!tx) return;
		const rgba = this._colorRGBA();
		this._paint(tx, rgba);
		tx.flush();
		const cmd = tx.commit();
		if (cmd) this.context.history.push(cmd);
	}

	_colorHex() {
		return this.button === 2
			? this.context.palette.secondary
			: this.context.palette.primary;
	}

	_colorRGBA() {
		const p = this.context.palette;
		const color = this.button === 2 ? p.secondary : p.primary;
		return hexToRGBA(color.hex, color.alpha) ?? [0, 0, 0, 255];
	}
}
