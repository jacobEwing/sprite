import { makeEmitter } from '../lib/emitter.js';
import { resolvedCollision } from '../model/collisionUtils.js';

// Draws the collision circles over the selected frame.
//
// Reads the resolved collision (frame override if present, sheet default
// otherwise) so inherited shapes are visible read-only. The tool can
// override the drawn position of one circle during a drag, or supply a
// pending shape that hasn't been committed yet.
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

	// Circles in image coordinates for the current frame. Reads the
	// resolved shape, so an inherited frame shows the sheet's circles.
	currentCircles() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return [];

		const shape = resolvedCollision(frame, this.doc.sheet.collision);
		if (!shape || !shape.circles) return [];

		const ox = frame.x + frame.centerx;
		const oy = frame.y + frame.centery;
		return shape.circles.map((c, i) => ({
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
		const sheetCollision = sheet.collision;
		const selected = this.doc.selectedFrame;

		// Draw every frame's resolved shape. The selected frame's circles
		// are the ones the tool can edit, so they render at full strength;
		// the rest are dimmed to keep the selected frame legible.
		for (const name of sheet.frameNames) {
			const frame = sheet.frames[name];
			const shape = resolvedCollision(frame, sheetCollision);
			if (!shape || !shape.circles || shape.circles.length === 0) continue;

			const isSelected = name === selected;
			const ox = frame.x + frame.centerx;
			const oy = frame.y + frame.centery;

			shape.circles.forEach((c, i) => {
				let x = ox + c.offsetX;
				let y = oy + c.offsetY;
				let r = c.radius;

				const dragging =
					isSelected &&
					this.dragOverride &&
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
