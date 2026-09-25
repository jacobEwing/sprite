import { Tool } from './Tool.js';

// Drag the selected frame's rect around the atlas. Only the interior is
// draggable; corner handles for resize are a future addition. Releasing
// without moving is a no-op.
export class FrameTool extends Tool {
	constructor(context) {
		super(context);
		this.drag = null;
	}

	onPointerDown(ev) {
		const sel = this.context.selectedFrame();
		if (!sel) return;
		const x = Math.floor(ev.imageX);
		const y = Math.floor(ev.imageY);
		const r = sel.rect;
		if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) return;

		this.drag = {
			name: sel.name,
			startX: ev.imageX,
			startY: ev.imageY,
			frameX: r.x,
			frameY: r.y,
			w: r.w,
			h: r.h,
		};
		this._updatePreview(this.drag.frameX, this.drag.frameY);
	}

	onPointerMove(ev) {
		if (!this.drag) return;
		const dx = Math.round(ev.imageX - this.drag.startX);
		const dy = Math.round(ev.imageY - this.drag.startY);
		this._updatePreview(this.drag.frameX + dx, this.drag.frameY + dy);
	}

	onPointerUp(ev) {
		if (!this.drag) return;
		const dx = Math.round(ev.imageX - this.drag.startX);
		const dy = Math.round(ev.imageY - this.drag.startY);
		const nx = this.drag.frameX + dx;
		const ny = this.drag.frameY + dy;
		const name = this.drag.name;
		this.drag = null;
		this.context.viewport.setPreview(null);

		if (dx === 0 && dy === 0) return;
		const current = this.context.document.sheet.frames[name];
		if (!current) return;
		if (current.x === nx && current.y === ny) return;
		this.context.document.editable.setFrame(name, { x: nx, y: ny });
	}

	onCancel() {
		this.drag = null;
		this.context.viewport.setPreview(null);
	}

	_updatePreview(nx, ny) {
		if (!this.drag) return;
		const { w, h } = this.drag;
		const v = this.context.viewport;
		v.setPreview((ctx) => {
			const hairline = 1 / v.zoom;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
			ctx.lineWidth = hairline * 3;
			ctx.strokeRect(nx, ny, w, h);
			ctx.strokeStyle = '#d08040';
			ctx.lineWidth = hairline * 1.5;
			ctx.strokeRect(nx, ny, w, h);
		});
	}
}
