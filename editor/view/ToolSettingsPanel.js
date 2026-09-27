// Renders the active tool's settings. Rebuilt whenever the active tool
// changes, so the panel always matches the tool the user is holding.
//
// Reads the schema via tool.getSettings() and reads/writes values through
// tool.getSettingValue() / tool.setSettingValue(). Tools that don't expose
// any settings get a plain "no settings" placeholder.

export class ToolSettingsPanel {
	constructor(root) {
		this.root = root;
		this.tool = null;
	}

	showFor(tool) {
		this.tool = tool;
		this.root.innerHTML = '';

		if (!tool || typeof tool.getSettings !== 'function') {
			this._renderEmpty('No tool selected.');
			return;
		}

		const settings = tool.getSettings();
		if (!settings || settings.length === 0) {
			this._renderEmpty('No settings for this tool.');
			return;
		}

		for (const setting of settings) {
			this.root.appendChild(this._renderSetting(setting));
		}
	}

	_renderEmpty(msg) {
		const el = document.createElement('div');
		el.className = 'info';
		el.textContent = msg;
		this.root.appendChild(el);
	}

	_renderSetting(setting) {
		const wrap = document.createElement('div');
		wrap.className = 'tool-setting';

		const label = document.createElement('div');
		label.className = 'tool-setting-label';
		label.textContent = setting.label;
		wrap.appendChild(label);

		const row = document.createElement('div');
		row.className = 'tool-setting-row';

		const current = this.tool.getSettingValue(setting.key);

		if (setting.type === 'range') {
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

		} else if (setting.type === 'checkbox') {
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = !!current;
			box.addEventListener('change', () => {
				this.tool.setSettingValue(setting.key, box.checked);
			});
			row.appendChild(box);
		}

		wrap.appendChild(row);
		return wrap;
	}

	_format(setting, v) {
		if (typeof setting.format === 'function') return setting.format(v);
		return String(v);
	}
}
