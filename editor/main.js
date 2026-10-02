import { EditorDocument } from './model/EditorDocument.js';
import { Palette }        from './model/Palette.js';
import { PalettePanel }   from './view/PalettePanel.js';
import { Viewport }       from './view/Viewport.js';
import { FrameList }      from './view/FrameList.js';
import { SequenceList }   from './view/SequenceList.js';
import { BrushPicker }    from './view/BrushPicker.js';
import { History }        from './history/History.js';
import { ToolLayer }      from './tools/ToolLayer.js';
import { PanTool }        from './tools/PanTool.js';
import { PencilTool }     from './tools/PencilTool.js';
import { EraserTool }     from './tools/EraserTool.js';
import { LineTool }       from './tools/LineTool.js';
import { BoxTool }        from './tools/BoxTool.js';
import { EllipseTool }    from './tools/EllipseTool.js';
import { FloodFillTool }  from './tools/FloodFillTool.js';
import { ColorPickerTool } from './tools/ColorPickerTool.js';
import { Menu }           from './view/Menu.js';
import {
	loadSpriteFile, sheetFromSpriteJSON, makeEditable,
	loadImageFile,
	makeBlankSheet,
} from './io/loadSheet.js';
import { FrameInspector }    from './view/FrameInspector.js';
import { SequenceInspector } from './view/SequenceInspector.js';
import { Timeline }        from './view/Timeline.js';
import { SpritePreview }   from './view/SpritePreview.js';
import { saveSheetImage, saveSheetData, saveSheetBoth, proposeFilenames } from './io/saveSheet.js';
import { SaveDialog }                   from './view/SaveDialog.js';
import { ErrorDialog }     from './view/ErrorDialog.js';
import { ConfirmDialog }   from './view/ConfirmDialog.js';
import { applyToolIcons }  from './view/toolIcons.js';
import { SheetDialog }     from './view/SheetDialog.js';
import { CollisionOverlay }    from './view/CollisionOverlay.js';
import { CollisionInspector }  from './view/CollisionInspector.js';
import { CollisionTool }       from './tools/CollisionTool.js';
import { BackgroundPicker } from './view/BackgroundPicker.js';
import { Clipboard } from './model/Clipboard.js';
import { SelectionOverlay } from './view/SelectionOverlay.js';
import { SelectionTool }    from './tools/SelectionTool.js';
import {
	rotate90CW, rotate90CCW,
	flipVertical, flipHorizontal,
	translateWrapped,
} from './model/transforms.js';
import { NewImageDialog } from './view/NewImageDialog.js';
import { AirbrushTool }    from './tools/AirbrushTool.js';
import { ReshapeDialog } from './view/ReshapeDialog.js';
import { ToolSettingsPanel } from './view/ToolSettingsPanel.js';
import { RecolourPanel } from './view/RecolourPanel.js';
import { FilterPanel } from './view/FilterPanel.js';
import { TransformPanel } from './view/TransformPanel.js';
import { FrameTransformInspector } from './view/FrameTransformInspector.js';
import { topColors } from './paint/colorFrequency.js';

// --- wiring ---------------------------------------------------------------
const viewOptions = { grid: false, snap: false };

const history  = new History({ limit: 100 });
const doc      = new EditorDocument(history);
const palette  = new Palette();
const viewport = new Viewport(document.getElementById('viewport'));
const backgroundPicker = new BackgroundPicker(viewport);
const clipboard = new Clipboard();
const newImageDialog = new NewImageDialog();
const collisionOverlay = new CollisionOverlay(doc, viewport);
const selectionOverlay = new SelectionOverlay(doc, viewport);
const toolLayer = new ToolLayer({ viewport, document: doc, palette, history });
const reshapeDialog = new ReshapeDialog();
// Shared between the TransformPanel's "All frames" checkbox and the
// transform keyboard shortcuts, so pressing R behaves the same whether
// you're in the Modifiers tab or anywhere else.
const transformScope = { applyToAll: false };

new SequenceList(document.getElementById('sequenceList'), doc);
new FrameInspector(document.getElementById('frameInspector'), doc);
new SequenceInspector(document.getElementById('sequenceInspector'), doc);
new CollisionInspector(document.getElementById('collisionInspector'), doc);
new Timeline(document.getElementById('timeline'), doc, viewport);
new SpritePreview(document.getElementById('spritePreview'), doc);
const brushPicker = new BrushPicker(document.getElementById('brushPicker'));
const toolSettingsPanel = new ToolSettingsPanel(
	document.getElementById('toolSettings'),
	document.getElementById('toolOptionsHeader'),
	document.getElementById('toolTips'),
);
new FrameTransformInspector(document.getElementById('frameTransformInspector'), doc);
new FrameList(document.getElementById('frameList'), doc, {
	onDeleteRequest: (names) => confirmAndDeleteFrames(names),
});
const TOOLS = {
	pan:       new PanTool(toolLayer.context),
	select:    new SelectionTool(toolLayer.context),
	pencil:    new PencilTool(toolLayer.context),
	eraser:    new EraserTool(toolLayer.context),
	line:      new LineTool(toolLayer.context),
	box:       new BoxTool(toolLayer.context),
	ellipse:   new EllipseTool(toolLayer.context),
	fill:      new FloodFillTool(toolLayer.context),
	picker:    new ColorPickerTool(toolLayer.context),
	collision: new CollisionTool(toolLayer.context),
	airbrush:  new AirbrushTool(toolLayer.context),
};

toolLayer.setCollisionOverlay(collisionOverlay);
toolLayer.setPanTool(TOOLS.pan);
toolLayer.setDefaultTool(TOOLS.pan);
toolLayer.setActiveTool(TOOLS.pan);

// The collision overlay is shown when the collision tool is active, or
// when the tool's own "always show" setting is on.
function updateCollisionOverlay() {
	const collisionActive = toolLayer.activeTool === TOOLS.collision;
	const show = collisionActive || TOOLS.collision.showOverlay;
	collisionOverlay.setEnabled(show);
}

