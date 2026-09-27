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
import { BRUSHES }        from './paint/Brush.js';
import { Menu }           from './view/Menu.js';
import {
	pickFile,
	loadSpriteFile, sheetFromSpriteJSON, makeEditable,
	loadImageFile,
	makeBlankSheet, makeSheetFromImage,
} from './io/loadSheet.js';
import { FrameInspector }    from './view/FrameInspector.js';
import { SequenceInspector } from './view/SequenceInspector.js';
import { Timeline }        from './view/Timeline.js';
import { SheetSizeDialog } from './view/SheetSizeDialog.js';
import { FrameTool }       from './tools/FrameTool.js';
import { SpritePreview }   from './view/SpritePreview.js';
import { saveSheetImage, saveSheetData, saveSheetBoth, proposeFilenames } from './io/saveSheet.js';
import { SaveDialog }                   from './view/SaveDialog.js';
import { FilterPanel }     from './view/FilterPanel.js';
import { ErrorDialog }     from './view/ErrorDialog.js';
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

// --- wiring ---------------------------------------------------------------
const viewOptions = { grid: false, snap: false };

const history  = new History({ limit: 100 });
const doc      = new EditorDocument(history);
const palette  = new Palette();
const viewport = new Viewport(document.getElementById('viewport'));
const backgroundPicker = new BackgroundPicker(viewport);
const clipboard = new Clipboard();

new FrameList(document.getElementById('frameList'), doc);
new SequenceList(document.getElementById('sequenceList'), doc);

new FrameInspector(document.getElementById('frameInspector'), doc);
new SequenceInspector(document.getElementById('sequenceInspector'), doc);
new Timeline(document.getElementById('timeline'), doc, viewport);
new SpritePreview(document.getElementById('spritePreview'), doc);

const newImageDialog = new NewImageDialog();
const brushPicker = new BrushPicker(document.getElementById('brushPicker'));

const collisionOverlay = new CollisionOverlay(doc, viewport);
const selectionOverlay = new SelectionOverlay(doc, viewport);
const toolLayer = new ToolLayer({ viewport, document: doc, palette, history });

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
	frame:     new FrameTool(toolLayer.context),
	collision: new CollisionTool(toolLayer.context),
	airbrush: new AirbrushTool(toolLayer.context),

};
toolLayer.setCollisionOverlay(collisionOverlay);
toolLayer.setPanTool(TOOLS.pan);
toolLayer.setDefaultTool(TOOLS.pan);
toolLayer.setActiveTool(TOOLS.pan);

brushPicker.on('change', ({ brush }) => toolLayer.setBrush(brush));
brushPicker.select('pixel');

const $ = id => document.getElementById(id);

const collisionInspector = new CollisionInspector(
	document.getElementById('collisionInspector'), doc);
collisionInspector.onOverlayToggle = (on) => collisionOverlay.setEnabled(on);

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

const toolButtons = document.querySelectorAll('.tool-btn');

function activateTool(name) {
	const tool = TOOLS[name];
	if (!tool) return;
	toolLayer.setActiveTool(tool);
	for (const btn of toolButtons) {
		btn.classList.toggle('selected', btn.dataset.tool === name);
	}
	viewport.canvas.style.cursor = name === 'pan' ? 'grab' : 'crosshair';

	// Collision overlay is visible whenever the collision tool is active,
	// or when the user has enabled "always show" in the Collision pane.
	const showCollision = name === 'collision' || collisionInspector.showOverlay;
	collisionOverlay.setEnabled(showCollision);
}

for (const btn of toolButtons) {
	btn.addEventListener('click', () => activateTool(btn.dataset.tool));
}
activateTool('pan');

// Keyboard shortcuts: single letter per tool, ignored while typing in a field.
const TOOL_KEYS = {
	a: 'airbrush', s: 'select',
	p: 'pan', n: 'pencil', e: 'eraser', l: 'line', b: 'box',
	o: 'ellipse', g: 'fill', i: 'picker', m: 'frame', k: 'collision',
};
// --- shape-fill toggle ----------------------------------------------------

$('fillShapes').addEventListener('change', (e) => {
	toolLayer.setFillShapes(e.target.checked);
});

$('clipToFrame').addEventListener('change', (e) => {
	toolLayer.setClipToFrame(e.target.checked);
});

