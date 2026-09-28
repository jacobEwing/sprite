// Collision helpers used by the editor's tools and inspector. The runtime
// (sprite.js) owns the on-disk format and the load-time parsing; the
// editor works exclusively in the internal { circles: [...] } shape.
//
// A frame's collision is either present with circles, or absent. An empty
// circles array is treated the same as absent — it means the frame has no
// collision.

// Topmost circle whose disc contains (px, py), or -1. `circles` are in
// image space already (offsets applied); used by the collision tool for
// hit-testing.
export function circleAt(circles, px, py) {
	for (let i = circles.length - 1; i >= 0; i--) {
		const c = circles[i];
		const dx = px - c.x;
		const dy = py - c.y;
		if (dx * dx + dy * dy <= c.radius * c.radius) return i;
	}
	return -1;
}