TOOLS.collision.onSettingChanged = updateCollisionOverlay;

brushPicker.on('change', ({ brush }) => toolLayer.setBrush(brush));
brushPicker.select('pixel');

const $ = id => document.getElementById(id);

// --- viewport → status bar ------------------------------------------------

viewport.on('hover', ({ imageX, imageY }) => {
	if (!doc.sheet) { $('coordReadout').textContent = ''; return; }
	$('coordReadout').textContent = `${Math.floor(imageX)}, ${Math.floor(imageY)}`;
});
viewport.on('leave', () => { $('coordReadout').textContent = ''; });
viewport.on('view', ({ zoom }) => {
	$('zoomLabel').textContent = Math.round(zoom * 100) + '%';
});
viewport.on('frameHover', ({ frameName }) => {
	if (!doc.sheet) return;
	$('statusMessage').textContent = frameName
		? `frame: ${frameName}`
		: `${doc.sheet.imageWidth}×${doc.sheet.imageHeight}px · ${doc.sheet.frameNames.length} frames`;
});

// --- tool switching -------------------------------------------------------
// Tools that use the Fill shape option.
const SHAPE_TOOLS = new Set(['box', 'ellipse']);


const toolButtons = document.querySelectorAll('.tool-btn');

function activateTool(name) {
	const tool = TOOLS[name];
	if (!tool) return;
	toolLayer.setActiveTool(tool);
	for (const btn of toolButtons) {
		btn.classList.toggle('selected', btn.dataset.tool === name);
	}
	viewport.canvas.style.cursor = name === 'pan' ? 'grab' : 'crosshair';

	const fillShapeOption = document.getElementById('fillShapesOption');

	if (fillShapeOption) {
		fillShapeOption.hidden = !SHAPE_TOOLS.has(name);
	}

	toolSettingsPanel.showFor(tool);
	updateCollisionOverlay();
}

for (const btn of toolButtons) {
	btn.addEventListener('click', () => activateTool(btn.dataset.tool));
}
activateTool('pan');

// Keyboard shortcuts: single letter per tool, ignored while typing in a field.
const TOOL_KEYS = {
	a: 'airbrush', s: 'select',
	p: 'pan', n: 'pencil', e: 'eraser', l: 'line', b: 'box',
	o: 'ellipse', g: 'fill', i: 'picker', k: 'collision',
};

// --- shape-fill toggle ----------------------------------------------------

$('fillShapes').addEventListener('change', (e) => {
	toolLayer.setFillShapes(e.target.checked);
});

$('clipToFrame').addEventListener('change', (e) => {
	toolLayer.setClipToFrame(e.target.checked);
});

// --- document events ------------------------------------------------------
// Set when a sprite is loaded whose JSON names an image different from the
// one currently loaded. Cleared on image load, new sprite, new image, or
// when Sheet Settings brings imageSrc in line. Purely UI state.
let imageMismatch = null;  // { expected, loaded } or nulla

// Update the footer's image notice. Handles two cases, in priority order:
//   1. No image loaded - sprite references a filename we haven't got.
//   2. Sprite and image filenames disagree.
// Both offer a "Load…" link that opens the image picker.
function updateImageNotice() {
	const notice = $('imageNotice');

	if (!doc.sheet) {
		notice.hidden = true;
		notice.innerHTML = '';
		return;
	}

	if (!doc.hasImage) {
		const imgSrc = doc.sheet.imageSrc || '(unnamed)';
		notice.innerHTML =
			`No image loaded - sprite uses <code>${imgSrc}</code>.` +
			` <a href="#" id="imageNoticeLoad">Load…</a>`;
		notice.hidden = false;
		_wireImageNoticeLink();
		return;
	}

	if (imageMismatch) {
		notice.innerHTML =
			`Sprite expects <code>${imageMismatch.expected}</code>, ` +
			`loaded <code>${imageMismatch.loaded}</code>.` +
			` <a href="#" id="imageNoticeLoad">Load…</a>`;
		notice.hidden = false;
		_wireImageNoticeLink();
		return;
	}

	notice.hidden = true;
	notice.innerHTML = '';
}

function _wireImageNoticeLink() {
	const link = $('imageNoticeLoad');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			doLoadImage();
		});
	}
}

function updateListActionState() {
	// Keep the counts current. Adding/removing frames emits 'edit', not
	// 'sheetChanged', so these can't rely on the other handler.
	$('frameCount').textContent    = doc.sheet ? doc.sheet.frameNames.length    : '';
	$('sequenceCount').textContent = doc.sheet ? doc.sheet.sequenceNames.length : '';

	const frameOrder = doc.sheet ? doc.sheet.frameNames : [];
	const seqOrder = doc.sheet ? doc.sheet.sequenceNames : [];
	const frames = doc.selectedFrameList;

	if (frames.length === 0) {
		$('btnDuplicateFrame').disabled = true;
		$('btnDeleteFrames').disabled = true;
		$('btnMoveFrameUp').disabled = true;
		$('btnMoveFrameDown').disabled = true;
	} else {
		const minIdx = Math.min(...frames.map(n => frameOrder.indexOf(n)));
		const maxIdx = Math.max(...frames.map(n => frameOrder.indexOf(n)));
		$('btnDuplicateFrame').disabled = false;
		$('btnDeleteFrames').disabled = false;
		$('btnMoveFrameUp').disabled = minIdx === 0;
		$('btnMoveFrameDown').disabled = maxIdx === frameOrder.length - 1;
	}

	const seqs = doc.selectedSequenceList;
	if (seqs.length === 0) {
		$('btnDuplicateSequences').disabled = true;
		$('btnDeleteSequences').disabled = true;
		$('btnMoveSequenceUp').disabled = true;
		$('btnMoveSequenceDown').disabled = true;
	} else {
		const minIdx = Math.min(...seqs.map(n => seqOrder.indexOf(n)));
		const maxIdx = Math.max(...seqs.map(n => seqOrder.indexOf(n)));
		$('btnDuplicateSequences').disabled = false;
		$('btnDeleteSequences').disabled = false;
		$('btnMoveSequenceUp').disabled = minIdx === 0;
		$('btnMoveSequenceDown').disabled = maxIdx === seqOrder.length - 1;
	}
}

