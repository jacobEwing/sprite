// Attach mouse-wheel stepping to a numeric input. One wheel notch moves
// the value by the input's own step, clamped to its min/max. Dispatches
// a synthetic 'input' event so the panel's existing handler runs — no
// duplicate plumbing needed at each call site.
//
// Works on <input type="range"> and <input type="number"> alike. Pass
// `step` in the options to override the input's own step.
export function enableWheelStep(input, { step = null } = {}) {
	input.addEventListener('wheel', (e) => {
		// Ignore pure horizontal wheel/trackpad gestures; those are
		// usually accidental, and the slider is conceptually one-
		// dimensional.
		if (e.deltaY === 0) return;

		// preventDefault requires a non-passive listener; without it the
		// browser may scroll an ancestor as well.
		e.preventDefault();

		const s = step ?? (parseFloat(input.step) || 1);
		const min = parseFloat(input.min);
		const max = parseFloat(input.max);
		const cur = parseFloat(input.value);
		if (!Number.isFinite(cur)) return;

		const dir = e.deltaY < 0 ? 1 : -1;
		let next = cur + dir * s;
		if (Number.isFinite(min)) next = Math.max(min, next);
		if (Number.isFinite(max)) next = Math.min(max, next);
		if (next === cur) return;

		input.value = next;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, { passive: false });
}
