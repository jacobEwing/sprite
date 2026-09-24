// One undoable pixel edit. Holds before/after ImageData for a rectangle.
// apply() writes `after`; revert() writes `before`. Idempotent.
export class PaintCommand {
	constructor(ctx, x, y, w, h, before, after) {
		this.ctx = ctx;
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		this.before = before;
		this.after  = after;
	}
	apply()  { this.ctx.putImageData(this.after,  this.x, this.y); }
	revert() { this.ctx.putImageData(this.before, this.x, this.y); }
}
