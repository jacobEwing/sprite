import { Tool } from './Tool.js';
import { circleAt } from '../model/collisionUtils.js';

// Drag existing circles; drag on empty space to create a new one; right-
// click a circle to delete it.
//
// Any gesture on an Inherit frame first promotes it to Override, seeding
// from the sheet's shape, so edits are non-destructive to the sheet-level
// default.
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
		const frame = this.context.document.getSelectedFrame();
		if (!frame) return;

		// Promote to Override so the gesture lands on the frame, not the
		// sheet. Any subsequent write goes through setFrameCollision.
		if (!Object.prototype.hasOwnProperty.call(frame, 'collision')
		    || frame.collision.circles.length === 0) {
			this._promoteToOverride(frame);
		}

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

	_promoteToOverride(frame) {
		const inherited = this.context.document.sheet.collision;
		const seed = inherited && inherited.circles && inherited.circles.length
			? { circles: inherited.circles.map(c => ({ ...c })) }
			: { circles: [] };
		this.context.document.editable.setFrameCollision(
			this.context.document.selectedFrame, seed
		);
	}

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
}
