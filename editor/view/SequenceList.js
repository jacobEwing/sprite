import { makeEmitter } from '../lib/emitter.js';

function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

export class SequenceList {
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

		for (const name of sheet.sequenceNames) {
			const seq = sheet.sequences[name];
			const li = document.createElement('li');
			li.dataset.sequence = name;
			const iters = seq.iterations === 0 ? '∞' : `×${seq.iterations}`;
			li.innerHTML =
				`<span class="name">${esc(name)}</span>` +
				`<span class="meta">${seq.frames.length}f ${iters}</span>`;
			li.addEventListener('click', () => this.doc.selectSequence(name));
			this.root.appendChild(li);
		}
		this._sync();
	}

	_sync() {
		const cur = this.doc.selectedSequence;
		for (const li of this.root.children) {
			li.classList.toggle('selected', li.dataset.sequence === cur);
		}
	}
}