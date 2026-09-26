// Replaces the text labels on tool buttons with sprites drawn from
// assets/toolIcons.json. Falls back silently to text if the sheet can't
// be loaded or a frame is missing.

// data-tool → frame name. The two mismatches are intentional; keeping the
// map here means the frame names in the sheet can change without touching
// either main.js or index.html.
const FRAME_ALIASES = {
	ellipse: 'oval',
	picker:  'pick',
	// pan, pencil, eraser, line, box, fill match by name.
	// 'frame' has no icon and keeps its text label.
};

const ICON_SCALE = 3;

export async function applyToolIcons(path) {
	let sheet;
	try {
		sheet = await window.SpriteSheet.load(path);
	} catch (err) {
		console.warn(`Tool icons unavailable (${path}): ${err.message}`);
		return null;
	}

	const buttons = document.querySelectorAll('.tool-btn');
	for (const btn of buttons) {
		const toolName  = btn.dataset.tool;
		const frameName = FRAME_ALIASES[toolName] || toolName;
		const frame     = sheet.frames[frameName];
		if (!frame) continue;   // keep the text label

		const canvas = _makeIconCanvas(sheet, frame);
		btn.replaceChildren(canvas);
	}
	return sheet;
}

function _makeIconCanvas(sheet, frame) {
	const dpr = window.devicePixelRatio || 1;
	const cssW = frame.width  * ICON_SCALE;
	const cssH = frame.height * ICON_SCALE;

	const canvas = document.createElement('canvas');
	canvas.width  = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	canvas.style.width  = cssW + 'px';
	canvas.style.height = cssH + 'px';
	canvas.className = 'tool-icon';

	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(
		sheet.image,
		frame.x, frame.y, frame.width, frame.height,
		0, 0, canvas.width, canvas.height
	);
	return canvas;
}
