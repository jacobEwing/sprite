import { makeEmitter } from '../lib/emitter.js';

// Pan/zoom canvas that shows a single source image (the atlas).
//
// Coordinates:
//   screen (CSS pixels, relative to the canvas element)
//   image  (source pixels; the coordinate system frames and sprites use)
//
// Emits:
//   view         — { zoom }
//   hover        — { screenX, screenY, imageX, imageY }
//   leave        — pointer left the canvas
//   frameHover   — { frameName } when the hovered frame changes
//   pointerDown  — { screenX, screenY, imageX, imageY, button }
//   pointerMove  — { screenX, screenY, imageX, imageY, buttons }
//   pointerUp    — { screenX, screenY, imageX, imageY, button }
//   pointerLeave — pointer left the canvas
export class Viewport {
	constructor(canvas) {
		makeEmitter(this);

		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.source = null;

		this.zoom = 1;
		this.offsetX = 0;
		this.offsetY = 0;
		this.dpr = window.devicePixelRatio || 1;

		this.frames = null;
		this.selectedFrame = null;
		this.hoveredFrame = null;

		// Optional draw function invoked between the source image and the
		// frame overlays, with the transform already set to image space.
		this.previewFn = null;

		this._renderPending = false;

		this._bindEvents();
		this._observeSize();
	}

	// --- source -----------------------------------------------------------

	setSource(source) {
		this.source = source;
		requestAnimationFrame(() => this.fit());
	}

	get sourceWidth() {
		if (!this.source) return 0;
		return this.source.naturalWidth || this.source.width || 0;
	}
	get sourceHeight() {
		if (!this.source) return 0;
		return this.source.naturalHeight || this.source.height || 0;
	}

	// --- preview overlay --------------------------------------------------

	// Set a function (ctx) => void that will be called with the context in
	// image space, after the source and before the frame outlines.
	// Pass null to clear.
	setPreview(fn) {
		this.previewFn = fn || null;
		this.invalidate();
	}

	// --- frames -----------------------------------------------------------

	setFrames(frames) {
		this.frames = frames;
		this.invalidate();
	}
	setSelectedFrame(name) {
		if (this.selectedFrame === name) return;
		this.selectedFrame = name;
		this.invalidate();
	}
	setHoveredFrame(name) {
		if (this.hoveredFrame === name) return;
		this.hoveredFrame = name;
		this.emit('frameHover', { frameName: name });
		this.invalidate();
	}

	getFrameAt(imageX, imageY) {
		if (!this.frames) return null;
		const names = Object.keys(this.frames);
		for (let i = names.length - 1; i >= 0; i--) {
			const name = names[i];
			const f = this.frames[name];
			if (imageX >= f.x && imageX < f.x + f.width &&
			    imageY >= f.y && imageY < f.y + f.height) return name;
		}
		return null;
	}

	focusFrame(name) {
		const f = this.frames && this.frames[name];
		if (!f) return;

		const rect = this.canvas.getBoundingClientRect();
		const fitX = (rect.width  * 0.6) / f.width;
		const fitY = (rect.height * 0.6) / f.height;
		let z = Math.min(fitX, fitY);
		if (z >= 1) z = Math.max(1, Math.round(z));
		else        z = Math.max(0.25, z);

		this.zoom = z;
		this.offsetX = rect.width  / 2 - (f.x + f.width  / 2) * z;
		this.offsetY = rect.height / 2 - (f.y + f.height / 2) * z;

		this.emit('view', { zoom: this.zoom });
		this.invalidate();
	}

	// --- coordinate conversion -------------------------------------------

	screenToImage(sx, sy) {
		return { x: (sx - this.offsetX) / this.zoom, y: (sy - this.offsetY) / this.zoom };
	}
	imageToScreen(ix, iy) {
		return { x: ix * this.zoom + this.offsetX, y: iy * this.zoom + this.offsetY };
	}

	// --- view control -----------------------------------------------------

	fit() {
		const w = this.sourceWidth, h = this.sourceHeight;
		if (!w || !h) return;

		const rect = this.canvas.getBoundingClientRect();
		const pad = 24;
		const zx = (rect.width  - pad * 2) / w;
		const zy = (rect.height - pad * 2) / h;
		let z = Math.min(zx, zy);
		if (z >= 1) z = Math.max(1, Math.floor(z));
		else        z = Math.max(0.25, z);

		this.zoom = z;
		this.offsetX = (rect.width  - w * z) / 2;
		this.offsetY = (rect.height - h * z) / 2;

		this.emit('view', { zoom: this.zoom });
		this.invalidate();
	}

	zoomBy(factor) {
		const rect = this.canvas.getBoundingClientRect();
		this.zoomAt(this.zoom * factor, rect.width / 2, rect.height / 2);
	}

	zoomAt(z, sx, sy) {
		z = Math.max(0.25, Math.min(64, z));
		const p = this.screenToImage(sx, sy);
		this.zoom = z;
		this.offsetX = sx - p.x * z;
		this.offsetY = sy - p.y * z;
		this.emit('view', { zoom: this.zoom });
		this.invalidate();
	}

	// --- rendering --------------------------------------------------------

