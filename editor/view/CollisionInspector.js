import { circleAt } from '../model/collisionUtils.js';
import { escapeBlurs } from '../lib/fieldEscape.js';

// Edit-tab pane for the selected frame's collision shape.
//
// Every frame owns its own collision. A frame either has one or doesn't;
// there is no sheet-level fallback to inherit from. The shape is a list of
// circles, each with an offset from the frame's origin and a radius.
//
// The "Copy to all frames" button writes the current frame's shape onto
// every other frame in the sheet, so a shape defined once can be applied
// consistently across an animation.
//
// Rebuild vs refresh: the DOM is torn down and recreated when the selected
// frame changes. When the frame is the same and only the underlying data
// changed — a field committed, a sibling edit came in via undo — values
// are refreshed in place instead, so tab focus survives the edit.

const FIELDS = ['offsetX', 'offsetY', 'radius'];

export class CollisionInspector {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.currentName = null;
		this.fields = {};
		this._renderedCircleCount = -1;

		doc.on('sheetChanged',     () => this.rebuild());
		doc.on('selectionChanged', () => this.rebuild());
		doc.on('edit',             () => this._onEdit());

		this.rebuild();
	}

	_onEdit() {
		if (this.doc.selectedFrame !== this.currentName) {
			this.rebuild();
		} else {
			this.refresh();
		}
	}

	rebuild() {
		this.root.innerHTML = '';
		this.fields = {};

		if (!this.doc.sheet) {
			this.currentName = null;
			this._renderedCircleCount = -1;
			return;
		}

		const frame = this.doc.getSelectedFrame();
		this.currentName = this.doc.selectedFrame;

		if (!frame) {
			this._info('No frame selected.');
			this._renderedCircleCount = -1;
			return;
		}

		const circles = frame.collision && frame.collision.circles
			? frame.collision.circles
			: [];
		this._renderedCircleCount = circles.length;

		if (circles.length === 0) {
			this._info('No collision for this frame. Add a circle to begin.');
		} else {
			for (let i = 0; i < circles.length; i++) {
				this.root.appendChild(this._circleRow(i, circles[i]));
			}
		}

		const addBtn = document.createElement('button');
		addBtn.className = 'insp-add-btn';
		addBtn.textContent = '+ Add circle at origin';
		addBtn.addEventListener('click', () => this._addCircle());
		this.root.appendChild(addBtn);

		const copyBtn = document.createElement('button');
		copyBtn.className = 'insp-add-btn';
		copyBtn.textContent = 'Copy to all frames';
		copyBtn.title = circles.length > 0
			? 'Overwrite every other frame\'s collision with this one'
			: 'This frame has no collision to copy';
		copyBtn.disabled = this.doc.sheet.frameNames.length <= 1
			|| circles.length === 0;
		copyBtn.addEventListener('click', () => this._copyToAll());
		this.root.appendChild(copyBtn);
	}

	// Update input values in place, without touching the DOM structure.
	// Skips whichever field has focus, so an in-progress edit isn't
	// clobbered by a refresh triggered from elsewhere.
	refresh() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return;
		const circles = frame.collision && frame.collision.circles
			? frame.collision.circles
			: [];

		// The DOM structure mirrors the circle count. If the underlying
		// data now has a different number of circles, the existing rows
		// no longer correspond to it - rebuild instead of refreshing.
		if (circles.length !== this._renderedCircleCount) {
			this.rebuild();
			return;
		}

		for (let i = 0; i < circles.length; i++) {
			for (const key of FIELDS) {
				const input = this.fields[`${i}.${key}`];
				if (!input) continue;
				if (document.activeElement === input) continue;
				input.value = circles[i][key];
			}
		}
	}

	_info(msg) {
		const el = document.createElement('div');
		el.className = 'info';
		el.textContent = msg;
		this.root.appendChild(el);
	}

	_circleRow(index, circle) {
		const wrap = document.createElement('div');
		wrap.className = 'collision-row';

		const header = document.createElement('div');
		header.className = 'collision-row-header';

		const label = document.createElement('span');
		label.className = 'collision-row-label';
		label.textContent = `Circle ${index}`;
		header.appendChild(label);

		const del = document.createElement('button');
		del.className = 'insp-mini';
		del.textContent = '×';
		del.title = 'Remove this circle';
		del.addEventListener('click', () => this._removeCircle(index));
		header.appendChild(del);

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
			input.addEventListener('change', () =>
				this._updateCircle(index, key, input.value));
			escapeBlurs(input);
			cell.appendChild(input);
			grid.appendChild(cell);
			this.fields[`${index}.${key}`] = input;
		}
		wrap.appendChild(grid);

		return wrap;
	}

	_addCircle() {
		const name = this.doc.selectedFrame;
		const frame = this.doc.sheet.frames[name];
		if (!frame) return;

		const current = (frame.collision && frame.collision.circles)
			? frame.collision.circles.map(c => ({ ...c }))
			: [];

		const next = [
			...current,
			{ offsetX: 0, offsetY: 0, radius: this._defaultRadius() },
		];
		this.doc.editable.setFrameCollision(name, { circles: next });
	}

	_removeCircle(index) {
		const name = this.doc.selectedFrame;
		const frame = this.doc.sheet.frames[name];
		if (!frame || !frame.collision) return;

		const next = frame.collision.circles
			.filter((_, i) => i !== index)
			.map(c => ({ ...c }));

		this.doc.editable.setFrameCollision(
			name,
			next.length ? { circles: next } : null
		);
	}

	_updateCircle(index, key, value) {
		const name = this.doc.selectedFrame;
		const frame = this.doc.sheet.frames[name];
		if (!frame || !frame.collision) return;

		const next = frame.collision.circles.map((c, i) => {
			if (i !== index) return { ...c };
			const updated = { ...c };
			updated[key] = key === 'radius'
				? Math.max(1, Number(value) || 1)
				: Number(value) || 0;
			return updated;
		});

		this.doc.editable.setFrameCollision(name, { circles: next });
	}

	_copyToAll() {
		const name = this.doc.selectedFrame;
		if (!name) return;
		this.doc.editable.copyFrameCollisionToAll(name);
	}

	_defaultRadius() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return 4;
		return Math.max(2, Math.floor(Math.min(frame.width, frame.height) / 4));
	}
}