// Arrow-key navigation between frames. Left/right moves one position in
// the frame list; up/down moves by one atlas row (the column count is
// derived from the atlas and tile dimensions). Clamped at the ends —
// no wrap. The viewport pans to follow, but only when the target isn't
// already fully visible, so short hops don't jolt the view.
function navigateByArrow(dx, dy) {
	if (!doc.sheet) return;
	const names = doc.sheet.frameNames;
	if (names.length === 0) return;

	const sheet = doc.sheet;
	let step = dx;
	if (dy !== 0) {
		const cols = Math.max(1, Math.floor(sheet.imageWidth / (sheet.frameWidth || 1)));
		step = dy * cols;
	}

	const current = doc.selectedFrame;
	let idx = names.indexOf(current);
	if (idx === -1) idx = 0;
	else idx += step;
	if (idx < 0) idx = 0;
	if (idx >= names.length) idx = names.length - 1;

	const target = names[idx];
	if (target === current) return;
	doc.selectFrame(target);
	viewport.scrollFrameIntoView(target);
}

doc.on('sheetChanged',     updateListActionState);
doc.on('selectionChanged', updateListActionState);
doc.on('edit',             updateListActionState);
doc.on('sheetChanged', () => {
	viewport.setFrames(doc.sheet ? doc.sheet.frames : null);
	viewport.setSource(doc.sheet ? doc.sheet.image : null);

	updateFileMenuState();
	updateImageNotice();

	const emptyMsg = $('emptyMessage');

	if (!doc.sheet) {
		emptyMsg.textContent = 'Load a sprite or image to begin.';
		emptyMsg.classList.remove('hidden');
		$('frameCount').textContent = '';
		$('sequenceCount').textContent = '';
		$('statusMessage').textContent = 'Ready.';
	} else {
		emptyMsg.classList.add('hidden');
		$('frameCount').textContent = doc.sheet.frameNames.length;
		$('sequenceCount').textContent = doc.sheet.sequenceNames.length;
		$('statusMessage').textContent =
			`${doc.sheet.imageWidth}×${doc.sheet.imageHeight}px · ` +
			`${doc.sheet.frameNames.length} frames`;
	}

	if (doc.selectedFrame) viewport.focusFrame(doc.selectedFrame);
});

doc.on('imageChanged', () => {
	if (doc.sheet) {
		viewport.setSource(doc.sheet.image);
		viewport.setFrames(doc.sheet.frames);
	}
	updateImageNotice();
});

doc.on('selectionChanged', ({ focus }) => {
	viewport.setSelectedFrame(doc.selectedFrame);
	viewport.setSelectedFrames(doc.selectedFrames);
	if (focus && doc.selectedFrame) {
		viewport.focusFrame(doc.selectedFrame);
	}
});

doc.on('edit', () => {
	// Canvas resize replaces the sheet image; the viewport caches a
	// reference to it, so detect the change and re-source it.
	if (doc.sheet && viewport.source !== doc.sheet.image) {
		viewport.setSource(doc.sheet.image);
		viewport.setFrames(doc.sheet.frames);
		viewport.setGridStep(doc.sheet.frameWidth, doc.sheet.frameHeight);
	}
	viewport.invalidate();
});

doc.on('dirtyChanged', ({ anyDirty, dirtyImage, dirtyData }) => {
	updateFileMenuState();
	const el = $('dirtyIndicator');
	el.hidden = !anyDirty;
	if (!anyDirty) return;
	const parts = [];
	if (dirtyImage) parts.push('image');
	if (dirtyData)  parts.push('data');
	el.title = 'Unsaved: ' + parts.join(', ');
});

// Primary / secondary and the recents list are user preferences: the palette
// deliberately survives sheet changes so a colour picked on one sprite is
// still available when the next one loads.

// --- history --------------------------------------------------------------

history.on('change', ({ canUndo, canRedo }) => {
	$('btnUndo').disabled = !canUndo;
	$('btnRedo').disabled = !canRedo;
});

$('btnUndo').addEventListener('click', () => {
	if (history.undo()) viewport.invalidate();
});
$('btnRedo').addEventListener('click', () => {
	if (history.redo()) viewport.invalidate();
});

// --- palette --------------------------------------------------------------

new PalettePanel(document.getElementById('palettePanel'), palette);

// Seed the recents list from the loaded image's most-used colours. Runs
// on every sheet or image load; user picks stay at the top of the list
// and auto-populated entries fill in below, refreshed each load.
function seedPaletteFromImage() {
	const image = doc.sheet && doc.sheet.image;
	if (!image || typeof image.getContext !== 'function') return;
	palette.seedRecents(topColors(image, 16));
}

doc.on('sheetChanged', () => {
	if (doc.sheet) seedPaletteFromImage();
});
doc.on('imageChanged', () => seedPaletteFromImage());

// --- modifiers tab -------------------------------------------------------

const filterPanel = new FilterPanel(
	document.getElementById('modifierFilter'), doc, viewport);

const recolourPanel = new RecolourPanel(
	document.getElementById('modifierRecolour'), doc, viewport, palette);

const transformPanel = new TransformPanel(
	document.getElementById('modifierTransform'), doc, viewport, {
		onTransform: (label, fn) => _transformOp(label, fn),
		scope: transformScope,
	});

const modifierPanels = {
	filter:    filterPanel,
	recolour:  recolourPanel,
	transform: transformPanel,
};

