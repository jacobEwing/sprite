import { Tool } from './Tool.js';

// Drag to define a rectangular selection in image space. Click without
// dragging clears the selection. Clipping to the frame (when the Clip
// toggle is on) keeps the marquee inside the frame's bounds.
export class SelectionTool extends Tool {
	constructor(context) {
		super(context);
		this.anchorX = null;
		this.anchorY = null;
		this.moved = false;

		// The marquee's gesture *is* the click-drag. Deferring it would
		// mean the drag that started in a new cell did nothing, which is
		// worse than the current behaviour.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		if (ev.button !== 0) return;
		let x = ev.imageX;
		let y = ev.imageY;
		if (this.context.clipToFrame) {
			const frame = this.context.document.getSelectedFrame();
			if (frame) {
				x = Math.max(frame.x, Math.min(frame.x + frame.width,  x));
				y = Math.max(frame.y, Math.min(frame.y + frame.height, y));
			}
		}
		this.anchorX = x;
		this.anchorY = y;
		this.moved = false;
	}

	onPointerMove(ev) {
		if (this.anchorX === null) return;
		this.moved = true;

		let x1 = this.anchorX;
		let y1 = this.anchorY;
		let x2 = ev.imageX;
		let y2 = ev.imageY;

		if (this.context.clipToFrame) {
			const frame = this.context.document.getSelectedFrame();
			if (frame) {
				const fx1 = frame.x;
				const fy1 = frame.y;
				const fx2 = frame.x + frame.width;
				const fy2 = frame.y + frame.height;
				x1 = Math.max(fx1, Math.min(fx2, x1));
				y1 = Math.max(fy1, Math.min(fy2, y1));
				x2 = Math.max(fx1, Math.min(fx2, x2));
				y2 = Math.max(fy1, Math.min(fy2, y2));
			}
		}

		const sel = this.context.document.selection;
		sel.setFromDrag(x1, y1, x2, y2);
		this.context.document._emitSelectionModified();
	}

	onPointerUp(ev) {
		if (this.anchorX === null) return;
		if (!this.moved) {
			this.context.document.clearSelection();
		}
		this.anchorX = null;
		this.anchorY = null;
		this.moved = false;
	}

	onCancel() {
		this.anchorX = null;
		this.anchorY = null;
		this.moved = false;
	}
}