	invalidate() {
		if (this._renderPending) return;
		this._renderPending = true;
		requestAnimationFrame(() => {
			this._renderPending = false;
			this.render();
		});
	}

	render() {
		const ctx = this.ctx;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.scale(this.dpr, this.dpr);
		ctx.imageSmoothingEnabled = false;

		if (!this.source) return;

		ctx.save();
		ctx.translate(this.offsetX, this.offsetY);
		ctx.scale(this.zoom, this.zoom);
		ctx.drawImage(this.source, 0, 0);
		ctx.restore();

		if (this.previewFn) {
			ctx.save();
			ctx.translate(this.offsetX, this.offsetY);
			ctx.scale(this.zoom, this.zoom);
			this.previewFn(ctx, this);
			ctx.restore();
		}

		this._drawFrameOverlays(ctx);
	}

	_drawFrameOverlays(ctx) {
		if (!this.frames) return;

		const hairline = 1 / this.zoom;
		const names = Object.keys(this.frames);

		ctx.save();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
		ctx.lineWidth = hairline;
		ctx.beginPath();
		for (const name of names) {
			const f = this.frames[name];
			ctx.rect(
				this.offsetX + f.x * this.zoom,
				this.offsetY + f.y * this.zoom,
				f.width  * this.zoom,
				f.height * this.zoom
			);
		}
		ctx.stroke();
		ctx.restore();

		if (this.hoveredFrame && this.hoveredFrame !== this.selectedFrame) {
			const f = this.frames[this.hoveredFrame];
			if (f) {
				ctx.save();
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
				ctx.lineWidth = hairline;
				ctx.strokeRect(
					this.offsetX + f.x * this.zoom,
					this.offsetY + f.y * this.zoom,
					f.width  * this.zoom,
					f.height * this.zoom
				);
				ctx.restore();
			}
		}

		if (this.selectedFrame) {
			const f = this.frames[this.selectedFrame];
			if (f) {
				const sx = this.offsetX + f.x * this.zoom;
				const sy = this.offsetY + f.y * this.zoom;
				const sw = f.width  * this.zoom;
				const sh = f.height * this.zoom;

				ctx.save();
				ctx.fillStyle = 'rgba(208, 128, 64, 0.12)';
				ctx.fillRect(sx, sy, sw, sh);

				ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
				ctx.lineWidth = hairline * 3;
				ctx.strokeRect(sx, sy, sw, sh);

				ctx.strokeStyle = '#d08040';
				ctx.lineWidth = hairline * 1.5;
				ctx.strokeRect(sx, sy, sw, sh);
				ctx.restore();
			}
		}
	}

	// --- sizing -----------------------------------------------------------

	_observeSize() {
		const ro = new ResizeObserver(() => this._resize());
		ro.observe(this.canvas);
		this._resize();
	}

	_resize() {
		const rect = this.canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(rect.width  * dpr));
		const h = Math.max(1, Math.round(rect.height * dpr));
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width  = w;
			this.canvas.height = h;
		}
		this.dpr = dpr;
		this.invalidate();
	}

	// --- input ------------------------------------------------------------

	_bindEvents() {
		this.canvas.addEventListener('wheel',       (e) => this._onWheel(e), { passive: false });
		this.canvas.addEventListener('mousedown',   (e) => this._onMouseDown(e));
		this.canvas.addEventListener('mousemove',   (e) => this._onMouseMove(e));
		this.canvas.addEventListener('mouseleave',  ()  => this._onMouseLeave());
		window.addEventListener('mouseup',          (e) => this._onMouseUp(e));
		this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	_eventPos(e) {
		const r = this.canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	_onWheel(e) {
		e.preventDefault();
		if (!this.source) return;
		const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
		const { x, y } = this._eventPos(e);
		this.zoomAt(this.zoom * factor, x, y);
	}

	_onMouseDown(e) {
		e.preventDefault();
		const { x, y } = this._eventPos(e);
		const p = this.screenToImage(x, y);
		this.emit('pointerDown', {
			screenX: x, screenY: y,
			imageX: p.x, imageY: p.y,
			button: e.button,
			originalEvent: e,
		});
	}

	_onMouseMove(e) {
		const { x, y } = this._eventPos(e);
		const p = this.screenToImage(x, y);

		this.emit('hover', { screenX: x, screenY: y, imageX: p.x, imageY: p.y });
		this.emit('pointerMove', {
			screenX: x, screenY: y,
			imageX: p.x, imageY: p.y,
			buttons: e.buttons,
			originalEvent: e,
		});

		const frameName = this.getFrameAt(Math.floor(p.x), Math.floor(p.y));
		this.setHoveredFrame(frameName);
	}

	_onMouseUp(e) {
		const { x, y } = this._eventPos(e);
		const p = this.screenToImage(x, y);
		this.emit('pointerUp', {
			screenX: x, screenY: y,
			imageX: p.x, imageY: p.y,
			button: e.button,
			originalEvent: e,
		});
	}

	_onMouseLeave() {
		this.emit('leave', {});
		this.emit('pointerLeave', {});
		this.setHoveredFrame(null);
	}
}
