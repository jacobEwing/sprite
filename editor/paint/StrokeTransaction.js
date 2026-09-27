import { PaintCommand } from '../history/PaintCommand.js';

// Accumulates pixel changes for one continuous stroke (one press → one
// release). Holds two buffers: `before` is the canvas state at stroke start,
// `working` is the mutable copy tools write into. On commit, both are
// captured for the clip rect and packed into a single PaintCommand.
//
// All coordinates are in image space. Writes outside the clip rect are
// silently ignored, which is what makes per-frame editing work with an
// atlas-wide canvas.
export class StrokeTransaction {
	constructor(ctx, clipRect) {
		this.ctx = ctx;
		this.rect = { ...clipRect };  // { x, y, w, h }
		this.before  = ctx.getImageData(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
		this.working = new ImageData(
			new Uint8ClampedArray(this.before.data),
			this.before.width,
			this.before.height
		);
		this.dirty = false;
	}

	// rgba is [r, g, b, a]. Returns true if the pixel actually changed.
	setPixel(ix, iy, rgba) {
		const lx = ix - this.rect.x;
		const ly = iy - this.rect.y;
		if (lx < 0 || ly < 0 || lx >= this.rect.w || ly >= this.rect.h) return false;

		const i = (ly * this.rect.w + lx) * 4;
		const d = this.working.data;
		if (d[i] === rgba[0] && d[i+1] === rgba[1] &&
		    d[i+2] === rgba[2] && d[i+3] === rgba[3]) return false;

		d[i]   = rgba[0];
		d[i+1] = rgba[1];
		d[i+2] = rgba[2];
		d[i+3] = rgba[3];
		this.dirty = true;
		return true;
	}

	getPixel(ix, iy) {
		const lx = ix - this.rect.x;
		const ly = iy - this.rect.y;
		if (lx < 0 || ly < 0 || lx >= this.rect.w || ly >= this.rect.h) return null;
		const i = (ly * this.rect.w + lx) * 4;
		const d = this.working.data;
		return [d[i], d[i+1], d[i+2], d[i+3]];
	}

	// Push the working buffer to the canvas. Call after each batch of writes
	// so the user sees live feedback while dragging.
	flush() {
		this.ctx.putImageData(this.working, this.rect.x, this.rect.y);
	}

	// Build a PaintCommand, or return null if nothing was modified.
	commit() {
		if (!this.dirty) return null;
		this.flush();
		const after = this.ctx.getImageData(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
		return new PaintCommand(this.ctx, this.rect.x, this.rect.y, this.rect.w, this.rect.h,
			this.before, after);
	}
}
