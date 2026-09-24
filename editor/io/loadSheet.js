// Loads a sprite sheet and swaps its image for an editable canvas.
//
// The runtime accepts any CanvasImageSource for sheet.image, so from here on
// the sheet's pixels live on our canvas. Edits mutate the canvas in place,
// which means every sprite drawn from the sheet sees the change immediately —
// no reference swapping, no re-creating sprites.
export async function loadSheet(path) {
	const sheet = await window.SpriteSheet.load(path);

	const canvas = document.createElement('canvas');
	canvas.width  = sheet.imageWidth;
	canvas.height = sheet.imageHeight;

	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(sheet.image, 0, 0);

	sheet.image = canvas;
	return sheet;
}
