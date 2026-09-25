// A dropdown menu. Items are objects:
//   { label, shortcut?, action, disabled?, title? } — a normal item
//   { separator: true }                              — a horizontal rule
//
// Two modes:
//   new Menu(trigger, items)   — opens below the trigger on click
//   new Menu(null, items).showAt(x, y) — open programmatically (context menu)
export class Menu {
	constructor(trigger, items) {
		this.trigger = trigger || null;
		this.items = items;
		this.open = false;
		this._panel = null;

		if (this.trigger) {
			this.trigger.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggle();
			});
		}

		document.addEventListener('mousedown', (e) => {
			if (!this.open) return;
			if (this._panel && this._panel.contains(e.target)) return;
			if (this.trigger && this.trigger.contains(e.target)) return;
			this.close();
		});

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.open) this.close();
		});
	}

	toggle() { this.open ? this.close() : (this.trigger && this.showBelow(this.trigger)); }

	showBelow(trigger) {
		const r = trigger.getBoundingClientRect();
		this._show(r.left, r.bottom + 4, r.right, r.top - 4);
	}

	showAt(x, y) {
		this._show(x, y, x, y);
	}

	_show(preferredX, preferredY, flipRight, flipTop) {
		if (this.open) this.close();
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
			btn.innerHTML =
				`<span class="menu-label">${item.label}</span>` +
				`<span class="menu-shortcut">${item.shortcut || ''}</span>`;
			btn.addEventListener('click', () => {
				this.close();
				if (!item.disabled && item.action) item.action();
			});
			panel.appendChild(btn);
		}

		document.body.appendChild(panel);
		this._panel = panel;

		const w = panel.offsetWidth;
		const h = panel.offsetHeight;
		let x = preferredX;
		let y = preferredY;
		if (x + w > window.innerWidth  - 8) x = flipRight - w;
		if (y + h > window.innerHeight - 8) y = flipTop   - h;
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
