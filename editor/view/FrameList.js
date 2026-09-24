import { makeEmitter } from '../lib/emitter.js';

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
			li.addEventListener('click', () => this.doc.selectFrame(name));
			this.root.appendChild(li);
		}
		this._sync();
	}

	_sync() {
		const cur = this.doc.selectedFrame;
		for (const li of this.root.children) {
			li.classList.toggle('selected', li.dataset.frame === cur);
		}
	}
}