import { makeEmitter } from '../lib/emitter.js';
import { Menu } from './Menu.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

export class FrameList {
	constructor(root, doc) {
		makeEmitter(this);
		this.root = root;
		this.doc = doc;

		doc.on('sheetChanged',     () => this.render());
		doc.on('selectionChanged', () => this._sync());
		doc.on('edit', () => this.render());

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

			li.addEventListener('click', () => this.doc.selectFrame(name, { focus: true }));
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
						const newName = ed.duplicateFrame(name);
						this.doc.selectFrame(newName, { focus: true });
					} catch (err) { console.warn(err.message); }
				},
			},
			{ separator: true },
			{ label: 'Delete', action: () => ed.removeFrame(name) },
		]).showAt(x, y);
	}

	_sync() {
		const cur = this.doc.selectedFrame;
		for (const li of this.root.children) {
			li.classList.toggle('selected', li.dataset.frame === cur);
		}
	}
}
