import { Tool } from './Tool.js';

// Drag to pan the viewport, or — when a frame is under the cursor and at
// least one drag mode is enabled — move something.
//
// The two drag modes are independent:
//   dragFrames   — the frame's rect moves
//   dragContents — the frame's pixels move (may leave the frame's rect,
//                  landing in neighbouring cells or empty atlas space)
//
// Both on: the frame and its contents travel together, which is what
// most users want for "moving a cell".
//
// Middle-drag always pans, regardless of what's active, because ToolLayer
// routes middle-button gestures here directly.
export class PanTool extends Tool {
	static displayName = 'Pan';
	static tips = [ 'Drag to pan the canvas', 'Middle-drag always pans', 'Drag a selected frame to move it' ];

	constructor(context) {
		super(context);
		this.start = null;

		this.dragFrames   = true;
		this.dragContents = false;

		this.frameDrag = null;
		this._pendingDx = 0;
		this._pendingDy = 0;

		// Panning works on the whole atlas and doesn't act on a frame, so
		// the cell-change guard from ToolLayer doesn't apply.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		// Frame-drag branch: only on left-button, only when at least one
		// drag mode is enabled, and only when the press lands inside a
		// currently-selected frame.
		if ((this.dragFrames || this.dragContents) && ev.button === 0) {
			const x = Math.floor(ev.imageX);
			const y = Math.floor(ev.imageY);
			const hitName = this.context.viewport.getFrameAt(x, y);
			const selected = this.context.document.selectedFrames;

			if (hitName && selected.has(hitName)) {
				const sheet = this.context.document.sheet;
				const snapshot = [];
				for (const name of selected) {
					const f = sheet.frames[name];
					if (!f) continue;
					snapshot.push({
						name,
						x: f.x, y: f.y,
						width: f.width, height: f.height,
					});
				}
				if (snapshot.length > 0) {
					this.frameDrag = {
						startX: ev.imageX,
						startY: ev.imageY,
						snapshot,
					};
					this._pendingDx = 0;
					this._pendingDy = 0;
					this._updatePreview(0, 0);
					return;
				}
			}
		}

		// Otherwise: pan.
		const v = this.context.viewport;
		this.start = {
			screenX: ev.screenX,
			screenY: ev.screenY,
			offsetX: v.offsetX,
			offsetY: v.offsetY,
		};
	}

	onPointerMove(ev) {
		if (this.frameDrag) {
			let dx = Math.round(ev.imageX - this.frameDrag.startX);
			let dy = Math.round(ev.imageY - this.frameDrag.startY);

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
			return;
		}

		if (!this.start) return;
		const v = this.context.viewport;
		v.offsetX = this.start.offsetX + (ev.screenX - this.start.screenX);
		v.offsetY = this.start.offsetY + (ev.screenY - this.start.screenY);
		v.emit('view', { zoom: v.zoom });
		v.invalidate();
	}

	onPointerUp() {
		if (this.frameDrag) {
			const dx = this._pendingDx;
			const dy = this._pendingDy;
			const names = this.frameDrag.snapshot.map(s => s.name);
			this.frameDrag = null;
			this.context.viewport.setPreview(null);

			if (dx !== 0 || dy !== 0) {
				const ed = this.context.document.editable;
				if (this.dragFrames && this.dragContents) {
					ed.translateFramesWithContents(names, dx, dy);
				} else if (this.dragFrames) {
					ed.translateFrames(names, dx, dy);
				} else if (this.dragContents) {
					ed.translateFramesContents(names, dx, dy);
				}
			}
			return;
		}
		this.start = null;
	}

	onCancel() {
		this.start = null;
		this.frameDrag = null;
		this._pendingDx = 0;
		this._pendingDy = 0;
		this.context.viewport.setPreview(null);
	}

	_updatePreview(dx, dy) {
		if (!this.frameDrag) return;
		const snapshot = this.frameDrag.snapshot;
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
		return [
			{ key: 'dragFrames',   label: 'Drag frames',   type: 'checkbox' },
			{ key: 'dragContents', label: 'Drag contents', type: 'checkbox' },
		];
	}

	getSettingValue(key) {
		if (key === 'dragFrames')   return this.dragFrames;
		if (key === 'dragContents') return this.dragContents;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'dragFrames')        this.dragFrames = !!value;
		else if (key === 'dragContents') this.dragContents = !!value;
	}
}
