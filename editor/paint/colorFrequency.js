// Analyse an image and return its most frequently-used opaque colours,
// most-used first. Used to seed the palette's recents list when a sheet
// or image loads.
//
// Pixels with zero alpha are ignored (they're empty space, not a colour
// choice). Grouping is by RGB only - alpha is discarded, since
// semi-transparent pixels usually carry the same hue as their opaque
// counterparts, and the palette treats alpha as a per-slot setting.

export function topColors(canvas, limit = 16) {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return [];

	const w = canvas.width  || canvas.naturalWidth  || 0;
	const h = canvas.height || canvas.naturalHeight || 0;
	if (w === 0 || h === 0) return [];

	const data = ctx.getImageData(0, 0, w, h).data;
	const counts = new Map();

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] === 0) continue;
		const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
		counts.set(key, (counts.get(key) || 0) + 1);
	}

	if (counts.size === 0) return [];

	// Sort by count descending, with the numeric colour value as a
	// deterministic tiebreak, then take the top `limit`.
	const sorted = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0] - b[0])
		.slice(0, limit);

	return sorted.map(([key]) => {
		const r = (key >> 16) & 255;
		const g = (key >> 8)  & 255;
		const b =  key        & 255;
		return { hex: rgbaToHex(r, g, b), alpha: 255 };
	});
}

// Local copy to avoid pulling the whole pixelUtils module in for one
// function. If pixelUtils is already imported here in future, replace
// this with the import.
function rgbaToHex(r, g, b) {
	const c = (v) => v.toString(16).padStart(2, '0');
	return '#' + c(r) + c(g) + c(b);
}
