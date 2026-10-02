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
				// Right-click on an unselected item targets that item rather
				// than leaving the previous selection intact. If the item is
				// already selected (possibly as part of a multi-selection),
				// leave the selection alone so the menu acts on the whole group.
				if (!this.doc.selectedSequences.has(name)) {
					this.doc.selectSequence(name);
				}
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

		// Frames referenced by any selected sequence, deduplicated and in
		// the order they appear within each sequence.
		const selectedSet = new Set(this.doc.selectedSequences);
		const seen = new Set();
		const framesInSequences = [];
		for (const seqName of this.doc.sheet.sequenceNames) {
			if (!selectedSet.has(seqName)) continue;
			const seq = this.doc.sheet.sequences[seqName];
			for (const slot of seq.frames) {
				if (seen.has(slot.frame)) continue;
				if (!this.doc.sheet.frames[slot.frame]) continue;
				seen.add(slot.frame);
				framesInSequences.push(slot.frame);
			}
		}

		new Menu(null, [
			{
				label: 'Select frames',
				disabled: framesInSequences.length === 0,
				action: () => {
					this.doc.selectFrame(framesInSequences[0]);
					for (let i = 1; i < framesInSequences.length; i++) {
						this.doc.selectFrame(framesInSequences[i], { additive: true });
					}
					this._switchToFramesTab();
				},
			},
			{ separator: true },
			{
				label: 'Duplicate',
				action: () => {
					try {
						const created = ed.duplicateSequences(
							[...this.doc.selectedSequences]
						);
						if (created.length > 0) {
							this.doc.selectSequence(created[0]);
						}
					} catch (err) { console.warn(err.message); }
				},
			},
			{ separator: true },
			{
				label: 'Delete',
				action: () => ed.removeSequences([...this.doc.selectedSequences]),
			},
		]).showAt(x, y);
	}

	// Trigger the sidebar's own tab click so the existing handler runs
	// (selects the tab, toggles the panels, fires any onSwitch hook).
	_switchToFramesTab() {
		const btn = document.querySelector('#leftSidebar .sidebar-tab[data-tab="frames"]');
		if (btn) btn.click();
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