// --- document events ------------------------------------------------------
// Update the footer's image notice. Called on sheet and image changes.
// Shows nothing when an image is loaded (or when no sheet is loaded —
// the canvas overlay covers that case).
function updateImageNotice() {
	const notice = $('imageNotice');
	if (!doc.sheet || doc.hasImage) {
		notice.hidden = true;
		notice.innerHTML = '';
		return;
	}
	const imgSrc = doc.sheet.imageSrc || '(unnamed)';
	notice.innerHTML =
		`No image loaded — sprite uses <code>${imgSrc}</code>.` +
		` <a href="#" id="imageNoticeLoad">Load…</a>`;
	notice.hidden = false;
	const link = $('imageNoticeLoad');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			doLoadImage();
		});
	}
}

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

doc.on('selectionChanged', ({ focus, changed }) => {
	viewport.setSelectedFrame(doc.selectedFrame);
	if (!focus || !doc.selectedFrame) return;

	// Focus rule:
	//   • Zoomed in (sheet doesn't fit) → follow the selection.
	//   • Zoomed out, re-clicked same frame → zoom in on it.
	//   • Zoomed out, picked a different frame → just select, don't move.
	if (!viewport.sheetFits || !changed) {
		viewport.focusFrame(doc.selectedFrame);
	}
});

doc.on('edit', () => {
	// Canvas expansion swaps the sheet image; the viewport caches a
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

// remove if retaining palette UI between loading different sprites becomes important
doc.on('sheetChanged', () => palette.reset());

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

// --- filter --------------------------------------------------------------

// Create the filter panel element. It positions itself relative to its
// anchor when shown.
const filterPanelEl = document.createElement('div');
filterPanelEl.id = 'filterPanel';
document.body.appendChild(filterPanelEl);
const filterPanel = new FilterPanel(filterPanelEl, doc, viewport);

document.getElementById('btnFilter').addEventListener('click', (e) => {
	if (filterPanel.visible) filterPanel.hide();
	else filterPanel.show(e.currentTarget);
});

// --- toolbar --------------------------------------------------------------
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
	if (!doc.selectedFrame || !doc.editable) return;
	try {
		const name = doc.editable.duplicateFrame(doc.selectedFrame);
		doc.selectFrame(name, { focus: true });
	} catch (err) {
		console.warn(err.message);
	}
});

$('btnNewSequence').addEventListener('click', () => {
	if (!doc.editable) return;
	const base = doc.selectedFrame ? `seq_${doc.selectedFrame}` : 'new_sequence';
	const name = doc.editable.uniqueSequenceName(base);
	doc.editable.addSequence(name, {
		frames: doc.selectedFrame ? [doc.selectedFrame] : [],
	});
	doc.selectSequence(name);
});


// --- file operations -----------------------------------------------------

async function doLoadSprite() {
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
		// Keep the currently-loaded image if there is one; otherwise a
		// placeholder is installed so the frame outlines render.
		const keepImage = doc.hasImage;
		const sheet = await sheetFromSpriteJSON(file.json, null);
		makeEditable(sheet);
		if (!keepImage) {
			sheet.imageSrc = file.imageFilename;
		}
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
	$('statusMessage').textContent = `Loaded image ${file.imageFilename}`;
}

async function doNewSprite() {
	if (doc.anyDirty && !window.confirm(
		'The current sheet has unsaved changes. Discard them and create a new sheet?'
	)) return;

	const values = await sheetDialog.openForNew();
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
		});
		doc.setSheet(sheet, { imageLoaded: true });
		savedFilenames = null;
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
	if (doc.anyDirty && !window.confirm(
		'The current sheet has unsaved changes. Discard them and create a new image?'
	)) return;

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
	$('statusMessage').textContent = 'Sheet settings updated.';
}

async function doOpenFromDisk() {
	$('statusMessage').textContent = 'Choose files…';
	const result = await diskLoadDialog.open();
	if (!result) {
		$('statusMessage').textContent = 'Open cancelled.';
		return;
	}

	doc.setSheet(result.sheet);
	savedFilenames = {
		jsonFilename: result.jsonFilename,
		imageFilename: result.imageFilename,
	};
	savedDirectory = null;
	saveMode = null;
	$('statusMessage').textContent = `Loaded ${result.jsonFilename} from disk`;
}

const errorDialog = new ErrorDialog();
const saveDialog = new SaveDialog();

// Cached between saves within a session. Lost on reload — that's fine.
let savedFilenames = null;
let savedDirectory = null;
let saveMode = null;  // 'directory' | 'download' | null

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

// Ctrl+S: write whichever side is dirty, both if both. Never prompts for
// filenames if they're already known.
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
const doSaveImageAs  = () => _doSaveImage({ forcePrompt: true });
const doSaveDataAs   = () => _doSaveData({ forcePrompt: true });

