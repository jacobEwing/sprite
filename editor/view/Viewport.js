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

		this.overlays = new Map();
		this._singlePreviewToken = null;

		this.showGrid  = false;
		this.gridStepX = 0;
		this.gridStepY = 0;
		this.background = {
			texture: 'checker',
			colorA:  '#1e1e20',
			colorB:  '#26262a',
		};
		this._bgCache = { signature: null, pattern: null, tile: null };


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

	// True when the whole source image is visible within the current
	// viewport, with no part of it panned off-screen. Used by the selection
	// focus rule: when the sheet fits, a list click only selects; when it
	// doesn't, the camera follows the selection.
	get sheetFits() {
		if (!this.source) return false;
		const rect = this.canvas.getBoundingClientRect();
		const w = this.sourceWidth * this.zoom;
		const h = this.sourceHeight * this.zoom;
		return this.offsetX >= 0
			&& this.offsetY >= 0
			&& this.offsetX + w <= rect.width
			&& this.offsetY + h <= rect.height;
	}

	// --- preview overlay --------------------------------------------------

	// Set a function (ctx) => void that will be called with the context in
	// image space, after the source and before the frame outlines.
	// Pass null to clear.
	// Multiple overlays can be active at once; they render in insertion
	// order, after the source image and before the frame outlines.
	// addOverlay returns a token; pass it to removeOverlay.
	addOverlay(fn) {
		const token = {};
		this.overlays.set(token, fn);
		this.invalidate();
		return token;
	}

	removeOverlay(token) {
		if (this.overlays.delete(token)) this.invalidate();
	}

	// Legacy single-slot API. Kept so tools that just need "one preview
	// at a time" don't have to manage tokens themselves.
	setPreview(fn) {
		if (this._singlePreviewToken) {
			this.removeOverlay(this._singlePreviewToken);
			this._singlePreviewToken = null;
		}
		if (fn) this._singlePreviewToken = this.addOverlay(fn);
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

	// --- grid setters -------------------------------------------
	setShowGrid(on) {
		this.showGrid = !!on;
		this.invalidate();
	}

	setGridStep(w, h) {
		this.gridStepX = Number(w) || 0;
		this.gridStepY = Number(h) || 0;
		this.invalidate();
	}

	setBackground(patch) {
		Object.assign(this.background, patch);
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

		this._drawBackground(ctx);

		if (!this.source) return;

		ctx.imageSmoothingEnabled = false;

		ctx.save();
		ctx.translate(this.offsetX, this.offsetY);
		ctx.scale(this.zoom, this.zoom);
		ctx.drawImage(this.source, 0, 0);
		ctx.restore();

		this._drawGrid(ctx);

		// Atlas perimeter.
		ctx.save();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
		ctx.lineWidth = 1;
		const px = Math.round(this.offsetX) + 0.5;
		const py = Math.round(this.offsetY) + 0.5;
		const pw = Math.round(this.sourceWidth * this.zoom) - 1;
		const ph = Math.round(this.sourceHeight * this.zoom) - 1;
		ctx.strokeRect(px, py, pw, ph);
		ctx.restore();

		if (this.overlays.size > 0) {
			ctx.save();
			ctx.translate(this.offsetX, this.offsetY);
			ctx.scale(this.zoom, this.zoom);
			for (const fn of this.overlays.values()) fn(ctx, this);
			ctx.restore();
		}

		this._drawFrameOverlays(ctx);
	}
	_drawBackground(ctx) {
		const rect = this.canvas.getBoundingClientRect();
		const w = rect.width;
		const h = rect.height;
		const { texture, colorA, colorB } = this.background;

		ctx.fillStyle = colorA;
		ctx.fillRect(0, 0, w, h);
		if (texture === 'none') return;

		const pattern = this._patternFor(texture, colorA, colorB);
		if (!pattern) return;
		ctx.fillStyle = pattern;
		ctx.fillRect(0, 0, w, h);
	}

	// Cached CanvasPattern for the current (texture, colorA, colorB). The
	// tile is cheap to build but createPattern allocates; caching means
	// panning, zooming, and idle redraws reuse the same pattern.
	_patternFor(texture, colorA, colorB) {
		const signature = `${texture}|${colorA}|${colorB}`;
		if (this._bgCache.signature === signature) return this._bgCache.pattern;

		const tile = _buildTextureTile(texture, colorA, colorB);
		if (!tile) {
			this._bgCache.signature = signature;
			this._bgCache.pattern   = null;
			this._bgCache.tile      = null;
			return null;
		}

		const pattern = this.ctx.createPattern(tile, 'repeat');
		this._bgCache.signature = signature;
		this._bgCache.pattern   = pattern;
		this._bgCache.tile      = tile;   // hold a reference alongside the pattern
		return pattern;
	}

	_drawGrid(ctx) {
		if (!this.showGrid) return;
		if (this.gridStepX <= 0 || this.gridStepY <= 0) return;
		if (this.zoom < 3) return;   // too dense to be useful

		const rect = this.canvas.getBoundingClientRect();
		const w = rect.width;
		const h = rect.height;

		const sheetL = Math.max(0, this.offsetX);
		const sheetT = Math.max(0, this.offsetY);
		const sheetR = Math.min(w, this.offsetX + this.sourceWidth  * this.zoom);
		const sheetB = Math.min(h, this.offsetY + this.sourceHeight * this.zoom);
		if (sheetR <= sheetL || sheetB <= sheetT) return;

		ctx.save();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
		ctx.lineWidth = 1;
		ctx.beginPath();

		const cols = Math.ceil(this.sourceWidth / this.gridStepX);
		for (let i = 0; i <= cols; i++) {
			const sx = Math.round(this.offsetX + i * this.gridStepX * this.zoom) + 0.5;
			if (sx < sheetL || sx > sheetR) continue;
			ctx.moveTo(sx, sheetT);
			ctx.lineTo(sx, sheetB);
		}

		const rows = Math.ceil(this.sourceHeight / this.gridStepY);
		for (let j = 0; j <= rows; j++) {
			const sy = Math.round(this.offsetY + j * this.gridStepY * this.zoom) + 0.5;
			if (sy < sheetT || sy > sheetB) continue;
			ctx.moveTo(sheetL, sy);
			ctx.lineTo(sheetR, sy);
		}

		ctx.stroke();
		ctx.restore();
	}

	_drawFrameOverlays(ctx) {
		if (!this.frames) return;

		const names = Object.keys(this.frames);

		// Faint outline on every frame.
		ctx.save();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
		ctx.lineWidth = 1;
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

		// Hovered frame.
		if (this.hoveredFrame && this.hoveredFrame !== this.selectedFrame) {
			const f = this.frames[this.hoveredFrame];
			if (f) {
				ctx.save();
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
				ctx.lineWidth = 1;
				ctx.strokeRect(
					this.offsetX + f.x * this.zoom,
					this.offsetY + f.y * this.zoom,
					f.width  * this.zoom,
					f.height * this.zoom
				);
				ctx.restore();
			}
		}

		// Selected frame: dark under-stroke for contrast, bright over-stroke.
		if (this.selectedFrame) {
			const f = this.frames[this.selectedFrame];
			if (f) {
				const sx = this.offsetX + f.x * this.zoom;
				const sy = this.offsetY + f.y * this.zoom;
				const sw = f.width  * this.zoom;
				const sh = f.height * this.zoom;

				ctx.save();
				ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
				ctx.lineWidth = 3;
				ctx.strokeRect(sx, sy, sw, sh);

				ctx.strokeStyle = '#d08040';
				ctx.lineWidth = 1.5;
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

// Build a small tile canvas for the given texture. Returned as a canvas
// suitable for createPattern. Tile dimensions are chosen so the pattern
// repeats seamlessly in both axes.
function _buildTextureTile(texture, colorA, colorB) {
	const S = 8;
	let tw, th;

	switch (texture) {
		case 'checker': tw = th = S * 2; break;
		case 'dots':    tw = th = S;     break;
		case 'stripes': tw = th = S;     break;
		default: return null;
	}

	const tile = document.createElement('canvas');
	tile.width  = tw;
	tile.height = th;
	const tctx = tile.getContext('2d');
	tctx.imageSmoothingEnabled = false;

	tctx.fillStyle = colorA;
	tctx.fillRect(0, 0, tw, th);

	switch (texture) {
		case 'checker':
			// 2S×2S with two opposite S×S blocks in colour B. This is the
			// smallest tile that produces a classic checker.
			tctx.fillStyle = colorB;
			tctx.fillRect(0, 0, S, S);
			tctx.fillRect(S, S, S, S);
			break;

		case 'dots':
			// S×S tile with a 2×2 dot at the corner, which wrapping places
			// at every S-aligned intersection.
			tctx.fillStyle = colorB;
			tctx.fillRect(S - 2, S - 2, 2, 2);
			break;

		case 'stripes':
			// S×S tile with the same (x + y) % S < 2 predicate as before.
			// Because the predicate is periodic with period S in both axes,
			// the tile is exactly the pattern and repeats seamlessly.
			tctx.fillStyle = colorB;
			for (let y = 0; y < S; y++) {
				for (let x = 0; x < S; x++) {
					if ((x + y) % S < 2) tctx.fillRect(x, y, 1, 1);
				}
			}
			break;
	}

	return tile;
}
