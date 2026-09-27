// Draws the selection marquee. Reads the document's selection state, so
// it always reflects the current selection regardless of active tool.

export class SelectionOverlay {
	constructor(doc, viewport) {
		this.doc = doc;
		this.viewport = viewport;

		this._token = viewport.addOverlay((ctx) => this._draw(ctx));

		doc.on('sheetChanged',       () => viewport.invalidate());
		doc.on('selectionChanged',   () => viewport.invalidate());
		doc.on('selectionModified',  () => viewport.invalidate());
	}

	_draw(ctx) {
		const sel = this.doc.selection;
		if (!sel || !sel.rect) return;

		const r = sel.rect;
		const z = this.viewport.zoom;
		const sx = r.x;
		const sy = r.y;
		const sw = r.w;
		const sh = r.h;

		ctx.save();

		// Dark under-stroke for contrast against bright pixels.
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
		ctx.lineWidth = 3 / z;
		ctx.setLineDash([]);
		ctx.strokeRect(sx, sy, sw, sh);

		// White dashed over-stroke.
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 1 / z;
		ctx.setLineDash([4 / z, 4 / z]);
		ctx.lineDashOffset = 0;
		ctx.strokeRect(sx, sy, sw, sh);

		ctx.setLineDash([]);
		ctx.restore();
	}
}
