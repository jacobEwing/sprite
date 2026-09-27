// Swap an element for an inline text input, commit on Enter, cancel on
// Escape. Used by the frame and sequence lists for double-click rename.
//
// `onCommit(newValue)` should return `true` on success and `false` on
// rejection (e.g. a name collision). Returning nothing is treated as
// success. Throwing is also treated as rejection.
//
// On rejection, cancel, or no-op, the original element is put back. On
// success, the caller is expected to re-render the surrounding view; if
// it doesn't, the input stays in place (caller bug).
export function inlineRename(element, currentValue, onCommit) {
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'list-rename-input';
	input.value = currentValue;
	input.spellcheck = false;

	let done = false;

	const cleanup = () => {
		document.removeEventListener('mousedown', onDocumentMouseDown, true);
	};

	const restore = () => {
		if (done) return;
		done = true;
		cleanup();
		if (input.parentNode) input.replaceWith(element);
	};

	const commit = () => {
		if (done) return;
		const next = input.value.trim();
		if (!next || next === currentValue) {
			restore();
			return;
		}
		done = true;
		cleanup();

		let ok = false;
		try {
			ok = onCommit(next) !== false;
		} catch (err) {
			console.warn('Rename failed:', err.message);
			ok = false;
		}
		if (!ok && input.parentNode) input.replaceWith(element);
	};

	// Fires on any click outside the input, including clicks on elements
	// that call preventDefault() on mousedown (notably the viewport
	// canvas) and so never trigger a focus-driven blur.
	const onDocumentMouseDown = (e) => {
		if (e.target !== input) commit();
	};

	input.addEventListener('blur', commit);
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			restore();
		}
	});

	// Attach after the current tick, so the dblclick that created the
	// input doesn't immediately trigger a commit via its own mousedown.
	setTimeout(() => {
		if (!done) {
			document.addEventListener('mousedown', onDocumentMouseDown, true);
		}
	}, 0);

	element.replaceWith(input);
	input.focus();
	input.select();
}
