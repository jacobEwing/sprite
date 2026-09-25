import { StrokeTransaction } from '../paint/StrokeTransaction.js';

// Routes pointer events from the viewport to the active tool, and provides
// a shared ToolContext. Middle-button gestures are always routed to the pan
// tool, so panning works regardless of what's active.
export class ToolLayer {
	constructor({ viewport, document, palette, history }) {
		this.viewport  = viewport;
		this.document  = document;
		this.palette   = palette;
		this.history   = history;

		this.brush = null;
		this.fillShapes = false;
		this.clipToFrame = true;

		this.activeTool  = null;
		this.defaultTool = null;
		this.panTool     = null;

		this._active  = null;
		this._pressed = -1;

		this.collisionOverlay = null;

		this.context = this._buildContext();

		viewport.on('pointerDown', (e) => this._onDown(e));
		viewport.on('pointerMove', (e) => this._onMove(e));
		viewport.on('pointerUp',   (e) => this._onUp(e));
	}

	setActiveTool(tool)  { this.activeTool  = tool; }
	setDefaultTool(tool) { this.defaultTool = tool; }
	setPanTool(tool)     { this.panTool     = tool; }
	setBrush(brush)      { this.brush       = brush; }
	setFillShapes(on)    { this.fillShapes  = !!on; }
	setClipToFrame(on)   { this.clipToFrame = !!on; }
	setCollisionOverlay(overlay) { this.collisionOverlay = overlay; }


	notifyPixelsChanged() {
		this.viewport.invalidate();
	}

	_current() {
		return this.activeTool || this.defaultTool;
	}

	_onDown(e) {
		if (this._pressed !== -1) return;

		// If the pointer-down is inside a frame that isn't currently
		// selected, select it first. Tools clip their writes to the
		// selected frame, so clicking into a new frame and painting in one
		// gesture should target that frame, not the previously-selected one.
		// Middle-drag (pan) doesn't change selection.
		if (e.button === 0 || e.button === 2) {
			const name = this.viewport.getFrameAt(
				Math.floor(e.imageX), Math.floor(e.imageY)
			);
			if (name && name !== this.document.selectedFrame) {
				this.document.selectFrame(name);
			}
		}

		const tool = (e.button === 1 && this.panTool)
			? this.panTool
			: this._current();
		if (!tool) return;
		this._active  = tool;
		this._pressed = e.button;
		tool.onPointerDown(e);
		this.notifyPixelsChanged();
	}

	_onMove(e) {
		if (this._pressed === -1 || !this._active) return;
		this._active.onPointerMove({ ...e, button: this._pressed });
		this.notifyPixelsChanged();
	}

	_onUp(e) {
		if (this._pressed === -1) return;
		if (e.button !== this._pressed) return;
		const tool = this._active;
		this._active  = null;
		this._pressed = -1;
		if (tool) {
			tool.onPointerUp(e);
			this.notifyPixelsChanged();
		}
	}

	_buildContext() {
		const self = this;
		return {
			viewport: this.viewport,
			document: this.document,
			palette:  this.palette,
			history:  this.history,

			get collisionOverlay() { return self.collisionOverlay; },
			get brush()       { return self.brush; },
			get fillShapes()  { return self.fillShapes; },
			get clipToFrame() { return self.clipToFrame; },

			selectedFrame() {
				const f = self.document.getSelectedFrame();
				if (!f) return null;
				return {
					name: self.document.selectedFrame,
					rect: { x: f.x, y: f.y, w: f.width, h: f.height },
				};
			},

			beginStroke() {
				const sheet = self.document.sheet;
				if (!sheet) return null;

				// With clipToFrame on, writes are confined to the selected
				// frame's rect. With it off, they're confined to the whole
				// sheet — which lets shapes and strokes cross frame
				// boundaries while still bounding the undo snapshot.
				let rect;
				if (self.clipToFrame) {
					const sel = this.selectedFrame();
					if (!sel) return null;
					rect = sel.rect;
				} else {
					rect = { x: 0, y: 0, w: sheet.imageWidth, h: sheet.imageHeight };
				}

				const ctx = sheet.image.getContext('2d', { willReadFrequently: true });
				return new StrokeTransaction(ctx, rect);
			},
		};
	}
}
