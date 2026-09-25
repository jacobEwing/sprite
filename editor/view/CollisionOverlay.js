import { makeEmitter } from '../lib/emitter.js';

// Draws the collision circles over the selected frame. Subscribes to the
// document so it re-renders on selection, sheet, and collision changes.
//
// The tool can call setDragPreview(index, x, y, radius) to override the
// drawn position of one circle during a drag, and setPendingPreview(shape)
// to draw a shape that hasn't been committed yet.
export class CollisionOverlay {
	constructor(doc, viewport) {
		makeEmitter(this);
		this.doc = doc;
		this.viewport = viewport;

		this.enabled = false;
		this.dragOverride = null;   // { index, x, y, radius } in image coords
		this.pendingShape = null;   // { x, y, radius } in image coords

		this._token = viewport.addOverlay((ctx) => this._draw(ctx));

		doc.on('sheetChanged',     () => this.viewport.invalidate());
		doc.on('selectionChanged', () => this.viewport.invalidate());
		doc.on('edit',             () => this.viewport.invalidate());
	}

	setEnabled(on) {
		this.enabled = !!on;
		this.viewport.invalidate();
	}

	setDragPreview(index, x, y, radius) {
		this.dragOverride = { index, x, y, radius };
		this.viewport.invalidate();
	}

	clearDragPreview() {
		this.dragOverride = null;
		this.viewport.invalidate();
	}

	setPendingPreview(shape) {
		this.pendingShape = shape;
		this.viewport.invalidate();
	}

	clearPendingPreview() {
		this.pendingShape = null;
		this.viewport.invalidate();
	}

	// Circles in image coordinates for the current frame, or [].
	currentCircles() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return [];
		const collision = this.doc.sheet && this.doc.sheet.collision;
		if (!collision || !collision.circles) return [];

		const ox = frame.x + frame.centerx;
		const oy = frame.y + frame.centery;
		return collision.circles.map((c, i) => ({
			index: i,
			x: ox + c.offsetX,
			y: oy + c.offsetY,
			radius: c.radius,
		}));
	}

	_draw(ctx) {
		if (!this.enabled) return;
		const circles = this.currentCircles();
		if (circles.length === 0 && !this.pendingShape) return;

		const hairline = 1 / this.viewport.zoom;

		for (const c of circles) {
			const dragging = this.dragOverride && this.dragOverride.index === c.index;
			const x = dragging ? this.dragOverride.x : c.x;
			const y = dragging ? this.dragOverride.y : c.y;
			const r = dragging ? this.dragOverride.radius : c.radius;
			this._strokeCircle(ctx, x, y, r, hairline, dragging);
		}

		if (this.pendingShape) {
			const p = this.pendingShape;
			this._strokeCircle(ctx, p.x, p.y, p.radius, hairline, false);
			this._strokeCircle(ctx, p.x, p.y, 0.5, hairline, true, true);
		}
	}

	_strokeCircle(ctx, x, y, r, hairline, highlighted, isCenter) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, Math.max(r, 0.01), 0, Math.PI * 2);

		ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
		ctx.lineWidth = hairline * 3;
		ctx.stroke();

		ctx.strokeStyle = highlighted ? '#50d0ff' : '#d08040';
		ctx.lineWidth = hairline * 1.5;
		ctx.stroke();

		if (isCenter) {
			ctx.fillStyle = highlighted ? '#50d0ff' : '#d08040';
			ctx.beginPath();
			ctx.arc(x, y, Math.max(1.5, r * 0.15), 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}
}
