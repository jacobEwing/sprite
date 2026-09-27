// Coordination for floating editor panels — the ones that pop up over the
// interface without a backdrop (FilterPanel, RotatePanel, BackgroundPicker).
// Unlike modal dialogs, these don't take over the whole screen, so without
// this they can end up stacked with no clear "top".
//
// Panels call announcePanelOpen(this) at the top of show() and
// announcePanelClosed(this) at the end of hide(). The helper hides any
// other open panel first.
//
// The palette's ColorPicker is deliberately not in this registry: it's a
// child popover that needs its host panel to stay open while it's up.

const openPanels = new Set();

export function announcePanelOpen(panel) {
	// Iterate over a copy — hide() will trigger announcePanelClosed, which
	// mutates the set we're walking.
	for (const other of Array.from(openPanels)) {
		if (other !== panel) other.hide();
	}
	openPanels.add(panel);
}

export function announcePanelClosed(panel) {
	openPanels.delete(panel);
}

// Called by the modal dialogs when they open, so a floating panel doesn't
// sit hidden behind a modal backdrop and then reappear when the modal
// closes — the user's attention has moved on by then.
export function closeAllPanels() {
	for (const panel of Array.from(openPanels)) panel.hide();
}
