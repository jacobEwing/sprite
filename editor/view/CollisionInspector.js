import {
	collisionMode,
	emptyCollision,
	resolvedCollision,
} from '../model/collisionUtils.js';

// Edit-tab pane for the selected frame's collision shape.
//
// Three modes, chosen via the segmented control:
//   Inherit  — frame uses the sheet's default shape (read-only list)
//   Override — frame has its own circles (editable)
//   None     — frame has no collision
//
// Switching to Override for the first time seeds the frame's circles from
// whatever was inherited, so you're editing a copy rather than starting
// from scratch.

const FIELDS = ['offsetX', 'offsetY', 'radius'];

export class CollisionInspector {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.showOverlay = false;
		this.onOverlayToggle = null;

		doc.on('sheetChanged',     () => this.rebuild());
		doc.on('selectionChanged', () => this.rebuild());
		doc.on('edit',             () => this.rebuild());

		this.rebuild();
	}

	rebuild() {
		this.root.innerHTML = '';
		if (!this.doc.sheet) return;

		const frame = this.doc.getSelectedFrame();
		if (!frame) {
			const empty = document.createElement('div');
			empty.className = 'info';
			empty.textContent = 'No frame selected.';
			this.root.appendChild(empty);
			return;
		}

		const mode = collisionMode(frame);
		const sheetHasShape = !!(this.doc.sheet.collision && this.doc.sheet.collision.circles);

		// Overlay toggle
		const toggleRow = document.createElement('label');
		toggleRow.className = 'insp-checkbox';
		const toggleInput = document.createElement('input');
		toggleInput.type = 'checkbox';
		toggleInput.checked = this.showOverlay;
		toggleInput.addEventListener('change', () => {
			this.showOverlay = toggleInput.checked;
			if (this.onOverlayToggle) this.onOverlayToggle(this.showOverlay);
		});
		const toggleLabel = document.createElement('span');
		toggleLabel.textContent = 'Always show overlay';
		toggleRow.append(toggleInput, toggleLabel);
		this.root.appendChild(toggleRow);

		// Mode selector
		const modes = document.createElement('div');
		modes.className = 'collision-modes';
		for (const [value, label] of [
			['inherit',  'Inherit'],
			['override', 'Override'],
			['none',     'None'],
		]) {
			const btn = document.createElement('button');
			btn.className = 'collision-mode';
			btn.textContent = label;
			if (value === mode) btn.classList.add('selected');
			btn.addEventListener('click', () => this._setMode(value, frame));
			modes.appendChild(btn);
		}
		this.root.appendChild(modes);

		// Shape list, or a placeholder when None.
		const resolved = resolvedCollision(frame, this.doc.sheet.collision);
		const editable = mode === 'override';

		if (mode === 'inherit' && !sheetHasShape) {
			const empty = document.createElement('div');
			empty.className = 'info';
			empty.textContent = 'Sheet has no default collision. ' +
				'Choose Override to add circles for this frame.';
			this.root.appendChild(empty);
			return;
		}

		if (mode === 'none') {
			const empty = document.createElement('div');
			empty.className = 'info';
			empty.textContent = 'This frame has no collision.';
			this.root.appendChild(empty);
			return;
		}

		if (!resolved || resolved.circles.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'info';
			empty.textContent = editable
				? 'No circles yet. Add one below.'
				: 'No circles.';
			this.root.appendChild(empty);
		} else {
			for (let i = 0; i < resolved.circles.length; i++) {
				this.root.appendChild(this._circleRow(i, resolved.circles[i], editable));
			}
		}

		if (editable) {
			const addBtn = document.createElement('button');
			addBtn.className = 'insp-add-btn';
			addBtn.textContent = '+ Add circle at origin';
			addBtn.addEventListener('click', () => this._addCircle(frame));
			this.root.appendChild(addBtn);
		}

		if (mode === 'inherit' && sheetHasShape) {
			const hint = document.createElement('div');
			hint.className = 'collision-hint';
			hint.textContent = 'Read-only. Switch to Override to edit.';
			this.root.appendChild(hint);
		}
	}

	_setMode(mode, frame) {
		const ed = this.doc.editable;
		const name = this.doc.selectedFrame;

		if (mode === 'inherit') {
			ed.setFrameCollision(name, undefined);
			return;
		}
		if (mode === 'none') {
			ed.setFrameCollision(name, null);
			return;
		}
		// override: seed from inherited shape if we're not already in override.
		const current = collisionMode(frame);
		if (current === 'override') return;
		const seed = resolvedCollision(frame, this.doc.sheet.collision);
		const shape = seed && seed.circles && seed.circles.length
			? { circles: seed.circles.map(c => ({ ...c })) }
			: { circles: [{ offsetX: 0, offsetY: 0, radius: this._defaultRadius() }] };
		ed.setFrameCollision(name, shape);
	}

	_addCircle(frame) {
		const ed = this.doc.editable;
		const name = this.doc.selectedFrame;
		const mode = collisionMode(frame);

		// Promote to override first if needed, then append.
		if (mode !== 'override') {
			this._setMode('override', frame);
		}

		const after = this.doc.sheet.frames[name];
		if (!after || !after.collision) return;
		const next = {
			circles: [
				...after.collision.circles.map(c => ({ ...c })),
				{ offsetX: 0, offsetY: 0, radius: this._defaultRadius() },
			],
		};
		ed.setFrameCollision(name, next);
	}

	_circleRow(index, circle, editable) {
		const wrap = document.createElement('div');
		wrap.className = 'collision-row';

		const header = document.createElement('div');
		header.className = 'collision-row-header';

		const label = document.createElement('span');
		label.className = 'collision-row-label';
		label.textContent = `Circle ${index}`;
		header.appendChild(label);

		if (editable) {
			const del = document.createElement('button');
			del.className = 'insp-mini';
			del.textContent = '×';
			del.title = 'Remove this circle';
			del.addEventListener('click', () => this._removeCircle(index));
			header.appendChild(del);
		}

		wrap.appendChild(header);

		const grid = document.createElement('div');
		grid.className = 'collision-row-grid';
		for (const key of FIELDS) {
			const cell = document.createElement('label');
			cell.className = 'insp-cell';
			cell.innerHTML = `<span class="insp-label">${key}</span>`;
			const input = document.createElement('input');
			input.type = 'number';
			input.className = 'insp-input';
			input.value = circle[key];
			if (key === 'radius') input.min = '1';
			input.disabled = !editable;
			if (editable) {
				input.addEventListener('change', () => this._updateCircle(index, key, input.value));
			}
			cell.appendChild(input);
			grid.appendChild(cell);
		}
		wrap.appendChild(grid);

		return wrap;
	}

	_removeCircle(index) {
		const frame = this.doc.getSelectedFrame();
		if (!frame || !frame.collision) return;
		const next = frame.collision.circles
			.filter((_, i) => i !== index)
			.map(c => ({ ...c }));
		this.doc.editable.setFrameCollision(this.doc.selectedFrame, { circles: next });
	}

	_updateCircle(index, key, value) {
		const frame = this.doc.getSelectedFrame();
		if (!frame || !frame.collision) return;
		const next = frame.collision.circles.map((c, i) => {
			if (i !== index) return { ...c };
			const updated = { ...c };
			updated[key] = key === 'radius'
				? Math.max(1, Number(value) || 1)
				: Number(value) || 0;
			return updated;
		});
		this.doc.editable.setFrameCollision(this.doc.selectedFrame, { circles: next });
	}

	_defaultRadius() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return 4;
		return Math.max(2, Math.floor(Math.min(frame.width, frame.height) / 4));
	}
}
