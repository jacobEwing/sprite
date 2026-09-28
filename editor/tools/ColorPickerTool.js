import { Tool } from './Tool.js';
import { rgbaToHex } from '../paint/pixelUtils.js';

// Eyedropper. Samples the pixel under the cursor and writes it into the
// palette - left button sets primary, right button sets secondary. Alpha
// is part of the colour, so a sampled semi-transparent pixel lands in the
// palette with its alpha intact.
export class ColorPickerTool extends Tool {
	constructor(context) {
		super(context);
		// Sampling reads from anywhere in the atlas, so a cell change is
		// fine to happen in the same gesture.
		this.cellScoped = false;
	}

	onPointerDown(ev) {
		const sheet = this.context.document.sheet;
		if (!sheet) return;

		const x = Math.floor(ev.imageX);
		const y = Math.floor(ev.imageY);
		if (x < 0 || y < 0 || x >= sheet.imageWidth || y >= sheet.imageHeight) return;

		const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
		const data = ctx.getImageData(x, y, 1, 1).data;
		const hex = rgbaToHex(data[0], data[1], data[2]);
		const alpha = data[3];

		if (ev.button === 2) this.context.palette.setSecondary(hex, alpha);
		else                 this.context.palette.setPrimary(hex, alpha);
	}
}
