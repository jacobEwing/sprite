// Editor-wide clipboard for frame content. Not persisted; wipes on reload.
//
// Holds an ImageData plus the name of the source frame, purely so the UI
// can show "clipboard: front_idle (24×24)" if we ever want that.

export class Clipboard {
	constructor() {
		this.imageData = null;
		this.sourceFrame = null;
	}

	get isEmpty()  { return this.imageData === null; }
	get width()    { return this.imageData ? this.imageData.width  : 0; }
	get height()   { return this.imageData ? this.imageData.height : 0; }

	captureFrom(sheet, rect, sourceLabel) {
		if (!sheet || !rect || rect.w <= 0 || rect.h <= 0) return false;
		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		this.imageData = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		this.sourceFrame = sourceLabel;
		return true;
	}

	clear() {
		this.imageData = null;
		this.sourceFrame = null;
	}
}
