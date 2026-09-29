// Edits the selected sequence: rename, frameRate, iterations, and the
// ordered list of frames with add/remove/reorder controls.
import { escapeBlurs } from '../lib/fieldEscape.js';

export class SequenceInspector {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;
		this.currentName = null;
		this.fields = {};
		this.renderedFrames = null;

		doc.on('selectionChanged', () => this.rebuild());
		doc.on('sheetChanged',     () => this.rebuild());
		doc.on('edit',             () => this._onEdit());
	}

	_onEdit() {
		const seq = this.doc.getSelectedSequence();
		const nameChanged = this.doc.selectedSequence !== this.currentName;
		if (!seq || nameChanged || !this._sameFrames(seq.frames, this.renderedFrames)) {
			this.rebuild();
		} else {
			this.refresh();
		}
	}

	_sameFrames(a, b) {
		if (!a || !b || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i].frame !== b[i].frame) return false;
			// Cheap transform comparison — these are small fixed-shape
			// objects, so JSON stringify is fine.
			if (JSON.stringify(a[i].transform) !== JSON.stringify(b[i].transform)) {
				return false;
			}
		}
		return true;
	}

	rebuild() {
		this.root.innerHTML = '';
		this.fields = {};
		const seq = this.doc.getSelectedSequence();
		this.currentName = this.doc.selectedSequence;

		if (!seq) {
			this.renderedFrames = null;
			this.root.innerHTML = '<div class="info">No sequence selected.</div>';
			return;
		}
		this.renderedFrames = seq.frames.slice();

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
				this.doc.editable.renameSequence(this.currentName, v);
			} catch (err) {
				console.warn(err.message);
				nameInput.value = this.currentName;
			}
		});
		escapeBlurs(nameInput);
		nameRow.appendChild(nameInput);
		this.root.appendChild(nameRow);

		const grid = document.createElement('div');
		grid.className = 'insp-grid two';

		this._numberCell(grid, 'frameRate', seq.frameRate, (v) =>
			this.doc.editable.setSequence(this.currentName, { frameRate: v }));
		this._numberCell(grid, 'iterations', seq.iterations, (v) =>
			this.doc.editable.setSequence(this.currentName, { iterations: v }));

		this.root.appendChild(grid);

		// --- custom timing section ---------------------------------------

		const timingHeader = document.createElement('div');
		timingHeader.className = 'insp-section-label';
		timingHeader.textContent = 'Custom timing (ms)';
		this.root.appendChild(timingHeader);

		const timingRow = document.createElement('div');
		timingRow.className = 'insp-timing-row';

		const timingInput = document.createElement('input');
		timingInput.type = 'text';
		timingInput.className = 'insp-input';
		timingInput.spellcheck = false;
		timingInput.placeholder = 'blank = uniform rate';
		timingInput.value = seq.frameTimes ? seq.frameTimes.join(', ') : '';
		timingInput.addEventListener('change', () => this._commitFrameTimes(timingInput.value));
		escapeBlurs(timingInput);
		timingRow.appendChild(timingInput);

		const fillBtn = document.createElement('button');
		fillBtn.className = 'insp-mini';
		fillBtn.textContent = '⟳';
		fillBtn.title = 'Fill with the uniform frame rate';
		fillBtn.addEventListener('click', () => this._fillUniformTiming());
		timingRow.appendChild(fillBtn);

		this.root.appendChild(timingRow);

		const timingHint = document.createElement('div');
		timingHint.className = 'insp-hint';
		timingHint.textContent = seq.frameTimes && seq.frameTimes.length > 0
			? 'Overrides the frame rate above.'
			: 'Comma-separated per-frame durations. Blank uses the frame rate.';
		this.root.appendChild(timingHint);

		this.fields.frameTimes = timingInput;

		// --- frames list -------------------------------------------------

		const framesHeader = document.createElement('div');
		framesHeader.className = 'insp-section-label';
		framesHeader.textContent = `Frames (${seq.frames.length})`;
		this.root.appendChild(framesHeader);

		const list = document.createElement('ol');
		list.className = 'insp-frames';
		seq.frames.forEach((slot, i) => {
			const frameName = slot.frame;
			const li = document.createElement('li');
			if (slot.transform) li.classList.add('has-transform');

			const idx = document.createElement('span');
			idx.className = 'insp-frame-index';
			idx.textContent = i;

			const label = document.createElement('span');
			label.className = 'insp-frame-name';
			label.textContent = frameName;
			label.title = slot.transform ? `${frameName} (transformed)` : frameName;
			label.addEventListener('click', () => this.doc.selectFrame(frameName, { focus: true }));

			const up = this._miniButton('↑', i === 0, () =>
				this.doc.editable.moveSequenceFrame(this.currentName, i, i - 1));
			const down = this._miniButton('↓', i === seq.frames.length - 1, () =>
				this.doc.editable.moveSequenceFrame(this.currentName, i, i + 1));
			const del = this._miniButton('×', false, () =>
				this.doc.editable.removeFrameFromSequence(this.currentName, i));

			li.append(idx, label, up, down, del);
			list.appendChild(li);
		});
		this.root.appendChild(list);

		const add = document.createElement('button');
		add.className = 'insp-add-btn';
		add.textContent = '+ Add current frame';
		add.disabled = !this.doc.selectedFrame;
		add.addEventListener('click', () => {
			if (this.doc.selectedFrame) {
				this.doc.editable.addFrameToSequence(this.currentName, this.doc.selectedFrame);
			}
		});
		this.root.appendChild(add);
	}

	refresh() {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;
		if (this.fields.frameRate && document.activeElement !== this.fields.frameRate) {
			this.fields.frameRate.value = seq.frameRate;
		}
		if (this.fields.iterations && document.activeElement !== this.fields.iterations) {
			this.fields.iterations.value = seq.iterations;
		}
		this._syncFrameTimes();
	}

	_commitFrameTimes(raw) {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		const trimmed = String(raw).trim();
		if (trimmed === '') {
			this.doc.editable.setSequence(this.currentName, { frameTimes: [] });
			return;
		}

		const values = trimmed.split(',')
			.map(s => parseFloat(s.trim()))
			.filter(v => Number.isFinite(v) && v > 0);

		if (values.length === 0) {
			// Nothing parsable - revert the field to the stored state.
			this._syncFrameTimes();
			return;
		}

		this.doc.editable.setSequence(this.currentName, { frameTimes: values });
	}

	_fillUniformTiming() {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;

		const uniform = Math.round(1000 / (seq.frameRate || 12));
		const values = seq.frames.map(() => uniform);
		this.doc.editable.setSequence(this.currentName, { frameTimes: values });
	}

	_syncFrameTimes() {
		const seq = this.doc.getSelectedSequence();
		if (!seq) return;
		const input = this.fields.frameTimes;
		if (!input) return;
		if (document.activeElement !== input) {
			input.value = seq.frameTimes ? seq.frameTimes.join(', ') : '';
		}
	}

	_numberCell(parent, key, value, onChange) {
		const cell = document.createElement('label');
		cell.className = 'insp-cell';
		cell.innerHTML = `<span class="insp-label">${key}</span>`;
		const input = document.createElement('input');
		input.type = 'number';
		input.className = 'insp-input';
		input.value = value;
		input.min = '0';
		input.addEventListener('change', () => onChange(input.value));
		escapeBlurs(input);
		cell.appendChild(input);
		parent.appendChild(cell);
		this.fields[key] = input;
	}

	_miniButton(text, disabled, action) {
		const b = document.createElement('button');
		b.className = 'insp-mini';
		b.textContent = text;
		b.disabled = !!disabled;
		b.addEventListener('click', (e) => { e.stopPropagation(); action(); });
		return b;
	}
}
