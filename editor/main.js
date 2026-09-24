import { EditorDocument } from './model/EditorDocument.js';
import { Palette }        from './model/Palette.js';
import { Viewport }       from './view/Viewport.js';
import { FrameList }      from './view/FrameList.js';
import { SequenceList }   from './view/SequenceList.js';
import { loadSheet }      from './io/loadSheet.js';

// --- wiring ---------------------------------------------------------------

const doc = new EditorDocument();
const palette = new Palette();

const viewport = new Viewport(document.getElementById('viewport'));
new FrameList(document.getElementById('frameList'), doc);
new SequenceList(document.getElementById('sequenceList'), doc);

const $ = id => document.getElementById(id);

// --- status bar -----------------------------------------------------------

viewport.on('hover', ({ imageX, imageY }) => {
	if (!doc.sheet) { $('coordReadout').textContent = ''; return; }
	$('coordReadout').textContent =
		`${Math.floor(imageX)}, ${Math.floor(imageY)}`;
});
viewport.on('leave', () => { $('coordReadout').textContent = ''; });

viewport.on('view', ({ zoom }) => {
	$('zoomLabel').textContent = Math.round(zoom * 100) + '%';
});

// --- document events ------------------------------------------------------

doc.on('sheetChanged', () => {
	viewport.setSource(doc.sheet.image);
	$('emptyMessage').classList.add('hidden');
	$('frameCount').textContent = doc.sheet.frameNames.length;
	$('sequenceCount').textContent = doc.sheet.sequenceNames.length;
	$('statusMessage').textContent =
		`Loaded "${doc.sheet.imageSrc ?? '(inline image)'}" — ` +
		`${doc.sheet.imageWidth}×${doc.sheet.imageHeight}px`;
});

doc.on('selectionChanged', () => {
	const f = doc.getSelectedFrame();
	const s = doc.doc?.sheet;
	const seq = doc.selectedSequence && doc.sheet
		? doc.sheet.sequences[doc.selectedSequence]
		: null;

	let html = '';
	if (doc.selectedFrame) {
		html += `frame:  ${doc.selectedFrame}\n`;
		if (f) html += `        ${f.x},${f.y}  ${f.width}×${f.height}\n`;
	}
	if (doc.selectedSequence && seq) {
		html += `seq:    ${doc.selectedSequence}\n`;
		html += `        ${seq.frames.length} frames @ ${seq.frameRate}fps`;
	}
	$('selectionInfo').textContent = html || '—';
});

// --- palette --------------------------------------------------------------

function paintSwatches() {
	$('swatchPrimary').style.background   = palette.primary;
	$('swatchSecondary').style.background = palette.secondary;
}
palette.on('change', paintSwatches);
paintSwatches();

// --- toolbar --------------------------------------------------------------

$('btnLoad').addEventListener('click', async () => {
	const path = $('sheetPath').value.trim();
	if (!path) return;
	$('statusMessage').textContent = 'Loading…';
	try {
		const sheet = await loadSheet(path);
		doc.setSheet(sheet);
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Load failed: ' + err.message;
	}
});

$('sheetPath').addEventListener('keydown', (e) => {
	if (e.key === 'Enter') $('btnLoad').click();
});

$('btnFit').addEventListener('click',    () => viewport.fit());
$('btnZoomIn').addEventListener('click', () => viewport.zoomBy(1.25));
$('btnZoomOut').addEventListener('click',() => viewport.zoomBy(1 / 1.25));