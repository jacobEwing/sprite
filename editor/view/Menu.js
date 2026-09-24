// A dropdown menu attached to a trigger button. Items are objects:
//   { label, shortcut?, action, disabled? }     — a normal item
//   { separator: true }                          — a horizontal rule
//
// The panel is appended to document.body and positioned below the trigger,
// so it can overflow the toolbar without being clipped. Click-outside,
// Escape, and item activation all close it.
export class Menu {
	constructor(trigger, items) {
		this.trigger = trigger;
		this.items = items;
		this.open = false;
		this._panel = null;

		this.trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggle();
		});

		document.addEventListener('mousedown', (e) => {
			if (!this.open) return;
			if (this._panel && this._panel.contains(e.target)) return;
			if (this.trigger.contains(e.target)) return;
			this.close();
		});

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.open) this.close();
		});
	}

	toggle() { this.open ? this.close() : this.show(); }

	show() {
		if (this.open) return;
		this.open = true;

		const panel = document.createElement('div');
		panel.className = 'menu-panel';

		for (const item of this.items) {
			if (item.separator) {
				const sep = document.createElement('div');
				sep.className = 'menu-separator';
				panel.appendChild(sep);
				continue;
			}

			const btn = document.createElement('button');
			btn.className = 'menu-item';
			btn.disabled = !!item.disabled;
			if (item.title) btn.title = item.title;

			const label = document.createElement('span');
			label.className = 'menu-label';
			label.textContent = item.label;

			const shortcut = document.createElement('span');
			shortcut.className = 'menu-shortcut';
			shortcut.textContent = item.shortcut || '';

			btn.appendChild(label);
			btn.appendChild(shortcut);

			btn.addEventListener('click', () => {
				this.close();
				if (!item.disabled && item.action) item.action();
			});

			panel.appendChild(btn);
		}

		document.body.appendChild(panel);
		this._panel = panel;

		const r = this.trigger.getBoundingClientRect();
		const w = panel.offsetWidth;
		const h = panel.offsetHeight;

		let x = r.left;
		let y = r.bottom + 4;
		if (x + w > window.innerWidth  - 8) x = window.innerWidth  - w - 8;
		if (y + h > window.innerHeight - 8) y = r.top - h - 4;
		if (x < 8) x = 8;
		if (y < 8) y = 8;

		panel.style.left = x + 'px';
		panel.style.top  = y + 'px';
	}

	close() {
		if (!this.open) return;
		this.open = false;
		if (this._panel) {
			this._panel.remove();
			this._panel = null;
		}
	}
}