// Save both halves at once — used by Ctrl+Alt+S and the File menu's
// "Save all" item, if you want it. Keeps the old one-prompt behaviour.
async function doSaveAll() {
	if (!doc.sheet) return;

	const names = await _ensureFilenames();
	if (!names) return;

	$('statusMessage').textContent = 'Saving…';
	try {
		const result = await saveSheetBoth({
			sheet: doc.sheet,
			jsonFilename: names.jsonFilename,
			imageFilename: names.imageFilename,
			directoryHandle: savedDirectory,
			forceDownload: saveMode === 'download',
		});
		savedDirectory = result.directoryHandle;
		saveMode = result.mode;
		doc.markSaved('all');
		doc.sheet.imageSrc = names.imageFilename;
		$('statusMessage').textContent = result.mode === 'directory'
			? `Saved ${names.jsonFilename} + ${names.imageFilename}`
			: `Downloaded ${names.jsonFilename} + ${names.imageFilename}`;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Save failed: ' + err.message;
	}
}

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

function doSelectAll() {
	if (!doc.sheet || !doc.selectedFrame) return;
	doc.selectAllOfFrame();
}

function doDeselect() {
	doc.clearSelection();
}

// --- transforms ----------------------------------------------------------
//
// All operate on the current op rect: the selection if any, else the
// whole frame.

function _transformOp(label, fn) {
	if (!doc.sheet) return;
	const rect = doc.currentOpRect();
	if (!rect) return;
	doc.editable.transformRegion(rect, fn);
	const where = doc.selection.isEmpty ? 'frame' : 'selection';
	$('statusMessage').textContent = `${label} ${where} (${rect.w}×${rect.h})`;
}

const doRotateCW   = () => _transformOp('Rotated CW',       rotate90CW);
const doRotateCCW  = () => _transformOp('Rotated CCW',      rotate90CCW);
const doFlipV      = () => _transformOp('Flipped vertical', flipVertical);
const doFlipH      = () => _transformOp('Flipped horizontal', flipHorizontal);

const doMoveUp    = () => _transformOp('Moved up',    (d) => translateWrapped(d,  0, -1));
const doMoveDown  = () => _transformOp('Moved down',  (d) => translateWrapped(d,  0,  1));
const doMoveLeft  = () => _transformOp('Moved left',  (d) => translateWrapped(d, -1,  0));
const doMoveRight = () => _transformOp('Moved right', (d) => translateWrapped(d,  1,  0));

const fileMenu = new Menu(document.getElementById('fileMenuBtn'), [
	{ label: 'New Sprite',   action: doNewSprite },
	{ label: 'New Image',    action: doNewImage },
	{ separator: true },
	{ label: 'Load Sprite…', action: doLoadSprite },
	{ label: 'Load Image…',  action: doLoadImage },
	{ separator: true },
	{ label: 'Save Image',         shortcut: 'Ctrl+S',       action: doSaveImage },
	{ label: 'Save Sprite Data',   shortcut: 'Ctrl+Shift+S', action: doSaveData },
	{ label: 'Save All',           shortcut: 'Ctrl+Alt+S',   action: doSave },
	{ separator: true },
	{ label: 'Save Image As…',         action: doSaveImageAs },
	{ label: 'Save Sprite Data As…',   action: doSaveDataAs },
]);

function updateFileMenuState() {
	const hasSheet = doc.hasSheet;
	const hasImage = doc.hasImage;
	const setEnabled = (label, on) => {
		const item = fileMenu.items.find(i => i.label === label);
		if (item) item.disabled = !on;
	};
	// Save Image is available whenever there's a sheet, because a sheet
	// always has an image (the placeholder counts once you've painted into
	// it). Save Sprite Data needs actual sprite data — the same rule the
	// load side already uses.
	setEnabled('Save Image',          hasSheet);
	setEnabled('Save Sprite Data',    hasSheet);
	setEnabled('Save All',            hasSheet);
	setEnabled('Save Image As…',      hasSheet);
	setEnabled('Save Sprite Data As…', hasSheet);
}

updateFileMenuState();

new Menu(document.getElementById('sheetMenuBtn'), [
	{ label: 'Sheet settings…', action: doEditSheet },
	{ separator: true },
	{
		label: 'Toggle collision overlay',
		action: () => {
			collisionInspector.showOverlay = !collisionInspector.showOverlay;
			collisionOverlay.setEnabled(collisionInspector.showOverlay);
			collisionInspector.rebuild();
		},
	},
]);

