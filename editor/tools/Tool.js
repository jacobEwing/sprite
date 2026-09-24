// Base class for editor tools. Tools receive pointer events from ToolLayer
// in image coordinates and never see raw DOM events.
//
// Every tool's context provides:
//   viewport       — the Viewport instance
//   document       — the EditorDocument
//   palette        — the Palette
//   history        — the History
//   brush          — the currently selected Brush
//   selectedFrame() — { name, rect } or null
//   beginStroke()  — opens a StrokeTransaction clipped to the selected frame
export class Tool {
	constructor(context) {
		this.context = context;
	}
	onPointerDown(ev) {}
	onPointerMove(ev) {}
	onPointerUp(ev)   {}
	onCancel()        {}
}
