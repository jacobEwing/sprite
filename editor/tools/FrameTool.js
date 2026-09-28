import { Tool } from './Tool.js';

// Move the selected frame's rect around the atlas. Shift-click swaps the
// selected frame with the frame under the cursor, exchanging positions and
// pixel contents in one undoable step.
//
// Settings:
//   moveContents — when true, a drag carries the frame's pixels along
//                  with its rect. When false (default), only the rect
//                  definition moves; the pixels at the old location stay.
export class FrameTool extends Tool {
	constructor(context) {
		super(context);
		this.drag = null;
		this._pendingSwap = null;
		this.moveContents = false;

		// Signals to ToolLayer that a shift-click should bypass the
		// automatic frame-selection path, so this tool can implement its
		// own gesture using the previously-selected frame.
		this.shiftClickHandled = true;

		// The frame mover works on the whole atlas and does its own
		// hit-testing, so the cell-change guard from ToolLayer doesn't
		// apply.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		// Shift-click swaps with the frame under the cursor.
		if (ev.shiftKey) {
			const targetName = this.context.viewport.getFrameAt(
				Math.floor(ev.imageX), Math.floor(ev.imageY)
			);
			const sourceName = this.context.document.selectedFrame;
			if (targetName && sourceName && targetName !== sourceName) {
				this._pendingSwap = { source: sourceName, target: targetName };
			}
			return;
		}

		// Normal drag: hit-test the selected frame's rect.
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
		let nx = this.drag.frameX + dx;
		let ny = this.drag.frameY + dy;

		if (this.context.snapToGrid) {
			const sheet = this.context.document.sheet;
			const gw = sheet.frameWidth  || 0;
			const gh = sheet.frameHeight || 0;
			if (gw > 0) nx = Math.round(nx / gw) * gw;
			if (gh > 0) ny = Math.round(ny / gh) * gh;
		}

		this._pendingX = nx;
		this._pendingY = ny;
		this._updatePreview(nx, ny);
	}

	onPointerUp(ev) {
		if (this._pendingSwap) {
			const { source, target } = this._pendingSwap;
			this._pendingSwap = null;
			this.context.document.editable.swapFrames(source, target);
			return;
		}

		if (!this.drag) return;
		const name = this.drag.name;
		const nx = this._pendingX ?? this.drag.frameX;
		const ny = this._pendingY ?? this.drag.frameY;
		const moved = nx !== this.drag.frameX || ny !== this.drag.frameY;

		this.drag = null;
		this._pendingX = null;
		this._pendingY = null;
		this.context.viewport.setPreview(null);

		if (!moved) return;
		const current = this.context.document.sheet.frames[name];
		if (!current) return;

		this.context.document.editable.moveFrameWithContents(
			name, nx, ny, this.moveContents
		);
	}

	onCancel() {
		this.drag = null;
		this._pendingSwap = null;
		this._pendingX = null;
		this._pendingY = null;
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

	getSettings() {
		return [{
			key: 'moveContents',
			label: 'Move contents',
			type: 'checkbox',
		}];
	}

	getSettingValue(key) {
		if (key === 'moveContents') return this.moveContents;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'moveContents') this.moveContents = !!value;
	}
}
