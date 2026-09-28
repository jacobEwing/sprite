import { Tool } from './Tool.js';

// Drag to pan the viewport. Works on any mouse button; ToolLayer routes
// middle-button gestures here regardless of which tool is active.
export class PanTool extends Tool {
	constructor(context) {
		super(context);
		this.start = null;

		// Panning is global - it doesn't act on a frame, so the cell-change
		// guard doesn't apply.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		const v = this.context.viewport;
		this.start = {
			screenX: ev.screenX,
			screenY: ev.screenY,
			offsetX: v.offsetX,
			offsetY: v.offsetY,
		};
	}

	onPointerMove(ev) {
		if (!this.start) return;
		const v = this.context.viewport;
		v.offsetX = this.start.offsetX + (ev.screenX - this.start.screenX);
		v.offsetY = this.start.offsetY + (ev.screenY - this.start.screenY);
		v.emit('view', { zoom: v.zoom });
		v.invalidate();
	}

	onPointerUp()  { this.start = null; }
	onCancel()     { this.start = null; }
}
