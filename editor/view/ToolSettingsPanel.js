// Renders the active tool's settings. Rebuilt whenever the active tool
// changes, so the panel always matches the tool the user is holding.
//
// Reads the schema via tool.getSettings() and reads/writes values through
// tool.getSettingValue() / tool.setSettingValue(). Tools that don't expose
// any settings get a plain "no settings" placeholder.
//
// Two setting shapes are supported:
//   range    — label above, slider + readout below
//   checkbox — inline label, matching the .checkbox pattern used in
//              index.html for the "Clip to frame" / "Fill shape" options

export class ToolSettingsPanel {
	constructor(root) {
		this.root = root;
		this.tool = null;
	}

	showFor(tool) {
		this.tool = tool;
		this.root.innerHTML = '';

		if (!tool || typeof tool.getSettings !== 'function') return;

		const settings = tool.getSettings();
		if (!settings || settings.length === 0) return;

		for (const setting of settings) {
			const el = this._renderSetting(setting);
			if (el) this.root.appendChild(el);
		}
	}

	_renderSetting(setting) {
		if (setting.type === 'checkbox') return this._renderCheckbox(setting);
		if (setting.type === 'range')    return this._renderRange(setting);
		return null;
	}

	// Inline checkbox row, matching .checkbox in index.html: a label
	// wrapping the input and the text, cursor-pointer, sentence case.
	_renderCheckbox(setting) {
		const wrap = document.createElement('div');
		wrap.className = 'tool-setting tool-setting-checkbox';

		const label = document.createElement('label');
		label.className = 'checkbox';

		const box = document.createElement('input');
		box.type = 'checkbox';
		box.checked = !!this.tool.getSettingValue(setting.key);
		box.addEventListener('change', () => {
			this.tool.setSettingValue(setting.key, box.checked);
			// A checkbox toggle can change which other settings apply
			// (e.g. airbrush "Random pixels" swaps the flow readout).
			// Rebuild the panel so the schema stays in sync. Range
			// inputs use 'input', not 'change', for their live updates,
			// so this doesn't fire during a slider drag.
			this.showFor(this.tool);
		});

		label.appendChild(box);
		label.appendChild(document.createTextNode(' ' + setting.label));
		wrap.appendChild(label);
		return wrap;
	}

	_renderRange(setting) {
		const wrap = document.createElement('div');
		wrap.className = 'tool-setting';

		const label = document.createElement('div');
		label.className = 'tool-setting-label';
		label.textContent = setting.label;
		wrap.appendChild(label);

		const row = document.createElement('div');
		row.className = 'tool-setting-row';

		const current = this.tool.getSettingValue(setting.key);

		const slider = document.createElement('input');
		slider.type = 'range';
		slider.className = 'tool-setting-range';
		slider.min = setting.min;
		slider.max = setting.max;
		slider.step = setting.step || 1;
		slider.value = current;

		const readout = document.createElement('span');
		readout.className = 'tool-setting-value';
		readout.textContent = this._format(setting, current);

		slider.addEventListener('input', () => {
			const v = parseFloat(slider.value);
			this.tool.setSettingValue(setting.key, v);
			readout.textContent = this._format(setting, v);
		});

		row.appendChild(slider);
		row.appendChild(readout);
		wrap.appendChild(row);
		return wrap;
	}

	_format(setting, v) {
		if (typeof setting.format === 'function') return setting.format(v);
		return String(v);
	}
}
