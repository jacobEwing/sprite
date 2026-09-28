import { Tool } from './Tool.js';

// Move the selected frames around the atlas. With a single frame selected,
// drag moves its rect. With several selected, drag moves them all together
// by the same offset.
//
// Alt-click swaps the primary frame with the frame under the cursor,
// exchanging positions and pixel contents in one undoable step.
//
// Shift-click extends the selection to a rectangular block of frames:
// everything whose origin falls within the bounding box of the anchor
// frame and the frame just clicked.
//
// Settings:
//   moveContents — when true, a drag carries the frames' pixels along
//                  with their rects. When false (default), only the rect
//                  definitions move; the pixels at the old locations stay.
export class FrameTool extends Tool {
	constructor(context) {
		super(context);
		this.drag = null;

		this.moveContents = false;

		// Tells ToolLayer to pass shift-clicks straight through, so this
		// tool can implement the range-select gesture itself. Without it
		// the frame under the cursor becomes the primary before the tool
		// sees the event, and the range anchor is lost.
		this.shiftClickHandled = true;

		// FrameTool operates on the whole atlas and does its own
		// hit-testing, so the cell-change guard doesn't apply.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		// Alt-click is handled globally by ToolLayer (frame swap). If it
		// reached us, it didn't hit a swappable frame — don't start a drag.
		if (ev.altKey) return;

		// Shift-click: extend selection to a rectangular range.
		if (ev.shiftKey) {
			const targetName = this.context.viewport.getFrameAt(
				Math.floor(ev.imageX), Math.floor(ev.imageY)
			);
			if (targetName) {
				this.context.document.selectFrameRectRange(targetName);
			}
			return;
		}

		// Normal drag: the click must land inside a selected frame.
		const x = Math.floor(ev.imageX);
		const y = Math.floor(ev.imageY);
		const hitName = this.context.viewport.getFrameAt(x, y);
		const selected = this.context.document.selectedFrames;
		if (!hitName || !selected.has(hitName)) return;

		const sheet = this.context.document.sheet;
		const snapshot = [];
		for (const name of selected) {
			const f = sheet.frames[name];
			if (!f) continue;
			snapshot.push({ name, x: f.x, y: f.y, width: f.width, height: f.height });
		}
		if (snapshot.length === 0) return;

		this.drag = {
			startX: ev.imageX,
			startY: ev.imageY,
			snapshot,
		};
		this._pendingDx = 0;
		this._pendingDy = 0;
		this._updatePreview(0, 0);
	}

	onPointerMove(ev) {
		if (!this.drag) return;
		let dx = Math.round(ev.imageX - this.drag.startX);
		let dy = Math.round(ev.imageY - this.drag.startY);

		if (this.context.snapToGrid) {
			const sheet = this.context.document.sheet;
			const gw = sheet.frameWidth  || 0;
			const gh = sheet.frameHeight || 0;
			if (gw > 0) dx = Math.round(dx / gw) * gw;
			if (gh > 0) dy = Math.round(dy / gh) * gh;
		}

		this._pendingDx = dx;
		this._pendingDy = dy;
		this._updatePreview(dx, dy);
	}

	onPointerUp() {
		if (!this.drag) return;
		const dx = this._pendingDx;
		const dy = this._pendingDy;
		const names = this.drag.snapshot.map(s => s.name);
		this.drag = null;
		this.context.viewport.setPreview(null);

		if (dx === 0 && dy === 0) return;
		this.context.document.editable.moveFramesWithContents(
			names, dx, dy, this.moveContents
		);
	}

	onCancel() {
		this.drag = null;
		this._pendingDx = 0;
		this._pendingDy = 0;
		this.context.viewport.setPreview(null);
	}

	_updatePreview(dx, dy) {
		if (!this.drag) return;
		const snapshot = this.drag.snapshot;
		const v = this.context.viewport;
		v.setPreview((ctx) => {
			const hairline = 1 / v.zoom;
			ctx.save();
			for (const s of snapshot) {
				const nx = s.x + dx;
				const ny = s.y + dy;
				ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
				ctx.lineWidth = hairline * 3;
				ctx.strokeRect(nx, ny, s.width, s.height);
				ctx.strokeStyle = '#d08040';
				ctx.lineWidth = hairline * 1.5;
				ctx.strokeRect(nx, ny, s.width, s.height);
			}
			ctx.restore();
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
