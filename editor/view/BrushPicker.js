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
		const size = 36;
		const c = document.createElement('canvas');
		c.width = size;
		c.height = size;
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = false;

		const span = Math.max(brush.width, brush.height);
		const cell = Math.max(2, Math.floor((size - 4) / span));
		const ox = Math.floor((size - brush.width  * cell) / 2);
		const oy = Math.floor((size - brush.height * cell) / 2);

		ctx.fillStyle = '#e8e6e0';
		for (let y = 0; y < brush.height; y++) {
			for (let x = 0; x < brush.width; x++) {
				if (!brush.mask[y][x]) continue;
				ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
			}
		}
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
