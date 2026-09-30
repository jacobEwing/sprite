import { Menu } from './Menu.js';
import { inlineRename } from '../lib/inlineRename.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

// Left-sidebar sequence list.
//
// Interactions:
//   click           — select; ctrl/cmd toggles, shift extends a range
//   dblclick (row)  — focus the viewport on the sequence's first frame
//   dblclick (name) — start rename
//   right-click     — context menu
export class SequenceList {
	constructor(root, doc) {
		this.root = root;
		this.doc = doc;

		doc.on('sheetChanged',     () => this.render());
		doc.on('selectionChanged', () => this._sync());
		doc.on('edit',             () => this.render());

		this.render();
	}

	render() {
		this.root.innerHTML = '';
		const sheet = this.doc.sheet;
		if (!sheet) return;

		for (const name of sheet.sequenceNames) {
			const seq = sheet.sequences[name];

			const li = document.createElement('li');
			li.dataset.sequence = name;

			const nameEl = document.createElement('span');
			nameEl.className = 'name';
			nameEl.textContent = name;
			li.appendChild(nameEl);

			const iters = seq.iterations === 0 ? '∞' : `×${seq.iterations}`;
			const metaEl = document.createElement('span');
			metaEl.className = 'meta';
			metaEl.textContent = `${seq.frames.length}f ${iters}`;
			li.appendChild(metaEl);

			// --- selection ---------------------------------------------
			li.addEventListener('click', (e) => {
				const additive = e.ctrlKey || e.metaKey;
				const range    = e.shiftKey;
				this.doc.selectSequence(name, { additive, range });
			});

			// --- focus viewport on double-click, unless the dblclick
			//     landed on the name (which starts a rename instead).
			li.addEventListener('dblclick', (e) => {
				if (e.target.closest && e.target.closest('.name')) return;
				const sequence = this.doc.sheet.sequences[name];
				if (!sequence || sequence.frames.length === 0) return;
				const firstFrame = sequence.frames[0].frame;
				if (firstFrame) this.viewportFocusFrame(firstFrame);
			});

			// --- rename on double-click of the name --------------------
			nameEl.addEventListener('dblclick', (e) => {
				e.preventDefault();
				e.stopPropagation();
				inlineRename(nameEl, name, (newName) => {
					try {
						this.doc.editable.renameSequence(name, newName);
						return true;
					} catch (err) {
						console.warn(err.message);
						return false;
					}
				});
			});

			// --- context menu ------------------------------------------
			li.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this._showContextMenu(name, e.clientX, e.clientY);
			});

			this.root.appendChild(li);
		}
		this._sync();
	}

	// The SequenceList doesn't hold a viewport reference (it isn't wired
	// with one in main.js). Instead, push the request through the
	// document's frame selection, matching the frame-list behaviour.
	viewportFocusFrame(frameName) {
		this.doc.selectFrame(frameName, { focus: true });
	}

	_showContextMenu(name, x, y) {
		const ed = this.doc.editable;
		new Menu(null, [
			{
				label: 'Delete',
				action: () => ed.removeSequences([...this.doc.selectedSequences]),
			},
		]).showAt(x, y);
	}

	_sync() {
		const primary = this.doc.primarySequence;
		const selected = this.doc.selectedSequences;
		for (const li of this.root.children) {
			const name = li.dataset.sequence;
			const isPrimary = name === primary;
			li.classList.toggle('selected', isPrimary);
			li.classList.toggle('multi-selected', !isPrimary && selected.has(name));

			if (isPrimary) li.scrollIntoView({ block: 'nearest' });
		}
	}
}
