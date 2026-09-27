// Base class for editor tools. Tools receive pointer events from ToolLayer
// in image coordinates and never see raw DOM events.
//
// Tools with configurable options override getSettings() to return an array
// of setting descriptors, and getSettingValue/setSettingValue to read and
// write them. Setting descriptors:
//   { key, label, type: 'range',    min, max, step?, format? }
//   { key, label, type: 'checkbox' }
// `format(v)` returns the display string for range values.
export class Tool {
	constructor(context) {
		this.context = context;
	}
	onPointerDown(ev) {}
	onPointerMove(ev) {}
	onPointerUp(ev)   {}
	onCancel()        {}

	getSettings()            { return []; }
	getSettingValue(key)     { return undefined; }
	setSettingValue(key, v)  {}
}
