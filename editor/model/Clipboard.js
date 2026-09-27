// Editor-wide clipboard for frame content. Not persisted; wipes on reload.
//
// `imageData` holds the copied pixels; `sourceFrame` is a display label the
// caller provides for the status bar (typically the frame name, or a
// descriptive string for a selection copy). The rect passed to captureFrom
// is in image coordinates, matching currentOpRect().

export class Clipboard {
	constructor() {
		this.imageData = null;
		this.sourceFrame = null;
	}

	get isEmpty() { return this.imageData === null; }

	captureFrom(sheet, rect, sourceLabel) {
		if (!sheet || !rect || rect.w <= 0 || rect.h <= 0) return false;
		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		this.imageData = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
		this.sourceFrame = sourceLabel;
		return true;
	}
}
