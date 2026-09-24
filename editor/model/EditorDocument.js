import { makeEmitter } from '../lib/emitter.js';

// The document holds the loaded sheet and the current selection. All views
// subscribe to its events; nothing else holds authoritative state.
//
// Events:
//   sheetChanged     — a new sheet has been set
//   selectionChanged — { frame?, sequence?, focus } — the selection changed
//
// The `focus` flag distinguishes a deliberate "take me to this frame" click
// (sidebar) from a routine selection (viewport). Only the former pans and
// zooms the viewport.
export class EditorDocument {
	constructor() {
		makeEmitter(this);

		this.sheet = null;
		this.selectedFrame = null;
		this.selectedSequence = null;
	}

	setSheet(sheet) {
		this.sheet = sheet;
		this.selectedFrame = sheet.frameNames[0] ?? null;
		this.selectedSequence = sheet.sequenceNames[0] ?? null;
		this.emit('sheetChanged', { sheet });
		this.emit('selectionChanged', { focus: false });
	}

	selectFrame(name, { focus = false } = {}) {
		const changed = this.selectedFrame !== name;
		this.selectedFrame = name;
		this.emit('selectionChanged', { frame: name, changed, focus });
	}

	selectSequence(name) {
		const changed = this.selectedSequence !== name;
		this.selectedSequence = name;
		this.emit('selectionChanged', { sequence: name, changed });
	}

	getSelectedFrame() {
		return this.sheet && this.selectedFrame
			? this.sheet.frames[this.selectedFrame]
			: null;
	}
}
