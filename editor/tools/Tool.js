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
	// Subclasses override these to give the options pane a header
	// and a short usage hint list. `tips` may be empty.
	static displayName = 'Tool';
	static tips = [];

	constructor(context) {
		this.context = context;

		// Tools that act on the currently-selected frame. When a click
		// lands on a different frame, ToolLayer selects that frame and -
		// if this flag is true and clipping is on - skips the tool's
		// gesture for that click. Tools that work on the atlas as a whole
		// override this to false.
		this.cellScoped = true;
	}
	onPointerDown(ev) {}
	onPointerMove(ev) {}
	onPointerUp(ev)   {}
	onCancel()        {}

	getSettings()            { return []; }
	getSettingValue(key)     { return undefined; }
	setSettingValue(key, v)  {}

	get displayName() { return this.constructor.displayName; }
	getTips()         { return this.constructor.tips; }
}
