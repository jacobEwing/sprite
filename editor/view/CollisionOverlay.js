import { makeEmitter } from '../lib/emitter.js';

// Draws the collision circles over the selected frame.
//
// Reads the resolved collision so inherited shapes are visible read-only. The
// tool can override the drawn position of one circle during a drag, or supply
// a pending shape that hasn't been committed yet.
export class CollisionOverlay {
	constructor(doc, viewport) {
		makeEmitter(this);
		this.doc = doc;
		this.viewport = viewport;

		this.enabled = false;
		this.dragOverride = null;
		this.pendingShape = null;

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

	// Circles in image coordinates for the selected frame. Empty when the
	// frame has no collision.
	currentCircles() {
		const frame = this.doc.getSelectedFrame();
		if (!frame || !frame.collision || !frame.collision.circles) return [];

		const ox = frame.x + frame.centerx;
		const oy = frame.y + frame.centery;
		return frame.collision.circles.map((c, i) => ({
			index: i,
			x: ox + c.offsetX,
			y: oy + c.offsetY,
			radius: c.radius,
		}));
	}

	_draw(ctx) {
		if (!this.enabled) return;

		const sheet = this.doc.sheet;
		if (!sheet || !sheet.frames) return;

		const hairline = 1 / this.viewport.zoom;
		const selected = this.doc.selectedFrame;

		// Every frame owns its own shape now, so we read each frame's
		// collision directly.
		for (const name of sheet.frameNames) {
			const frame = sheet.frames[name];
			if (!frame.collision || !frame.collision.circles) continue;
			if (frame.collision.circles.length === 0) continue;

			const isSelected = name === selected;
			const ox = frame.x + frame.centerx;
			const oy = frame.y + frame.centery;

			frame.collision.circles.forEach((c, i) => {
				let x = ox + c.offsetX;
				let y = oy + c.offsetY;
				let r = c.radius;

				const dragging = isSelected && this.dragOverride &&
				                 this.dragOverride.index === i;

				if (dragging) {
					x = this.dragOverride.x;
					y = this.dragOverride.y;
					r = this.dragOverride.radius;
				}

				this._strokeCircle(ctx, x, y, r, hairline, dragging, false, !isSelected);
			});
		}

		// The pending shape only ever belongs to the selected frame.
		if (this.pendingShape) {
			const p = this.pendingShape;
			this._strokeCircle(ctx, p.x, p.y, p.radius, hairline, false, false, false);
			this._strokeCircle(ctx, p.x, p.y, 0.5, hairline, true, true, false);
		}
	}

	_strokeCircle(ctx, x, y, r, hairline, highlighted, isCenter, dim) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, Math.max(r, 0.01), 0, Math.PI * 2);

		ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
		ctx.lineWidth = hairline * 3;
		ctx.stroke();

		let stroke;
		if (highlighted)   stroke = '#50d0ff';
		else if (dim)      stroke = 'rgba(208, 128, 64, 0.5)';
		else               stroke = '#d08040';

		ctx.strokeStyle = stroke;
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
