import { makeEmitter } from '../lib/emitter.js';

// Two colours: primary for the left mouse button, secondary for the right.
export class Palette {
	constructor() {
		makeEmitter(this);
		this.primary   = '#000000';
		this.secondary = '#ffffff';
	}

	setPrimary(hex)   { this.primary = hex;   this.emit('change', this); return this; }
	setSecondary(hex) { this.secondary = hex; this.emit('change', this); return this; }
	swap() {
		[this.primary, this.secondary] = [this.secondary, this.primary];
		this.emit('change', this);
		return this;
	}
}