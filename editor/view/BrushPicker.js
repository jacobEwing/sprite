import { makeEmitter } from '../lib/emitter.js';
import { BRUSHES } from '../paint/Brush.js';

// Small grid of buttons, one per entry in BRUSHES. Each button renders a
// preview of its mask on a tiny canvas.
export class BrushPicker {
	constructor(root) {
		makeEmitter(this);
		this.root = root;
		this.buttons = new Map();
		this._build();
	}

	_build() {
		for (const [name, brush] of Object.entries(BRUSHES)) {
			const btn = document.createElement('button');
			btn.className = 'brush-btn';
			btn.dataset.brush = name;
			btn.title = name;
			btn.appendChild(this._renderPreview(brush));
			btn.addEventListener('click', () => this.select(name));
			this.root.appendChild(btn);
			this.buttons.set(name, btn);
		}
	}

	_renderPreview(brush) {
		// Fixed pixels-per-cell, so a 5×5 brush previews visibly larger
		// than a 1×1. The whole point of the picker is showing the size.
		const CELL_PX = 6;
		const cw = brush.width  * CELL_PX;
		const ch = brush.height * CELL_PX;

		const c = document.createElement('canvas');
		c.width = cw;
		c.height = ch;
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = false;

		ctx.fillStyle = '#e8e6e0';
		for (let y = 0; y < brush.height; y++) {
			for (let x = 0; x < brush.width; x++) {
				const w = brush.mask[y][x];
				if (!w) continue;
				// Honour weights so soft brushes read correctly.
				ctx.globalAlpha = w;
				ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
			}
		}
		ctx.globalAlpha = 1;
		return c;
	}

	select(name) {
		const brush = BRUSHES[name];
		if (!brush) return;
		for (const [n, btn] of this.buttons) {
			btn.classList.toggle('selected', n === name);
		}
		this.emit('change', { brush, name });
	}
}