let currentModifier = 'filter';

function activateModifier(name) {
	if (!modifierPanels[name]) return;
	currentModifier = name;
	for (const [key, panel] of Object.entries(modifierPanels)) {
		if (key === name) panel.activate();
		else              panel.deactivate();
	}
	document.querySelectorAll('.modifier-tabs .sub-tab').forEach(btn => {
		btn.classList.toggle('selected', btn.dataset.modifier === name);
	});
	document.querySelectorAll('[data-modifier-panel]').forEach(p => {
		p.classList.toggle('hidden', p.dataset.modifierPanel !== name);
	});
}

document.querySelectorAll('.modifier-tabs .sub-tab').forEach(btn => {
	btn.addEventListener('click', () => activateModifier(btn.dataset.modifier));
});

// Initialize the modifier tabs in the hidden state; the sidebar-tab
// handler activates the current one when the Modifiers tab is shown.
document.querySelectorAll('[data-modifier-panel]').forEach(p => {
	p.classList.toggle('hidden', p.dataset.modifierPanel !== currentModifier);
});

// Delete the given frames, first warning if any are referenced by
// sequences. The warning names the sequences so the user can back out.
async function confirmAndDeleteFrames(names) {
	if (!names || names.length === 0) return;

	const refs = doc.editable.framesReferencedBySequences(names);
	const refNames = Object.keys(refs);

	if (refNames.length > 0) {
		const totalSequences = refNames.reduce((sum, n) => sum + refs[n].length, 0);
		const frameWord = refNames.length === 1 ? 'frame' : 'frames';
		const seqWord   = totalSequences === 1 ? 'sequence' : 'sequences';
		const verb      = refNames.length === 1 ? 'is' : 'are';
		const ok = await confirmDialog.open({
			title: 'Delete frames?',
			message:
				`${refNames.length} ${frameWord} ${verb} used in ` +
				`${totalSequences} ${seqWord}.\n\n` +
				`Deleting will also remove them from those sequences.`,
			confirmLabel: 'Delete',
		});
		if (!ok) return;
	}

	doc.editable.removeFrames(names);
}

// --- list actions --------------------------------------------------------

$('btnNewFrame').addEventListener('click', () => {
	if (!doc.editable) return;
	try {
		const name = doc.editable.createFrame();
		doc.selectFrame(name, { focus: true });
	} catch (err) {
		console.warn(err.message);
	}
});

$('btnDuplicateFrame').addEventListener('click', () => {
	if (!doc.editable) return;
	try {
		const names = doc.selectedFrameList;
		const created = doc.editable.duplicateFrames(names);
		if (created.length > 0) {
			doc.selectFrame(created[0], { focus: true });
		}
	} catch (err) {
		console.warn(err.message);
	}
});

$('btnDeleteFrames').addEventListener('click', () => {
	if (!doc.editable) return;
	confirmAndDeleteFrames(doc.selectedFrameList);
});

$('btnMoveFrameUp').addEventListener('click', () => {
	if (!doc.editable) return;
	doc.editable.moveFrames(doc.selectedFrameList, -1);
});

$('btnMoveFrameDown').addEventListener('click', () => {
	if (!doc.editable) return;
	doc.editable.moveFrames(doc.selectedFrameList, +1);
});

$('btnNewSequence').addEventListener('click', () => {
	if (!doc.editable) return;
	const frames = doc.selectedFrameList;
	const base = frames.length > 0 ? `seq_${frames[0]}` : 'new_sequence';
	const name = doc.editable.uniqueSequenceName(base);
	doc.editable.addSequence(name, { frames });
	doc.selectSequence(name);
});

$('btnDeleteSequences').addEventListener('click', () => {
	if (!doc.editable) return;
	doc.editable.removeSequences(doc.selectedSequenceList);
});

$('btnDuplicateSequences').addEventListener('click', () => {
	if (!doc.editable) return;
	const created = doc.editable.duplicateSequences(doc.selectedSequenceList);
	if (created.length > 0) {
		doc.selectSequence(created[0]);
	}
});

$('btnMoveSequenceUp').addEventListener('click', () => {
	if (!doc.editable) return;
	doc.editable.moveSequences(doc.selectedSequenceList, -1);
});

$('btnMoveSequenceDown').addEventListener('click', () => {
	if (!doc.editable) return;
	doc.editable.moveSequences(doc.selectedSequenceList, +1);
});

// --- file operations -----------------------------------------------------

const errorDialog = new ErrorDialog();
const saveDialog = new SaveDialog();
const sheetDialog = new SheetDialog();
const confirmDialog = new ConfirmDialog();

// Cached between saves within a session. Lost on reload - that's fine.
let savedFilenames = null;
let savedDirectory = null;
let saveMode = null;  // 'directory' | 'download' | null

// Guard for actions that will discard unsaved work. `kind` says which
// half of the dirty state the operation will actually lose:
//   'data'  - the sheet's frames/sequences/settings are being replaced
//   'image' - the pixel atlas is being replaced
//   'any'   - both (default; matches the old behaviour)
//
// Sprite loading keeps the current image, so it only cares about data.
// Image loading keeps the sheet's structure, so it only cares about the
// image.
async function confirmDiscard(what, kind = 'any') {
	const dirty = kind === 'data'  ? doc.dirtyData
	            : kind === 'image' ? doc.dirtyImage
	            :                    doc.anyDirty;
	if (!dirty) return true;
	return await confirmDialog.open({
		title: 'Unsaved changes',
		message: `You have unsaved changes. ${what}?`,
		confirmLabel: 'Discard',
	});
}

