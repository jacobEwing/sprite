import { ShapeTool } from './ShapeTool.js';
import { linePoints } from '../paint/pixelUtils.js';

export class LineTool extends ShapeTool {
	_drawPreview(ctx, hex) {
		ctx.fillStyle = hex;
		linePoints(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			ctx.fillRect(x, y, 1, 1);
		});
	}

	_paint(tx, rgba) {
		linePoints(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			tx.setPixel(x, y, rgba);
		});
	}
}
