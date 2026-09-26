import { Tool } from './Tool.js';
import { rgbaToHex } from '../paint/pixelUtils.js';

// Eyedropper. Samples the pixel under the cursor and writes it into the
// palette — left button sets primary, right button sets secondary.
// Alpha is ignored; the palette stores opaque colours only.
export class ColorPickerTool extends Tool {
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