async function doLoadSprite() {
	if (!await confirmDiscard('Discard them and load a sprite', 'data')) return;

	$('statusMessage').textContent = 'Choose a sprite JSON…';
	let file;
	try {
		file = await loadSpriteFile();
	} catch (err) {
		$('statusMessage').textContent = 'Load failed.';
		await errorDialog.show('Couldn\'t load sprite', err.message);
		return;
	}
	if (!file) { $('statusMessage').textContent = 'Cancelled.'; return; }

	$('statusMessage').textContent = 'Building sprite…';
	try {
		const keepImage = doc.hasImage;
		// Capture the currently-loaded image's name before setSheet
		// overwrites it. Also capture the JSON's expectation.
		const previousImageSrc = doc.imageSrc;
		const spriteExpects = file.imageFilename;

		const sheet = await sheetFromSpriteJSON(file.json, null);
		makeEditable(sheet);
		// The sheet's imageSrc is what the JSON declares as its image
		// filename. Fall back to the loaded image's name only when the
		// JSON didn't declare one.
		sheet.imageSrc = file.imageFilename || previousImageSrc || null;

		// Set the mismatch before setSheet so the sheetChanged handler
		// picks it up when it calls updateImageNotice.
		imageMismatch = (keepImage && spriteExpects && previousImageSrc &&
		                 spriteExpects !== previousImageSrc)
			? { expected: spriteExpects, loaded: previousImageSrc }
			: null;

		doc.setSheet(sheet, { keepImage, imageLoaded: keepImage });
		savedFilenames = {
			jsonFilename: file.jsonFilename,
			imageFilename: file.imageFilename || savedFilenames?.imageFilename || 'sheet.png',
		};
		savedDirectory = null;
		saveMode = null;
		$('statusMessage').textContent = keepImage
			? `Loaded ${file.jsonFilename} (kept current image)`
			: `Loaded ${file.jsonFilename}`;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Load failed.';
		await errorDialog.show('Couldn\'t load sprite', err.message);
	}
}

async function doLoadImage() {
	if (!await confirmDiscard('Discard them and load an image', 'image')) return;

	$('statusMessage').textContent = 'Choose an image…';
	let file;
	try {
		file = await loadImageFile();
	} catch (err) {
		$('statusMessage').textContent = 'Load failed.';
		await errorDialog.show('Couldn\'t load image', err.message);
		return;
	}
	if (!file) { $('statusMessage').textContent = 'Cancelled.'; return; }

	await doc.setImage(file.canvas, file.imageFilename);
	savedFilenames = savedFilenames || {};
	savedFilenames.imageFilename = file.imageFilename;
	imageMismatch = null;
	updateImageNotice();
	$('statusMessage').textContent =
		`Loaded image ${file.imageFilename} - sprite filename updated to match.`;
}

async function doNewSprite() {
	if (!await confirmDiscard('Discard them and create a new sheet', 'data')) return;

	// If an image is loaded, keep it and prefill the dialog with its
	// dimensions. Otherwise fall back to the standard defaults.
	const existingImage = doc.hasImage ? doc.sheet.image : null;
	const existingSrc   = doc.hasImage ? doc.sheet.imageSrc : null;
	const defaults = existingImage
		? { imageWidth: doc.sheet.imageWidth, imageHeight: doc.sheet.imageHeight }
		: {};

	const values = await sheetDialog.openForNew(defaults);
	if (!values) return;

	try {
		const sheet = await makeBlankSheet({
			imageWidth: values.imageWidth,
			imageHeight: values.imageHeight,
			frameWidth: values.frameWidth,
			frameHeight: values.frameHeight,
			centerx: values.centerx,
			centery: values.centery,
			defaultFrameRate: values.defaultFrameRate,
			cellCount: values.cellCount,
			existingImage,
		});
		// Carry the filename through when we're reusing the image, so
		// a subsequent Save writes to the same PNG.
		if (existingImage) sheet.imageSrc = existingSrc;

		doc.setSheet(sheet, { imageLoaded: true });

		if (!existingImage) savedFilenames = null;
		savedDirectory = null;
		saveMode = null;

		$('statusMessage').textContent =
			`New sheet: ${sheet.imageWidth}×${sheet.imageHeight}`;
	} catch (err) {
		console.error(err);
		await errorDialog.show('Couldn\'t create the sheet', err.message);
	}
}

async function doNewImage() {
	if (!await confirmDiscard('Discard them and create a new image', 'image')) return;


	const defaults = {
		width:  doc.sheet ? doc.sheet.imageWidth  : 256,
		height: doc.sheet ? doc.sheet.imageHeight : 256,
	};
	const values = await newImageDialog.open(defaults);
	if (!values) return;

	const canvas = document.createElement('canvas');
	canvas.width  = values.width;
	canvas.height = values.height;
	// Force the CPU-backed store so later getImageData calls hit the fast
	// path; StrokeTransaction and the filters both depend on this.
	canvas.getContext('2d', { willReadFrequently: true });

	await doc.setImage(canvas, null);
	imageMismatch = null;
	updateImageNotice();

	$('statusMessage').textContent = `New image: ${values.width}×${values.height}`;
}

async function doEditSheet() {
	if (!doc.sheet) return;
	const values = await sheetDialog.openForEdit(doc.sheet);
	if (!values) return;

	doc.editable.setSheetSettings({
		frameWidth: values.frameWidth,
		frameHeight: values.frameHeight,
		centerx: values.centerx,
		centery: values.centery,
		defaultFrameRate: values.defaultFrameRate,
		imageSrc: values.imageSrc,
		imageWidth: values.imageWidth,
		imageHeight: values.imageHeight,
	});
	// If the user brought the sheet's imageSrc in line with what's actually
	// loaded, the mismatch is resolved.
	if (imageMismatch && doc.sheet.imageSrc === imageMismatch.loaded) {
		imageMismatch = null;
		updateImageNotice();
	}
	$('statusMessage').textContent = 'Sheet settings updated.';
}

