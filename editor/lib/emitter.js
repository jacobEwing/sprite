// Minimal event-emitter mixin. Call makeEmitter(obj) in a constructor to
// give obj .on(name, fn), .off(name, fn), and .emit(name, data).
export function makeEmitter(obj) {
	obj._listeners = Object.create(null);

	obj.on = function (name, fn) {
		(this._listeners[name] ||= []).push(fn);
		return this;
	};

	obj.off = function (name, fn) {
		const list = this._listeners[name];
		if (!list) return this;
		const i = list.indexOf(fn);
		if (i >= 0) list.splice(i, 1);
		return this;
	};

	obj.emit = function (name, data) {
		const list = this._listeners[name];
		if (!list) return this;
		for (const fn of list) fn(data);
		return this;
	};

	return obj;
}