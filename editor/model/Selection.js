// A selection is a rectangle in image (atlas) coordinates. Future selection
// modes (polygon, by-colour) will still produce a rect-shaped bounding box,
// with a mask for the actual shape; the type field reserves that possibility
// without committing to it yet.
//
// The selection is editor state, not sheet data: not undoable, not saved,
// cleared when the frame or sheet changes.

export class Selection {
	constructor() {
		this.type = 'rect';
		this.rect = null;   // { x, y, w, h } in image coords, or null
	}

	get isEmpty() { return this.rect === null; }
	get width()   { return this.rect ? this.rect.w : 0; }
	get height()  { return this.rect ? this.rect.h : 0; }

	// From a drag: two image-space points, in any order.
	setFromDrag(x1, y1, x2, y2) {
		const ix1 = Math.floor(Math.min(x1, x2));
		const iy1 = Math.floor(Math.min(y1, y2));
		const ix2 = Math.ceil(Math.max(x1, x2));
		const iy2 = Math.ceil(Math.max(y1, y2));
		const w = ix2 - ix1;
		const h = iy2 - iy1;
		if (w <= 0 || h <= 0) {
			this.rect = null;
			return false;
		}
		this.rect = { x: ix1, y: iy1, w, h };
		return true;
	}

	// From an explicit rect (e.g. "select all" = frame bounds).
	set(rect) {
		if (!rect || rect.w <= 0 || rect.h <= 0) {
			this.rect = null;
			return false;
		}
		this.rect = {
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			w: Math.max(1, Math.round(rect.w)),
			h: Math.max(1, Math.round(rect.h)),
		};
		return true;
	}

	clear() {
		this.rect = null;
	}
}
