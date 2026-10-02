// Sprite-tab pane for the selected frame's rendering transform.
//
// A transform is a small set of named fields applied at draw time: the
// frame's pixels are translated, rotated, and scaled in the sprite's
// local space. It doesn't affect collision, and it doesn't change the
// frame's rect in the atlas.
//
// The pivot for rotation and scale is expressed in frame-local
// coordinates — (0, 0) is the frame rect's top-left corner. It defaults
// to the frame's origin (centerx, centery), which is what transforms
// used before pivots existed.
import { escapeBlurs } from '../lib/fieldEscape.js';

const FIELDS = [
	{ key: 'translateX', label: 'Translate X', default: 0,   step: 0.5 },
	{ key: 'translateY', label: 'Translate Y', default: 0,   step: 0.5 },
	{ key: 'rotation',   label: 'Rotation °',  default: 0,   step: 1 },
	{ key: 'scaleX',     label: 'Scale X',     default: 1,   step: 0.1 },
	{ key: 'scaleY',     label: 'Scale Y',     default: 1,   step: 0.1 },
	{ key: 'pivotX',     label: 'Pivot X',     default: null, step: 0.5 },
	{ key: 'pivotY',     label: 'Pivot Y',     default: null, step: 0.5 },
];

export class FrameTransformInspector {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.currentName = null;

		doc.on('selectionChanged', () => this.rebuild());
		doc.on('sheetChanged',     () => this.rebuild());
		doc.on('edit',             () => this._onEdit());

		this.rebuild();
	}

	_onEdit() {
		if (this.doc.selectedFrame !== this.currentName) this.rebuild();
		else this.refresh();
	}

	rebuild() {
		this.root.innerHTML = '';
		this.fields = {};
		const frame = this.doc.getSelectedFrame();
		this.currentName = this.doc.selectedFrame;

		if (!frame) {
			this.root.innerHTML = '<div class="info">No frame selected.</div>';
			return;
		}

		const defX = frame.centerx;
		const defY = frame.centery;

		const t = frame.transform || {
			translateX: 0, translateY: 0, rotation: 0,
			scaleX: 1, scaleY: 1,
			pivotX: defX, pivotY: defY,
		};

		const grid = document.createElement('div');
		grid.className = 'insp-grid';
		for (const f of FIELDS) {
			const cell = document.createElement('label');
			cell.className = 'insp-cell';
			cell.innerHTML = `<span class="insp-label">${f.label}</span>`;
			const input = document.createElement('input');
			input.type = 'number';
			input.className = 'insp-input';
			input.step = String(f.step);
			input.value = t[f.key] !== undefined
				? t[f.key]
				: this._defaultFor(f, defX, defY);
			input.addEventListener('change', () => {
				const v = parseFloat(input.value);
				const fallback = this._defaultFor(f, defX, defY);
				this.doc.editable.setFrameTransform(this.currentName, {
					[f.key]: Number.isFinite(v) ? v : fallback,
				});
			});
			escapeBlurs(input);
			cell.appendChild(input);
			grid.appendChild(cell);
			this.fields[f.key] = input;
		}
		this.root.appendChild(grid);

		const presetRow = document.createElement('div');
		presetRow.className = 'insp-preset-row';
		for (const [key, label] of [['origin', 'Pivot: origin'], ['centre', 'Pivot: centre']]) {
			const b = document.createElement('button');
			b.className = 'insp-mini-wide';
			b.textContent = label;
			b.addEventListener('click', () => this._applyPivotPreset(key));
			presetRow.appendChild(b);
		}
		this.root.appendChild(presetRow);

		const resetBtn = document.createElement('button');
		resetBtn.className = 'insp-add-btn';
		resetBtn.textContent = 'Reset transform';
		resetBtn.disabled = !frame.transform;
		resetBtn.addEventListener('click', () => {
			this.doc.editable.setFrameTransform(this.currentName, null);
		});
		this.root.appendChild(resetBtn);

		const hint = document.createElement('div');
		hint.className = 'collision-hint';
		hint.textContent = 'Rendering-only. Pivot defaults to the frame origin.';
		this.root.appendChild(hint);
	}

	_applyPivotPreset(which) {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return;

		let px, py;
		if (which === 'origin') {
			px = frame.centerx;
			py = frame.centery;
		} else if (which === 'centre') {
			px = frame.width  / 2;
			py = frame.height / 2;
		} else return;

		this.doc.editable.setFrameTransform(this.currentName, {
			pivotX: px, pivotY: py,
		});
	}

	refresh() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return;
		const defX = frame.centerx;
		const defY = frame.centery;
		const t = frame.transform || {
			translateX: 0, translateY: 0, rotation: 0,
			scaleX: 1, scaleY: 1,
			pivotX: defX, pivotY: defY,
		};
		for (const f of FIELDS) {
			const input = this.fields[f.key];
			if (!input) continue;
			if (document.activeElement === input) continue;
			input.value = t[f.key] !== undefined
				? t[f.key]
				: this._defaultFor(f, defX, defY);
		}
		if (this.resetBtn) this.resetBtn.disabled = !frame.transform;
	}

	// The pivot fields' effective default is the frame's origin. The
	// other fields have literal defaults defined in FIELDS.
	_defaultFor(f, defX, defY) {
		if (f.key === 'pivotX') return defX;
		if (f.key === 'pivotY') return defY;
		return f.default;
	}
}
