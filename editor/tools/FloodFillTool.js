import { Tool } from './Tool.js';
import { hexToRGBA } from '../paint/pixelUtils.js';
import { floodFill } from '../paint/shapes.js';

// Scanline flood fill. Fires on press and commits immediately; drag does
// nothing. Painting is clipped to the selected frame by the transaction.
export class FloodFillTool extends Tool {
	onPointerDown(ev) {
		if (!this.context.selectedFrame()) return;

		const tx = this.context.beginStroke();
		if (!tx) return;

		const x = Math.floor(ev.imageX);
		const y = Math.floor(ev.imageY);

		const target = tx.getPixel(x, y);
		if (!target) return;  // click was outside the clip rect

		const p = this.context.palette;
		const hex   = ev.button === 2 ? p.secondary      : p.primary;
		const alpha = ev.button === 2 ? p.secondaryAlpha : p.primaryAlpha;
		const replacement = hexToRGBA(hex, alpha) ?? [0, 0, 0, 255];

		// No-op if the target already equals the replacement.
		if (target[0] === replacement[0] && target[1] === replacement[1] &&
		    target[2] === replacement[2] && target[3] === replacement[3]) {
			return;
		}

		const matches = (px, py) => {
			const p = tx.getPixel(px, py);
			return p !== null &&
				p[0] === target[0] && p[1] === target[1] &&
				p[2] === target[2] && p[3] === target[3];
		};

		floodFill(tx, x, y, target, replacement, matches);
		tx.flush();

		const cmd = tx.commit();
		if (cmd) this.context.history.push(cmd);
	}
}