async function doReshape() {
	if (!doc.sheet || !doc.editable) return;
	if (doc.sheet.frameNames.length === 0) {
		$('statusMessage').textContent = 'No frames to reshape.';
		return;
	}
	const values = await reshapeDialog.open(doc.sheet);
	if (!values) return;

	doc.editable.reshapeToGrid(values.cols);
	doc.clearSelection();
	$('statusMessage').textContent =
		`Reshaped to ${values.cols} column${values.cols === 1 ? '' : 's'}`;
}

async function _ensureFilenames({ force = false } = {}) {
	if (savedFilenames && !force) return savedFilenames;
	const defaults = proposeFilenames(doc.sheet);
	const names = await saveDialog.open(defaults);
	if (!names) return null;
	savedFilenames = names;
	return names;
}

async function _doSaveImage({ forcePrompt = false } = {}) {
	if (!doc.sheet) return false;

	const names = await _ensureFilenames({ force: forcePrompt });
	if (!names) return false;

	$('statusMessage').textContent = 'Saving image…';
	try {
		const result = await saveSheetImage({
			sheet: doc.sheet,
			imageFilename: names.imageFilename,
			directoryHandle: savedDirectory,
			forceDownload: saveMode === 'download',
		});
		savedDirectory = result.directoryHandle;
		saveMode = result.mode;
		doc.markSaved('image');
		doc.sheet.imageSrc = names.imageFilename;
		$('statusMessage').textContent = result.mode === 'directory'
			? `Saved ${names.imageFilename}`
			: `Downloaded ${names.imageFilename}`;
		return true;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Save failed: ' + err.message;
		return false;
	}
}

async function _doSaveData({ forcePrompt = false } = {}) {
	if (!doc.sheet) return false;

	const names = await _ensureFilenames({ force: forcePrompt });
	if (!names) return false;

	$('statusMessage').textContent = 'Saving data…';
	try {
		const result = await saveSheetData({
			sheet: doc.sheet,
			jsonFilename: names.jsonFilename,
			imageFilename: names.imageFilename,
			directoryHandle: savedDirectory,
			forceDownload: saveMode === 'download',
		});
		savedDirectory = result.directoryHandle;
		saveMode = result.mode;
		doc.markSaved('data');
		doc.sheet.imageSrc = names.imageFilename;
		$('statusMessage').textContent = result.mode === 'directory'
			? `Saved ${names.jsonFilename}`
			: `Downloaded ${names.jsonFilename}`;
		return true;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Save failed: ' + err.message;
		return false;
	}
}

// Write whichever side is dirty, both if both. Never prompts for filenames
// if they're already known.
async function doSave() {
	if (!doc.sheet) return;
	const needImage = doc.dirtyImage;
	const needData  = doc.dirtyData;
	if (!needImage && !needData) {
		$('statusMessage').textContent = 'Nothing to save.';
		return;
	}
	if (needImage) await _doSaveImage();
	if (needData)  await _doSaveData();
}

// Menu actions. Save-As variants always prompt for filenames first.
const doSaveImage    = () => _doSaveImage();
const doSaveData     = () => _doSaveData();

// --- edit operations -----------------------------------------------------

function doCopyFrame() {
	if (!doc.sheet || !doc.selectedFrame) return;
	const rect = doc.currentOpRect();
	if (!rect) return;
	clipboard.captureFrom(doc.sheet, rect, doc.selectedFrame);
	const where = doc.selection.isEmpty ? `"${doc.selectedFrame}"` : 'selection';
	$('statusMessage').textContent =
		`Copied ${where} (${rect.w}×${rect.h})`;
}

function doCutFrame() {
	if (!doc.sheet || !doc.selectedFrame) return;
	doCopyFrame();
	const rect = doc.currentOpRect();
	if (!rect) return;
	doc.editable.clearRegion(rect);
}

function doPasteIntoFrame() {
	if (!doc.sheet || !doc.selectedFrame || clipboard.isEmpty) return;
	const rect = doc.currentOpRect();
	if (!rect) return;
	const align = doc.selection.isEmpty ? 'center' : 'topleft';
	doc.editable.pasteIntoRegion(rect, clipboard.imageData, { align });
}

function doClearFrame() {
	if (!doc.sheet || !doc.selectedFrame) return;
	const rect = doc.currentOpRect();
	if (!rect) return;
	doc.editable.clearRegion(rect);
}

// --- transforms ----------------------------------------------------------
//
// All operate on the current op rect: the selection if any, else the
// whole frame.

function _transformOp(label, fn) {
	if (!doc.sheet) return;
	const entries = doc.opRectsFor({ allFrames: transformScope.applyToAll });
	if (entries.length === 0) return;
	const affected = doc.editable.transformRegions(entries, fn);
	if (affected === 0) return;
	const where = transformScope.applyToAll
		? `all ${affected} frame${affected === 1 ? '' : 's'}`
		: (doc.selection.isEmpty ? 'frame' : 'selection');
	$('statusMessage').textContent = `${label} ${where}`;
}

const doRotateCW   = () => _transformOp('Rotated CW',       rotate90CW);
const doRotateCCW  = () => _transformOp('Rotated CCW',      rotate90CCW);
const doFlipV      = () => _transformOp('Flipped vertical', flipVertical);
const doFlipH      = () => _transformOp('Flipped horizontal', flipHorizontal);

const doMoveUp    = () => _transformOp('Moved up',    (d) => translateWrapped(d,  0, -1));
const doMoveDown  = () => _transformOp('Moved down',  (d) => translateWrapped(d,  0,  1));
const doMoveLeft  = () => _transformOp('Moved left',  (d) => translateWrapped(d, -1,  0));
const doMoveRight = () => _transformOp('Moved right', (d) => translateWrapped(d,  1,  0));

// --- menus ----------------------------------------------------------------

