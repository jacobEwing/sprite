// Edit-tab pane for the sheet's collision shape. Lists each circle with
// numeric fields, plus add/clear actions and an overlay toggle.

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

		const collision = this.doc.sheet.collision;
		const circles = collision && collision.circles ? collision.circles : [];

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

		if (circles.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'info';
			empty.textContent = 'No collision shape. Add a circle to begin.';
			this.root.appendChild(empty);
		} else {
			for (let i = 0; i < circles.length; i++) {
				this.root.appendChild(this._circleRow(i, circles[i]));
			}
		}

		const addBtn = document.createElement('button');
		addBtn.className = 'insp-add-btn';
		addBtn.textContent = '+ Add circle at origin';
		addBtn.addEventListener('click', () => {
			this.doc.editable.addCollisionCircle({
				offsetX: 0, offsetY: 0, radius: this._defaultRadius(),
			});
		});
		this.root.appendChild(addBtn);
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
		del.addEventListener('click', () => {
			this.doc.editable.removeCollisionCircle(index);
		});
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
			input.addEventListener('change', () => {
				this.doc.editable.updateCollisionCircle(index, {
					[key]: input.value,
				});
			});
			cell.appendChild(input);
			grid.appendChild(cell);
		}
		wrap.appendChild(grid);

		return wrap;
	}

	_defaultRadius() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return 4;
		return Math.max(2, Math.floor(Math.min(frame.width, frame.height) / 4));
	}
}
