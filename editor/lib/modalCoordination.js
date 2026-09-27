// Central coordination for modal dialogs. Opening a dialog closes any
// other currently-open one, so backdrops can't stack and leave the user
// unsure which is on top.
//
// A "dialog" here is any object with:
//   • a `close(result)` method
//   • a `backdrop` element toggled by adding/removing `.visible`
//
// Dialogs call announceOpen(this) at the top of open() and
// announceClosed(this) at the bottom of close().

const openModals = new Set();

export function announceOpen(dialog) {
	// Iterate over a copy — close() will call announceClosed, which
	// mutates the set we're walking.
	for (const other of Array.from(openModals)) {
		if (other !== dialog) other.close(null);
	}
	openModals.add(dialog);
}

export function announceClosed(dialog) {
	openModals.delete(dialog);
}
