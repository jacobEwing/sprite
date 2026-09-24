import { ShapeTool } from './ShapeTool.js';
import { rectOutline, rectFilled } from '../paint/shapes.js';

export class BoxTool extends ShapeTool {
	_drawPreview(ctx, hex) {
		ctx.fillStyle = hex;
		const draw = this.context.fillShapes ? rectFilled : rectOutline;
		draw(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			ctx.fillRect(x, y, 1, 1);
		});
	}

	_paint(tx, rgba) {
		const write = this.context.fillShapes ? rectFilled : rectOutline;
		write(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			tx.setPixel(x, y, rgba);
		});
	}
}
