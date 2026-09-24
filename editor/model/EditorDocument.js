import { makeEmitter } from '../lib/emitter.js';

// The document holds the loaded sheet and the current selection. All views
// subscribe to its events; nothing else holds authoritative state.
//
// Events:
//   sheetChanged     — a new sheet has been set (payload: { sheet })
//   selectionChanged — the selected frame or sequence changed
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
		this.emit('selectionChanged', {});
	}

	selectFrame(name) {
		if (this.selectedFrame === name) return;
		this.selectedFrame = name;
		this.emit('selectionChanged', { frame: name });
	}

	selectSequence(name) {
		if (this.selectedSequence === name) return;
		this.selectedSequence = name;
		this.emit('selectionChanged', { sequence: name });
	}

	getSelectedFrame() {
		return this.sheet && this.selectedFrame
			? this.sheet.frames[this.selectedFrame]
			: null;
	}
}