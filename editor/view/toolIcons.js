// Loads a sprite sheet of UI icons and applies them to the editor's
// buttons. The tool grid, transform panel, and timeline tiles all
// declare a frame name via a data-* attribute; this module replaces
// their text content with a small canvas rendering of that frame.
//
// Called once at startup. If the sheet fails to load, or a frame is
// missing, the button keeps its text label — no error, no broken UI.
//
// Timeline tiles are rebuilt on every render, so they call applyIcon()
// directly after creating each button. The startup pass also covers
// any tiles already in the DOM.

const ICON_SCALE_MAX = 4;

let iconSheet = null;

// Groups of buttons that carry a static frame name. The startup pass
// walks each of these after the sheet loads.
const STATIC_GROUPS = [
	{ selector: '.tool-btn',    key: 'tool'   },
	{ selector: '.tsp-btn',     key: 'action' },
	{ selector: '.tl-tile-btn', key: 'icon'   },
];

export async function applyToolIcons(path) {
	try {
		iconSheet = await window.SpriteSheet.load(path);
	} catch (err) {
		console.warn(`Tool icons unavailable (${path}): ${err.message}`);
		return null;
	}
	applyAll();
	return iconSheet;
}

// Apply every icon in every static group. Called once after load, and
// available for any future re-run pass.
export function applyAll() {
	if (!iconSheet) return;
	for (const group of STATIC_GROUPS) {
		for (const btn of document.querySelectorAll(group.selector)) {
			const name = btn.dataset[group.key];
			if (name) applyIcon(btn, name);
		}
	}
}

// Apply one icon to one button by frame name. Returns true on success.
// Safe to call before the sheet has loaded — returns false and leaves
// the button untouched, so the caller's fallback text remains.
export function applyIcon(btn, frameName) {
	if (!iconSheet) return false;
	const frame = iconSheet.frames[frameName];
	if (!frame) return false;

	const maxCss = targetSizeFor(btn);
	const canvas = makeIconCanvas(iconSheet, frame, maxCss);
	btn.replaceChildren(canvas);
	return true;
}

// Interior size budget for a button. Chosen per class rather than
// measured, because rendered layout is unreliable when a button isn't
// in the DOM yet — which is the case for freshly-created timeline tiles.
function targetSizeFor(btn) {
	if (btn.classList.contains('tl-tile-btn')) return 16;
	if (btn.classList.contains('tsp-btn'))     return 28;
	return 44;  // .tool-btn, the default
}

function makeIconCanvas(sheet, frame, maxCssPx) {
	// Largest integer scale that fits, capped so a tiny source frame
	// doesn't blow up to fill an oversized button.
	const longest = Math.max(frame.width, frame.height);
	let scale = Math.floor(maxCssPx / longest);
	if (scale < 1) scale = 1;
	if (scale > ICON_SCALE_MAX) scale = ICON_SCALE_MAX;

	const dpr = window.devicePixelRatio || 1;
	const cssW = frame.width * scale;
	const cssH = frame.height * scale;

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
