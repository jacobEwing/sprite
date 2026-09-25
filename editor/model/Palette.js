import { makeEmitter } from '../lib/emitter.js';
import { normalizeHex } from '../paint/pixelUtils.js';

const DEFAULT_PRIMARY   = '#000000';
const DEFAULT_SECONDARY = '#ffffff';
const MAX_RECENT = 16;

// Two colours — primary for the left mouse button, secondary for the right —
// plus a shared recent-colours list. Fires 'change' after every mutation.
//
// setPrimary / setSecondary accept { pushRecent: false } to update the
// colour without reordering the recent list. Used by the colour picker so a
// drag through fifty hues leaves one entry, not fifty.
export class Palette {
	constructor() {
		makeEmitter(this);
		this.primary   = DEFAULT_PRIMARY;
		this.secondary = DEFAULT_SECONDARY;
		this.primaryAlpha = 255;
		this.secondaryAlpha = 255;
		this.recent    = [];
	}

	setPrimary(hex, { pushRecent = true } = {}) {
		hex = normalizeHex(hex);
		if (!hex) return this;
		const changed = hex !== this.primary;
		this.primary = hex;
		if (pushRecent) this._pushRecent(hex);
		if (changed || pushRecent) this.emit('change', this);
		return this;
	}

	setSecondary(hex, { pushRecent = true } = {}) {
		hex = normalizeHex(hex);
		if (!hex) return this;
		const changed = hex !== this.secondary;
		this.secondary = hex;
		if (pushRecent) this._pushRecent(hex);
		if (changed || pushRecent) this.emit('change', this);
		return this;
	}

	setPrimaryAlpha(a) {
		a = clampAlpha(a);
		if (a === this.primaryAlpha) return this;
		this.primaryAlpha = a;
		this.emit('change', this);
		return this;
	}

	setSecondaryAlpha(a) {
		a = clampAlpha(a);
		if (a === this.secondaryAlpha) return this;
		this.secondaryAlpha = a;
		this.emit('change', this);
		return this;
	}

	swap() {
		[this.primary, this.secondary] = [this.secondary, this.primary];
		this.emit('change', this);
		return this;
	}

	reset() {
		this.primary   = DEFAULT_PRIMARY;
		this.secondary = DEFAULT_SECONDARY;
		this.primaryAlpha   = 255;
		this.secondaryAlpha = 255;
		// Recents are a user preference; leave them alone.
		this.emit('change', this);
		return this;
	}

	_pushRecent(hex) {
		const i = this.recent.indexOf(hex);
		if (i >= 0) this.recent.splice(i, 1);
		this.recent.unshift(hex);
		if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
	}

}

function clampAlpha(a) {
	a = Math.round(Number(a));
	if (!Number.isFinite(a)) return 255;
	return Math.max(0, Math.min(255, a));
}