new Menu(document.getElementById('viewMenuBtn'), [
	{
		label: 'Background…',
		action: (e) => {
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
	{ separator: true },
	{ label: 'Select All (frame)', shortcut: 'Ctrl+A', action: doSelectAll },
	{ label: 'Deselect',           shortcut: 'Ctrl+D', action: doDeselect },
], {
	onShow: (items) => {
		const hasFrame = !!(doc.sheet && doc.selectedFrame);
		const hasClip  = !clipboard.isEmpty;
		const hasSel   = !doc.selection.isEmpty;
		items.find(i => i.label === 'Copy').disabled  = !hasFrame;
		items.find(i => i.label === 'Cut').disabled   = !hasFrame;
		items.find(i => i.label === 'Paste').disabled = !hasFrame || !hasClip;
		items.find(i => i.label === 'Clear').disabled = !hasFrame;
		items.find(i => i.label === 'Select All (frame)').disabled = !hasFrame;
		items.find(i => i.label === 'Deselect').disabled = !hasSel;
	},
});

new Menu(document.getElementById('transformMenuBtn'), [
	{ label: 'Rotate 90° CW',   shortcut: 'R',       action: doRotateCW },
	{ label: 'Rotate 90° CCW',  shortcut: 'Shift+R', action: doRotateCCW },
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

const sheetSizeDialog = new SheetSizeDialog();
const sheetDialog = new SheetDialog();

// --- keyboard events ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
	const tag = (e.target.tagName || '').toLowerCase();
	const inField = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
	const mod = e.ctrlKey || e.metaKey;
	const key = e.key.toLowerCase();

	if (mod) {
		// using alt on keys where ctrl-* is hijacked by the browser.
		if (key === 'n' && e.altKey) {
			e.preventDefault();
			doNewSprite();
			return;
		}
		if (key === 's' && e.altKey && !e.shiftKey) {
			e.preventDefault();
			doSave();
			return;
		}
		if (e.altKey) return;

		if (!inField) {
			if (key === 'arrowup')    { e.preventDefault(); doMoveUp();    return; }
			if (key === 'arrowdown')  { e.preventDefault(); doMoveDown();  return; }
			if (key === 'arrowleft')  { e.preventDefault(); doMoveLeft();  return; }
			if (key === 'arrowright') { e.preventDefault(); doMoveRight(); return; }

			if (key === 'a') {
				e.preventDefault();
				doSelectAll();
				return;
			}
			if (key === 'd') {
				e.preventDefault();
				doDeselect();
				return;
			}
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

function setupTabs(sidebarEl) {
	const tabs   = sidebarEl.querySelectorAll('.sidebar-tab');
	const panels = sidebarEl.querySelectorAll('.tab-panel');

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const name = tab.dataset.tab;
			tabs.forEach((t) => t.classList.toggle('selected', t === tab));
			panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
		});
	});
}

setupTabs(document.getElementById('leftSidebar'));
setupTabs(document.getElementById('rightSidebar'));

// --- clipboard events ----------------------------------------------------
//
// Using the DOM copy/cut/paste events rather than keydown: they fire for
// the browser's own menu and right-click context menu too, and preventDefault
// here genuinely stops the browser from doing anything with the system
// clipboard. The inField check lets text inputs behave normally.

function _isFormField(el) {
	if (!el) return false;
	const tag = (el.tagName || '').toLowerCase();
	return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

document.addEventListener('copy', (e) => {
	if (_isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame) return;
	e.preventDefault();
	doCopyFrame();
});

document.addEventListener('cut', (e) => {
	if (_isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame) return;
	e.preventDefault();
	doCutFrame();
});

document.addEventListener('paste', (e) => {
	if (_isFormField(e.target)) return;
	if (!doc.sheet || !doc.selectedFrame || clipboard.isEmpty) return;
	e.preventDefault();
	doPasteIntoFrame();
});

// --- view toolbar ---------------------------------------------------------

$('btnFit').addEventListener('click',    () => viewport.fit());
$('btnZoomIn').addEventListener('click', () => viewport.zoomBy(1.25));
$('btnZoomOut').addEventListener('click',() => viewport.zoomBy(1 / 1.25));

// --- unsaved-changes warning ---------------------------------------------
window.addEventListener('beforeunload', (e) => {
	if (!doc.anyDirty) return;
	e.preventDefault();
	e.returnValue = '';
});

// --- tool icons ----------------------------------------------------------
//
// Fire-and-forget. If the sprite loads, buttons swap from text to icons.
// If it fails, or a frame is missing, the text label stays — no error,
// no broken UI.

applyToolIcons('assets/toolIcons.json');
