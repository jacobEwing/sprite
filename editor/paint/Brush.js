// A brush is a 2D mask of numbers plus an anchor point. Values are weights
// in 0..1; nonzero means "paint this cell". The anchor specifies which mask
// cell sits under the cursor. Weights are currently unused by the pencil
// but reserved for soft brushes and anti-aliased edges later.
export class Brush {
	constructor(mask, anchorX, anchorY) {
		this.mask = mask;
		this.height = mask.length;
		this.width = mask[0].length;
		this.anchorX = anchorX ?? Math.floor(this.width / 2);
		this.anchorY = anchorY ?? Math.floor(this.height / 2);
	}

	// Call fn(x, y, weight) for each mask cell with a nonzero weight,
	// offset so the anchor lands on (cx, cy). Coordinates are image-space.
	forEachPixel(cx, cy, fn) {
		const ox = Math.floor(cx) - this.anchorX;
		const oy = Math.floor(cy) - this.anchorY;
		for (let my = 0; my < this.height; my++) {
			const row = this.mask[my];
			for (let mx = 0; mx < this.width; mx++) {
				const w = row[mx];
				if (!w) continue;
				fn(ox + mx, oy + my, w);
			}
		}
	}
}

// Built-in brush presets. Add an entry here and it appears in the picker
// with no other code changes.
export const BRUSHES = {
	pixel:   new Brush([[1]]),
	cross:   new Brush([[0, 1, 0], [1, 1, 1], [0, 1, 0]]),
	square2: new Brush([[1, 1], [1, 1]]),
	square3: new Brush([[1, 1, 1], [1, 1, 1], [1, 1, 1]]),
	circle3: new Brush([[0, 1, 0], [1, 1, 1], [0, 1, 0]]),
	circle5: new Brush([
		[0, 1, 1, 1, 0],
		[1, 1, 1, 1, 1],
		[1, 1, 1, 1, 1],
		[1, 1, 1, 1, 1],
		[0, 1, 1, 1, 0],
	]),
};