const fileMenu = new Menu(document.getElementById('fileMenuBtn'), [
	{ label: 'New Sprite',   action: doNewSprite },
	{ label: 'New Image',    action: doNewImage },
	{ separator: true },
	{ label: 'Save Image',         shortcut: 'Ctrl+S',       action: doSaveImage },
	{ label: 'Save Sprite Data',   shortcut: 'Ctrl+Shift+S', action: doSaveData },
	{ label: 'Save All',           shortcut: 'Ctrl+Alt+S',   action: doSave },
	{ separator: true },
	{ label: 'Load Sprite…', action: doLoadSprite },
	{ label: 'Load Image…',  action: doLoadImage },
]);

function updateFileMenuState() {
	const hasSheet = doc.hasSheet;
	const setEnabled = (label, on) => {
		const item = fileMenu.items.find(i => i.label === label);
		if (item) item.disabled = !on;
	};
	// Save Image is available whenever there's a sheet, because a sheet
	// always has an image (the placeholder counts once you've painted into
	// it). Save Sprite Data needs actual sprite data - the same rule the
	// load side already uses.
	setEnabled('Save Image',          hasSheet);
	setEnabled('Save Sprite Data',    hasSheet);
	setEnabled('Save All',            hasSheet);
}

updateFileMenuState();

new Menu(document.getElementById('sheetMenuBtn'), [
	{ label: 'Sheet settings…', action: doEditSheet },
	{ label: 'Reshape…',        action: doReshape },
	{ separator: true },
]);

new Menu(document.getElementById('viewMenuBtn'), [
	{
		label: 'Background…',
		action: () => {
			backgroundPicker.toggle(document.getElementById('viewMenuBtn'));
		},
	},
	{ separator: true },
	{
		label: 'Show grid',
		checked: false,
		action: () => {
			viewOptions.grid = !viewOptions.grid;
			viewport.setShowGrid(viewOptions.grid);
		},
	},
	{
		label: 'Snap to grid',
		checked: false,
		action: () => {
			viewOptions.snap = !viewOptions.snap;
			toolLayer.setSnapToGrid(viewOptions.snap);
		},
	},
], {
	onShow: (items) => {
		items.find(i => i.label === 'Show grid').checked    = viewOptions.grid;
		items.find(i => i.label === 'Snap to grid').checked = viewOptions.snap;
	},
});

new Menu(document.getElementById('editMenuBtn'), [
	{ label: 'Copy',  shortcut: 'Ctrl+C', action: doCopyFrame },
	{ label: 'Cut',   shortcut: 'Ctrl+X', action: doCutFrame },
	{ label: 'Paste', shortcut: 'Ctrl+V', action: doPasteIntoFrame },
	{ label: 'Clear', shortcut: 'Del',    action: doClearFrame },
], {
	onShow: (items) => {
		const hasFrame = !!(doc.sheet && doc.selectedFrame);
		const hasClip  = !clipboard.isEmpty;
		items.find(i => i.label === 'Copy').disabled  = !hasFrame;
		items.find(i => i.label === 'Cut').disabled   = !hasFrame;
		items.find(i => i.label === 'Paste').disabled = !hasFrame || !hasClip;
		items.find(i => i.label === 'Clear').disabled = !hasFrame;
	},
});

new Menu(document.getElementById('transformMenuBtn'), [
	{ label: 'Rotate 90° CW',   shortcut: 'R',       action: doRotateCW },
	{ label: 'Rotate 90° CCW',  shortcut: 'Shift+R', action: doRotateCCW },
	{
		label: 'Rotate…',
		action: () => {
			const anchor = document.getElementById('transformMenuBtn');
			rotatePanel.show(anchor);
		},
	},
	{ separator: true },
	{ label: 'Flip Vertical',   shortcut: 'F',       action: doFlipV },
	{ label: 'Flip Horizontal', shortcut: 'Shift+F', action: doFlipH },
	{ separator: true },
	{ label: 'Move Up',    shortcut: 'Ctrl+↑', action: doMoveUp },
	{ label: 'Move Down',  shortcut: 'Ctrl+↓', action: doMoveDown },
	{ label: 'Move Left',  shortcut: 'Ctrl+←', action: doMoveLeft },
	{ label: 'Move Right', shortcut: 'Ctrl+→', action: doMoveRight },
], {
	onShow: (items) => {
		const enabled = !!(doc.sheet && doc.selectedFrame);
		for (const i of items) if (!i.separator) i.disabled = !enabled;
	},
});

// --- keyboard events -----------------------------------------------------

window.addEventListener('keydown', (e) => {
	const tag = (e.target.tagName || '').toLowerCase();
	const inField = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
	const mod = e.ctrlKey || e.metaKey;
	const key = e.key.toLowerCase();

	if (mod) {
		// Ctrl+Alt+letter is used where Ctrl+letter is hijacked by the
		// browser (new tab / new window / etc.).
		if (key === 'n' && e.altKey) {
			e.preventDefault();
			doNewSprite();
			return;
		}
		if (key === 's') {
			e.preventDefault();
			if (e.altKey)        doSave();       // Ctrl+Alt+S  - save dirty halves
			else if (e.shiftKey) doSaveData();   // Ctrl+Shift+S - save sprite data
			else                 doSaveImage();  // Ctrl+S      - save image
			return;
		}
		if (e.altKey) return;

		if (!inField) {
			if (key === 'arrowup')    { e.preventDefault(); doMoveUp();    return; }
			if (key === 'arrowdown')  { e.preventDefault(); doMoveDown();  return; }
			if (key === 'arrowleft')  { e.preventDefault(); doMoveLeft();  return; }
			if (key === 'arrowright') { e.preventDefault(); doMoveRight(); return; }

			if (key === 'z' && !e.shiftKey) {
				e.preventDefault();
				if (history.undo()) viewport.invalidate();
				return;
			}
			if ((key === 'z' && e.shiftKey) || key === 'y') {
				e.preventDefault();
				if (history.redo()) viewport.invalidate();
				return;
			}
		}
		return;
	}

	if (inField) return;
	if (e.altKey) return;

	if (key === 'arrowleft')  { e.preventDefault(); navigateByArrow(-1, 0); return; }
	if (key === 'arrowright') { e.preventDefault(); navigateByArrow( 1, 0); return; }
	if (key === 'arrowup')    { e.preventDefault(); navigateByArrow( 0, -1); return; }
	if (key === 'arrowdown')  { e.preventDefault(); navigateByArrow( 0,  1); return; }

	if (key === 'delete') {
		e.preventDefault();
		doClearFrame();
		return;
	}
	if (key === 'r') {
		e.preventDefault();
		if (e.shiftKey) doRotateCCW();
		else            doRotateCW();
		return;
	}
	if (key === 'f') {
		e.preventDefault();
		if (e.shiftKey) doFlipH();
		else            doFlipV();
		return;
	}
	if (key === 'x') {
		e.preventDefault();
		palette.swap();
		return;
	}
	const name = TOOL_KEYS[key];
	if (name) {
		e.preventDefault();
		activateTool(name);
	}
});

