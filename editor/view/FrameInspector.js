// Edits the selected frame: rename, and rect/origin fields. Rebuilds itself
// when the selection changes; refreshes field values when the underlying
// frame changes (including via undo/redo).
import { escapeBlurs } from '../lib/fieldEscape.js';
const FIELDS = ['x', 'y', 'width', 'height', 'centerx', 'centery'];

export class FrameInspector {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.currentName = null;
		this.fields = {};

		doc.on('selectionChanged', () => this.rebuild());
		doc.on('sheetChanged',     () => this.rebuild());
		doc.on('edit',             () => this._onEdit());

		this.rebuild();
	}

	_onEdit(info) {
		const type = info && info.type;
		// Selection changes are handled by the selectionChanged listener
		// above - we only care about edits that touch the selected frame's
		// fields.
		if (type !== 'frameUpdated' &&
		    type !== 'reshaped' &&
		    type !== 'history') {
			return;
		}
		if (this.doc.selectedFrame !== this.currentName) {
			this.rebuild();
		} else {
			this.refresh();
		}
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

		const nameRow = document.createElement('label');
		nameRow.className = 'insp-row';
		nameRow.innerHTML = '<span class="insp-label">Name</span>';
		const nameInput = document.createElement('input');
		nameInput.type = 'text';
		nameInput.className = 'insp-input wide';
		nameInput.value = this.currentName;
		nameInput.spellcheck = false;
		nameInput.addEventListener('change', () => {
			const v = nameInput.value.trim();
			if (!v || v === this.currentName) { nameInput.value = this.currentName; return; }
			try {
				this.doc.editable.renameFrame(this.currentName, v);
			} catch (err) {
				console.warn(err.message);
				nameInput.value = this.currentName;
			}
		});
		escapeBlurs(nameInput);
		nameRow.appendChild(nameInput);
		this.root.appendChild(nameRow);

		const grid = document.createElement('div');
		grid.className = 'insp-grid';
		for (const key of FIELDS) {
			const cell = document.createElement('label');
			cell.className = 'insp-cell';
			cell.innerHTML = `<span class="insp-label">${key}</span>`;
			const input = document.createElement('input');
			input.type = 'number';
			input.className = 'insp-input';
			input.value = frame[key];
			input.step = '1';
			if (key === 'width' || key === 'height') input.min = '1';
			input.addEventListener('change', () => {
				this.doc.editable.setFrame(this.currentName, { [key]: input.value });
				// The model clamps width/height to >= 1 and may reject the
				// value outright (no-op). Re-read so the field always
				// reflects what's actually stored.
				const frame = this.doc.getSelectedFrame();
				if (frame) input.value = frame[key];
			});
			escapeBlurs(input);
			cell.appendChild(input);
			grid.appendChild(cell);
			this.fields[key] = input;
		}
		this.root.appendChild(grid);
	}

	refresh() {
		const frame = this.doc.getSelectedFrame();
		if (!frame) return;
		for (const key of FIELDS) {
			const input = this.fields[key];
			if (!input) continue;
			if (document.activeElement === input) continue;
			input.value = frame[key];
		}
	}
}
