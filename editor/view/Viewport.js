import { makeEmitter } from '../lib/emitter.js';

// Pan/zoom canvas that shows a single source image (the atlas).
//
// Coordinates:
//   screen (CSS pixels, relative to the canvas element)
//   image  (source pixels; the coordinate system frames and sprites use)
//
// Events:
//   view   — { zoom } — emitted whenever zoom or offset changes
//   hover  — { screenX, screenY, imageX, imageY }
//   leave  — pointer left the canvas
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

		this._renderPending = false;
		this._panning = null;

		this._bindEvents();
		this._observeSize();
	}

	// --- source -----------------------------------------------------------

	setSource(source) {
		this.source = source;
		// Defer fit to the next frame so layout has settled.
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

	// --- coordinate conversion -------------------------------------------

	screenToImage(sx, sy) {
		return {
			x: (sx - this.offsetX) / this.zoom,
			y: (sy - this.offsetY) / this.zoom,
		};
	}
	imageToScreen(ix, iy) {
		return {
			x: ix * this.zoom + this.offsetX,
			y: iy * this.zoom + this.offsetY,
		};
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
		this._scheduleRender();
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
		this._scheduleRender();
	}

	// --- rendering --------------------------------------------------------

	_scheduleRender() {
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
		this._scheduleRender();
	}

	// --- input ------------------------------------------------------------

	_bindEvents() {
		this.canvas.addEventListener('wheel',       (e) => this._onWheel(e),     { passive: false });
		this.canvas.addEventListener('mousedown',   (e) => this._onMouseDown(e));
		this.canvas.addEventListener('mousemove',   (e) => this._onMouseMove(e));
		this.canvas.addEventListener('mouseleave',  ()  => this.emit('leave', {}));
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
		// Middle or right drag pans. (Right will also be the "secondary
		// colour" button once the tool layer exists; the tool layer will
		// suppress panning when a drawing tool is active.)
		if (e.button === 1 || e.button === 2) {
			e.preventDefault();
			const { x, y } = this._eventPos(e);
			this._panning = { sx: x, sy: y, ox: this.offsetX, oy: this.offsetY };
		}
	}

	_onMouseMove(e) {
		const { x, y } = this._eventPos(e);
		if (this._panning) {
			this.offsetX = this._panning.ox + (x - this._panning.sx);
			this.offsetY = this._panning.oy + (y - this._panning.sy);
			this.emit('view', { zoom: this.zoom });
			this._scheduleRender();
		}
		const p = this.screenToImage(x, y);
		this.emit('hover', {
			screenX: x, screenY: y,
			imageX: p.x, imageY: p.y,
		});
	}

	_onMouseUp(e) {
		if (this._panning && (e.button === 1 || e.button === 2)) {
			this._panning = null;
		}
	}
}