// --- Ctrl-to-sample ------------------------------------------------------
//
// Holding Ctrl (or Cmd) temporarily turns the active tool into an
// eyedropper. Releasing the key returns to whatever was active.

window.addEventListener('keydown', (e) => {
	if (e.key === 'Control' || e.key === 'Meta') {
		toolLayer.setTempSample(true);
		viewport.canvas.classList.add('sampling');
	}
});
window.addEventListener('keyup', (e) => {
	if (e.key === 'Control' || e.key === 'Meta') {
		toolLayer.setTempSample(false);
		viewport.canvas.classList.remove('sampling');
	}
});
// If the tab loses focus while Ctrl is held, keyup never fires; reset
// defensively on blur.
window.addEventListener('blur', () => {
	toolLayer.setTempSample(false);
	viewport.canvas.classList.remove('sampling');
});

// --- sidebar tabs --------------------------------------------------------

function setupTabs(sidebarEl, onSwitch) {
	const tabs   = sidebarEl.querySelectorAll('.sidebar-tab');
	const panels = sidebarEl.querySelectorAll('.tab-panel');

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const name = tab.dataset.tab;
			tabs.forEach((t) => t.classList.toggle('selected', t === tab));
			panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
			if (onSwitch) onSwitch(name);
		});
	});
}

setupTabs(document.getElementById('leftSidebar'));
setupTabs(document.getElementById('rightSidebar'), (name) => {
	if (name === 'modifiers') {
		activateModifier(currentModifier);
	} else {
		for (const panel of Object.values(modifierPanels)) panel.deactivate();
	}
});
// --- sub-tabs (Brush | Tool) ---------------------------------------------

function setupSubTabs(sectionId) {
	const section = document.getElementById(sectionId);
	if (!section) return;
	const tabs = section.querySelectorAll('.sub-tab');
	const panels = section.querySelectorAll('.sub-panel');
	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const name = tab.dataset.subtab;
			tabs.forEach((t) => t.classList.toggle('selected', t === tab));
			panels.forEach((p) => p.classList.toggle('hidden', p.dataset.subpanel !== name));
		});
	});
}

setupSubTabs('toolsPane');

// --- clipboard events ----------------------------------------------------
//
// Using the DOM copy/cut/paste events rather than keydown: they fire for
// the browser's own menu and right-click context menu too, and preventDefault
// here genuinely stops the browser from doing anything with the system
// clipboard. The inField check lets text inputs behave normally.

function isFormField(el) {
	if (!el) return false;
	const tag = (el.tagName || '').toLowerCase();
	return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

document.addEventListener('copy', (e) => {
	if (isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame) return;
	e.preventDefault();
	doCopyFrame();
});

document.addEventListener('cut', (e) => {
	if (isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame) return;
	e.preventDefault();
	doCutFrame();
});

document.addEventListener('paste', (e) => {
	if (isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame || clipboard.isEmpty) return;
	e.preventDefault();
	doPasteIntoFrame();
});

// --- text field focus behaviour ------------------------------------------
//
// Select the whole value when a text or number input is focused, so the
// user can immediately overwrite. Two handlers because click-focus and
// tab-focus take different paths:
//
//   • Tab focuses the input, then focusin fires. Select there.
//   • Click focuses the input, then the browser places the cursor at the
//     click point - which would cancel any selection. To prevent that, we
//     stop the mousedown's default, focus manually (which fires focusin),
//     and let the focusin handler do the select.
//
// If the input is already focused, we don't preventDefault, so a
// second click places the cursor normally inside the text.

function isTextField(el) {
	if (!el || el.tagName !== 'INPUT') return false;
	if (el.type !== 'text' && el.type !== 'number') return false;
	return !el.readOnly && !el.disabled;
}

document.addEventListener('focusin', (e) => {
	if (isTextField(e.target)) e.target.select();
});

document.addEventListener('mousedown', (e) => {
	const el = e.target;
	if (!isTextField(el)) return;
	if (document.activeElement === el) return;   // already focused - place cursor normally
	e.preventDefault();
	el.focus();                                  // fires focusin → select
});

// --- view toolbar ---------------------------------------------------------
$('btnFit').addEventListener('click',    () => viewport.fit());
$('btnZoomIn').addEventListener('click', () => viewport.zoomBy(1.25));
$('btnZoomOut').addEventListener('click',() => viewport.zoomBy(1 / 1.25));

$('btnHelp').addEventListener('click', () => {
	window.open('../docs/editor.html', '_blank', 'noopener');
});
// --- unsaved-changes warning ---------------------------------------------

window.addEventListener('beforeunload', (e) => {
	if (!doc.anyDirty) return;
	e.preventDefault();
	e.returnValue = '';
});

// --- tool icons ----------------------------------------------------------
//
// Fire-and-forget. If the sprite loads, buttons swap from text to icons.
// If it fails, or a frame is missing, the text label stays - no error,
// no broken UI.

applyToolIcons('assets/toolIcons.json');
