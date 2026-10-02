import { Tool } from './Tool.js';
import { circleAt } from '../model/collisionUtils.js';

// Drag existing circles; drag on empty space to create a new one; right-
// click a circle to delete it.
//
// Every frame owns its own collision. There is no sheet-level fallback,
// so a gesture on a frame with no collision simply adds the first circle
// to that frame; nothing is inherited from anywhere else.
export class CollisionTool extends Tool {
	static displayName = 'Hit regions';
	static tips = [ 'Click and drag to create a hit region or move an existing one', 'Right click to remove an existing region' ];

	constructor(context) {
		super(context);
		this.mode = null;      // 'move' | 'create' | null
		this.index = -1;
		this.start = null;
		this.currentX = 0;
		this.currentY = 0;

		// Persistent user preference: whether collision circles are shown
		// for every frame even when this tool isn't active. When the tool
		// *is* active, the overlay is always shown regardless of this flag.
		this.showOverlay = true;
		this.onSettingChanged = null;
	}

	onPointerDown(ev) {
		const overlay = this.context.collisionOverlay;
		if (!overlay) return;
		const frame = this.context.document.getSelectedFrame();
		if (!frame) return;

		const circles = overlay.currentCircles();
		const x = ev.imageX;
		const y = ev.imageY;
		const hit = circleAt(circles, x, y);

		if (hit === -1) {
			if (ev.button === 2) return;
			this.mode = 'create';
			this.start = { x, y };
			this.currentX = x;
			this.currentY = y;
			overlay.setPendingPreview({ x, y, radius: 0 });
			return;
		}

		if (ev.button === 2) {
			this._removeCircle(hit);
			return;
		}

		this.mode = 'move';
		this.index = hit;
		const c = circles[hit];
		this.start = { x, y, cx: c.x, cy: c.y, radius: c.radius };
		overlay.setDragPreview(hit, c.x, c.y, c.radius);
	}

	onPointerMove(ev) {
		if (!this.mode) return;
		const overlay = this.context.collisionOverlay;
		if (!overlay) return;

		if (this.mode === 'move') {
			const dx = ev.imageX - this.start.x;
			const dy = ev.imageY - this.start.y;
			this.currentX = this.start.cx + dx;
			this.currentY = this.start.cy + dy;
			overlay.setDragPreview(this.index, this.currentX, this.currentY, this.start.radius);
		} else if (this.mode === 'create') {
			this.currentX = ev.imageX;
			this.currentY = ev.imageY;
			const dx = ev.imageX - this.start.x;
			const dy = ev.imageY - this.start.y;
			const radius = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
			overlay.setPendingPreview({ x: this.start.x, y: this.start.y, radius });
		}
	}

	onPointerUp(ev) {
		if (!this.mode) return;
		const overlay = this.context.collisionOverlay;
		const frame = this.context.document.getSelectedFrame();
		if (!frame) { this._reset(); return; }

		const ox = frame.x + frame.centerx;
		const oy = frame.y + frame.centery;
		const circles = (frame.collision && frame.collision.circles) || [];

		if (this.mode === 'move') {
			const next = circles.map((c, i) => i === this.index ? {
				offsetX: Math.round(this.currentX - ox),
				offsetY: Math.round(this.currentY - oy),
				radius:  c.radius,
			} : { ...c });
			this._commit({ circles: next });
		} else if (this.mode === 'create') {
			const dx = this.currentX - this.start.x;
			const dy = this.currentY - this.start.y;
			const radius = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
			if (radius >= 1) {
				const next = [
					...circles.map(c => ({ ...c })),
					{
						offsetX: Math.round(this.start.x - ox),
						offsetY: Math.round(this.start.y - oy),
						radius,
					},
				];
				this._commit({ circles: next });
			}
		}

		this._reset();
	}

	onCancel() { this._reset(); }

	_removeCircle(index) {
		const frame = this.context.document.getSelectedFrame();
		if (!frame || !frame.collision) return;
		const next = frame.collision.circles
			.filter((_, i) => i !== index)
			.map(c => ({ ...c }));
		this._commit({ circles: next });
	}

	_commit(shape) {
		this.context.document.editable.setFrameCollision(
			this.context.document.selectedFrame, shape
		);
	}

	_reset() {
		this.mode = null;
		this.index = -1;
		this.start = null;
		const overlay = this.context.collisionOverlay;
		if (overlay) {
			overlay.clearDragPreview();
			overlay.clearPendingPreview();
		}
	}

	getSettings() {
		return [{
			key: 'showOverlay',
			label: 'Always show',
			type: 'checkbox',
		}];
	}

	getSettingValue(key) {
		if (key === 'showOverlay') return this.showOverlay;
		return undefined;
	}

	setSettingValue(key, value) {
		if (key === 'showOverlay') {
			this.showOverlay = !!value;
			if (typeof this.onSettingChanged === 'function') this.onSettingChanged();
		}
	}
}
