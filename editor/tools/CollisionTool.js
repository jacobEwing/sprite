import { Tool } from './Tool.js';
import { circleAt } from '../model/collisionUtils.js';

// Drag existing circles; drag on empty space to create a new one; right-
// click a circle to delete it.
//
// The overlay draws the working state. This tool only interprets gestures
// and pushes commands when a gesture ends.
export class CollisionTool extends Tool {
	constructor(context) {
		super(context);
		this.mode = null;      // 'move' | 'create' | null
		this.index = -1;
		this.start = null;
		this.currentX = 0;
		this.currentY = 0;
	}

	onPointerDown(ev) {
		const overlay = this.context.collisionOverlay;
		if (!overlay) return;

		const circles = overlay.currentCircles();
		const x = ev.imageX;
		const y = ev.imageY;
		const hit = circleAt(circles, x, y);

		if (hit === -1) {
			if (ev.button === 2) return;   // right-click on empty = no-op
			// Start a new circle at the click point, radius 0.
			this.mode = 'create';
			this.start = { x, y };
			this.currentX = x;
			this.currentY = y;
			overlay.setPendingPreview({ x, y, radius: 0 });
			return;
		}

		if (ev.button === 2) {
			// Right-click on a circle deletes it.
			this.context.document.editable.removeCollisionCircle(hit);
			return;
		}

		// Left-click on a circle: begin dragging.
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
			overlay.setPendingPreview({
				x: this.start.x, y: this.start.y, radius,
			});
		}
	}

	onPointerUp(ev) {
		if (!this.mode) return;
		const overlay = this.context.collisionOverlay;
		const ed = this.context.document.editable;
		const frame = this.context.selectedFrame();

		if (!frame) { this._reset(); return; }

		// Convert the working image-space coordinates back to frame offsets
		// by subtracting the frame origin.
		const ox = frame.rect.x + (this.context.document.getSelectedFrame().centerx);
		const oy = frame.rect.y + (this.context.document.getSelectedFrame().centery);

		if (this.mode === 'move') {
			ed.updateCollisionCircle(this.index, {
				offsetX: Math.round(this.currentX - ox),
				offsetY: Math.round(this.currentY - oy),
			});
		} else if (this.mode === 'create') {
			const dx = this.currentX - this.start.x;
			const dy = this.currentY - this.start.y;
			const radius = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
			if (radius >= 1) {
				ed.addCollisionCircle({
					offsetX: Math.round(this.start.x - ox),
					offsetY: Math.round(this.start.y - oy),
					radius,
				});
			}
		}

		this._reset();
	}

	onCancel() {
		this._reset();
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
}
