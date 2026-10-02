import { ShapeTool } from './ShapeTool.js';
import { ellipseOutline, ellipseFilled } from '../paint/shapes.js';

export class EllipseTool extends ShapeTool {
	static displayName = 'Ellipse';
	static tips = [ 'Drag to draw an ellipse', 'Tick "Fill shape" to fill it' ];

	_drawPreview(ctx, hex) {
		ctx.fillStyle = hex;
		const draw = this.context.fillShapes ? ellipseFilled : ellipseOutline;
		draw(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			ctx.fillRect(x, y, 1, 1);
		});
	}

	_paint(tx, rgba) {
		const write = this.context.fillShapes ? ellipseFilled : ellipseOutline;
		write(this.startX, this.startY, this.endX, this.endY, (x, y) => {
			tx.setPixel(x, y, rgba);
		});
	}
}
