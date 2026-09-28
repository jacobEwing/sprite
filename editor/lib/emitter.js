// Minimal event-emitter mixin. Call makeEmitter(obj) in a constructor to
// give obj .on(name, fn), .off(name, fn), and .emit(name, data).
//
// Listeners are called synchronously, in the order they were registered.
// A handler that removes itself, or adds/removes another handler, does not
// affect the current dispatch - the listener list is snapshotted before
// iteration. Newly-added handlers are not invoked until the next emit.
//
// Duplicate registrations are allowed; `off` removes only the first match.
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
		// Snapshot before iterating so a listener removing itself (or
		// another) during dispatch can't corrupt the loop.
		for (const fn of list.slice()) fn(data);
		return this;
	};

	return obj;
}
