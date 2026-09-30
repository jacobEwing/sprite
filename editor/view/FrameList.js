import { makeEmitter } from '../lib/emitter.js';
import { Menu } from './Menu.js';
import { inlineRename } from '../lib/inlineRename.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

// Left-sidebar frame list.
//
// Interactions:
//   click            — select; ctrl/cmd toggles, shift extends a range
//   dblclick (name)  — start rename
//   zoom button      — select and focus the viewport on the frame
//   right-click      — context menu
export class FrameList {
	constructor(root, doc) {
		makeEmitter(this);
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

		for (const name of sheet.frameNames) {
			const frame = sheet.frames[name];

			const li = document.createElement('li');
			li.dataset.frame = name;

			const nameEl = document.createElement('span');
			nameEl.className = 'name';
			nameEl.textContent = name;
			li.appendChild(nameEl);

			const metaEl = document.createElement('span');
			metaEl.className = 'meta';
			metaEl.textContent = `${frame.width}×${frame.height}`;
			li.appendChild(metaEl);

			// --- zoom to frame -----------------------------------------
			const zoomBtn = document.createElement('button');
			zoomBtn.className = 'list-zoom-btn';
			zoomBtn.textContent = '⌕';
			zoomBtn.title = 'Zoom to this frame';
			zoomBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.doc.selectFrame(name, { focus: true });
			});
			li.appendChild(zoomBtn);

			// --- selection ---------------------------------------------
			li.addEventListener('click', (e) => {
				const additive = e.ctrlKey || e.metaKey;
				const range    = e.shiftKey;
				this.doc.selectFrame(name, { additive, range });
			});

			// --- rename on double-click of the name --------------------
			nameEl.addEventListener('dblclick', (e) => {
				e.preventDefault();
				e.stopPropagation();
				inlineRename(nameEl, name, (newName) => {
					try {
						this.doc.editable.renameFrame(name, newName);
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

	_showContextMenu(name, x, y) {
		const ed = this.doc.editable;
		new Menu(null, [
			{
				label: 'New blank frame',
				action: () => {
					try {
						const newName = ed.createFrame();
						this.doc.selectFrame(newName, { focus: true });
					} catch (err) { console.warn(err.message); }
				},
			},
			{
				label: 'Duplicate',
				action: () => {
					try {
						const names = [...this.doc.selectedFrames];
						const created = ed.duplicateFrames(names);
						if (created.length > 0) {
							this.doc.selectFrame(created[0], { focus: true });
						}
					} catch (err) { console.warn(err.message); }
				},
			},
			{ separator: true },
			{
				label: 'Delete',
				action: () => ed.removeFrames([...this.doc.selectedFrames]),
			},
		]).showAt(x, y);
	}

	_sync() {
		const primary = this.doc.primaryFrame;
		const selected = this.doc.selectedFrames;
		for (const li of this.root.children) {
			const name = li.dataset.frame;
			li.classList.toggle('selected', name === primary);
			li.classList.toggle('multi-selected',
				name !== primary && selected.has(name));

			if (name === primary) li.scrollIntoView({ block: 'nearest' });
		}
	}
}
