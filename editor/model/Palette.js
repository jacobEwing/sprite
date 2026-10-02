import { makeEmitter } from '../lib/emitter.js';
import { normalizeHex } from '../paint/pixelUtils.js';

// A colour is a {hex, alpha} pair. Alpha is a first-class part of the
// colour rather than a separate slot parameter, so copies and recents
// carry it automatically.
//
// setPrimary/setSecondary accept an optional alpha. When omitted, the
// current alpha for that slot is preserved - which is what the hex input
// needs, since it only ever edits the hex part.

const DEFAULT_PRIMARY   = { hex: '#000000', alpha: 255 };
const DEFAULT_SECONDARY = { hex: '#ffffff', alpha: 255 };
const MAX_RECENT = 16;

function clampAlpha(a) {
	a = Math.round(Number(a));
	if (!Number.isFinite(a)) return 255;
	return Math.max(0, Math.min(255, a));
}

function cloneColor(c) {
	return { hex: c.hex, alpha: c.alpha };
}

function colorsEqual(a, b) {
	return a.hex === b.hex && a.alpha === b.alpha;
}

function colorKey(c) {
	return `${c.hex}|${c.alpha}`;
}

export class Palette {
	constructor() {
		makeEmitter(this);
		this.primary = cloneColor(DEFAULT_PRIMARY);
		this.secondary = cloneColor(DEFAULT_SECONDARY);
		this.recent = [];
		// Signatures of recents that were auto-seeded from an image.
		// Removed and refreshed when a new image loads; anything the user
		// has since picked is no longer in this set, so it survives.
		this._autoRecentKeys = new Set();
	}

	setPrimary(hex, alpha, { pushRecent = true } = {}) {
		hex = normalizeHex(hex);
		if (!hex) return this;
		alpha = alpha !== undefined ? clampAlpha(alpha) : this.primary.alpha;
		const next = { hex, alpha };
		const changed = !colorsEqual(this.primary, next);
		this.primary = next;
		if (pushRecent) this._pushRecent(next);
		if (changed || pushRecent) this.emit('change', this);
		return this;
	}

	setSecondary(hex, alpha, { pushRecent = true } = {}) {
		hex = normalizeHex(hex);
		if (!hex) return this;
		alpha = alpha !== undefined ? clampAlpha(alpha) : this.secondary.alpha;
		const next = { hex, alpha };
		const changed = !colorsEqual(this.secondary, next);
		this.secondary = next;
		if (pushRecent) this._pushRecent(next);
		if (changed || pushRecent) this.emit('change', this);
		return this;
	}

	swap() {
		[this.primary, this.secondary] = [this.secondary, this.primary];
		this.emit('change', this);
		return this;
	}

	reset() {
		this.primary   = cloneColor(DEFAULT_PRIMARY);
		this.secondary = cloneColor(DEFAULT_SECONDARY);
		// Recents are a user preference; leave them alone.
		this.emit('change', this);
		return this;
	}

	_pushRecent(color) {
		// A user pick is no longer "auto" - if it came from seeding, drop
		// the auto marker so it survives the next image load.
		this._autoRecentKeys.delete(colorKey(color));

		const i = this.recent.findIndex(c => colorsEqual(c, color));
		if (i >= 0) this.recent.splice(i, 1);
		this.recent.unshift(cloneColor(color));
		if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
	}

	// Merge auto-derived colours into the recents list. Existing user
	// picks stay put; previously auto-seeded entries are removed and
	// replaced with the incoming set. Called by main.js after a sheet or
	// image load. No-op if `colors` is empty, so loading a blank sheet
	// doesn't wipe the previous auto entries.
	seedRecents(colors) {
		if (!Array.isArray(colors) || colors.length === 0) return;

		// Drop any surviving auto entries. Any that the user has since
		// picked are no longer in the set, so they stay.
		this.recent = this.recent.filter(
			c => !this._autoRecentKeys.has(colorKey(c))
		);
		this._autoRecentKeys.clear();

		// Append the new auto entries below the user's picks, skipping
		// any that duplicate an existing entry.
		for (const c of colors) {
			if (this.recent.length >= MAX_RECENT) break;
			const key = colorKey(c);
			if (this._autoRecentKeys.has(key)) continue;
			if (this.recent.some(existing => colorsEqual(existing, c))) continue;
			this.recent.push(cloneColor(c));
			this._autoRecentKeys.add(key);
		}

		this.emit('change', this);
	}
}
