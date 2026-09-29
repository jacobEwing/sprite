// Sprite-tab pane for the selected frame's rendering transform.
//
// A transform is a small set of named fields applied at draw time: the
// frame's pixels are translated, rotated, and scaled in the sprite's
// local space. It doesn't affect collision, and it doesn't change the
// frame's rect in the atlas — the pixels stay where they are; only the
// rendered result moves.
//
// Values default to a no-op identity. Editing any field down to its
// default drops the transform entirely, so unused transforms don't
// linger in the saved JSON.

const FIELDS = [
	{ key: 'translateX', label: 'Translate X', default: 0 },
	{ key: 'translateY', label: 'Translate Y', default: 0 },
	{ key: 'rotation',   label: 'Rotation °',  default: 0 },
	{ key: 'scaleX',     label: 'Scale X',     default: 1 },
	{ key: 'scaleY',     label: 'Scale Y',     default: 1 },
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

		const t = frame.transform || {
			translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1,
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
			input.step = f.key === 'rotation' ? '1' : '0.5';
			input.value = t[f.key];
			input.addEventListener('change', () => {
				this.doc.editable.setFrameTransform(this.currentName, {
					[f.key]: parseFloat(input.value) || f.default,
				});
			});
			cell.appendChild(input);
			grid.appendChild(cell);
			this.fields[f.key] = input;
		}
		this.root.appendChild(grid);

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
		hint.textContent = 'Rendering-only. Pivot is the frame origin.';
		this.root.appendChild(hint);
	}

	refresh() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return;
		const t = frame.transform || {
			translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1,
		};
		for (const f of FIELDS) {
			const input = this.fields[f.key];
			if (!input) continue;
			if (document.activeElement === input) continue;
			input.value = t[f.key];
		}
	}
}
