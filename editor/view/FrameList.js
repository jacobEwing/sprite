import { Menu } from './Menu.js';
import { inlineRename } from '../lib/inlineRename.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

export class FrameList {
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

		for (const name of sheet.frameNames) {
			const frame = sheet.frames[name];
			const li = document.createElement('li');
			li.dataset.frame = name;
			li.innerHTML =
				`<span class="name">${esc(name)}</span>` +
				`<span class="meta">${frame.width}×${frame.height}</span>`;

			li.addEventListener('click', (e) => {
				const additive = e.ctrlKey || e.metaKey;
				const range    = e.shiftKey;
				this.doc.selectFrame(name, {
					// Focus only on plain clicks; modifiers mean the user
					// is building a selection and doesn't want the camera
					// jumping between items.
					focus: !additive && !range,
					additive,
					range,
				});
			});
			li.addEventListener('dblclick', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const nameEl = li.querySelector('.name');
				if (!nameEl) return;
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
			const isPrimary = name === primary;
			li.classList.toggle('selected', isPrimary);
			li.classList.toggle('multi-selected', !isPrimary && selected.has(name));

			// scrollIntoView with block:'nearest' is a no-op when the item
			// is already on screen, which is exactly what we want: canvas
			// clicks pull the list to the item, list clicks don't jitter it.
			if (isPrimary) li.scrollIntoView({ block: 'nearest' });
		}
	}
}
