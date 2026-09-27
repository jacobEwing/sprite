import { Menu } from './Menu.js';
import { inlineRename } from '../lib/inlineRename.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

export class SequenceList {
	constructor(root, doc) {
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

		for (const name of sheet.sequenceNames) {
			const seq = sheet.sequences[name];
			const li = document.createElement('li');
			li.dataset.sequence = name;
			const iters = seq.iterations === 0 ? '∞' : `×${seq.iterations}`;
			li.innerHTML =
				`<span class="name">${esc(name)}</span>` +
				`<span class="meta">${seq.frames.length}f ${iters}</span>`;

			li.addEventListener('click', () => this.doc.selectSequence(name));
			li.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this._showContextMenu(name, e.clientX, e.clientY);
			});
			li.addEventListener('dblclick', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const nameEl = li.querySelector('.name');
				if (!nameEl) return;
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

			this.root.appendChild(li);
		}
		this._sync();
	}

	_showContextMenu(name, x, y) {
		const ed = this.doc.editable;
		new Menu(null, [
			{ label: 'Delete', action: () => ed.removeSequence(name) },
		]).showAt(x, y);
	}

	_sync() {
		const cur = this.doc.selectedSequence;
		for (const li of this.root.children) {
			li.classList.toggle('selected', li.dataset.sequence === cur);
		}
	}
}
