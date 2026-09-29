// Escape or Enter commits the field by blurring it. Blur triggers the
// browser's native change event when the value has been edited, which
// is what every panel's save path is already listening for.
//
// Ctrl+Z inside the field undoes the last edit natively — this handler
// deliberately doesn't add a custom revert-on-Escape, so that behaviour
// stays consistent and the browser's own undo works as expected.
export function escapeBlurs(input) {
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.preventDefault();
			input.blur();
		}
	});
}
