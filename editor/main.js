import { EditorDocument } from './model/EditorDocument.js';
import { Palette }        from './model/Palette.js';
import { PalettePanel }   from './view/PalettePanel.js';
import { Viewport }       from './view/Viewport.js';
import { FrameList }      from './view/FrameList.js';
import { SequenceList }   from './view/SequenceList.js';
import { BrushPicker }    from './view/BrushPicker.js';
import { loadSheet }      from './io/loadSheet.js';
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
import { LoadDialog }     from './view/LoadDialog.js';
import { FrameInspector }    from './view/FrameInspector.js';
import { SequenceInspector } from './view/SequenceInspector.js';
import { Timeline }        from './view/Timeline.js';
import { SheetSizeDialog } from './view/SheetSizeDialog.js';
import { FrameTool }       from './tools/FrameTool.js';
import { SpritePreview }   from './view/SpritePreview.js';
import { saveSheetImage, saveSheetData, saveSheetBoth, proposeFilenames } from './io/saveSheet.js';
import { DiskLoadDialog }  from './view/DiskLoadDialog.js';
import { SaveDialog }                   from './view/SaveDialog.js';
import { FilterPanel }     from './view/FilterPanel.js';
import { loadSheetFromDisk } from './io/loadSheet.js';
import { ErrorDialog }     from './view/ErrorDialog.js';
import { applyToolIcons }  from './view/toolIcons.js';
import { SheetDialog }     from './view/SheetDialog.js';
import { makeBlankSheet }  from './io/loadSheet.js';
import { CollisionOverlay }    from './view/CollisionOverlay.js';
import { CollisionInspector }  from './view/CollisionInspector.js';
import { CollisionTool }       from './tools/CollisionTool.js';
import { BackgroundPicker } from './view/BackgroundPicker.js';

// --- wiring ---------------------------------------------------------------
const viewOptions = { grid: false, snap: false };

const history  = new History({ limit: 100 });
const doc      = new EditorDocument(history);
const palette  = new Palette();
const viewport = new Viewport(document.getElementById('viewport'));
const backgroundPicker = new BackgroundPicker(viewport);


new FrameList(document.getElementById('frameList'), doc);
new SequenceList(document.getElementById('sequenceList'), doc);

new FrameInspector(document.getElementById('frameInspector'), doc);
new SequenceInspector(document.getElementById('sequenceInspector'), doc);
new Timeline(document.getElementById('timeline'), doc, viewport);
new SpritePreview(document.getElementById('spritePreview'), doc);


const brushPicker = new BrushPicker(document.getElementById('brushPicker'));

const collisionOverlay = new CollisionOverlay(doc, viewport);
const toolLayer = new ToolLayer({ viewport, document: doc, palette, history });

const TOOLS = {
	pan:     new PanTool(toolLayer.context),
	pencil:  new PencilTool(toolLayer.context),
	eraser:  new EraserTool(toolLayer.context),
	line:    new LineTool(toolLayer.context),
	box:     new BoxTool(toolLayer.context),
	ellipse: new EllipseTool(toolLayer.context),
	fill:    new FloodFillTool(toolLayer.context),
	picker:  new ColorPickerTool(toolLayer.context),
	frame:   new FrameTool(toolLayer.context),
	collision: new CollisionTool(toolLayer.context),

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
	p: 'pan', n: 'pencil', e : 'eraser', l: 'line', b: 'box',
	o: 'ellipse', f: 'fill', i: 'picker', m : 'frame', k: 'collision'
};

// --- shape-fill toggle ----------------------------------------------------

$('fillShapes').addEventListener('change', (e) => {
	toolLayer.setFillShapes(e.target.checked);
});

$('clipToFrame').addEventListener('change', (e) => {
	toolLayer.setClipToFrame(e.target.checked);
});

// --- document events ------------------------------------------------------

doc.on('sheetChanged', () => {
	history.clear();
	viewport.setFrames(doc.sheet.frames);
	viewport.setSource(doc.sheet.image);
	viewport.setGridStep(doc.sheet.frameWidth, doc.sheet.frameHeight);

	$('emptyMessage').classList.add('hidden');
	$('frameCount').textContent = doc.sheet.frameNames.length;
	$('sequenceCount').textContent = doc.sheet.sequenceNames.length;
	$('statusMessage').textContent =
		`Loaded "${doc.sheet.imageSrc ?? '(inline image)'}" — ` +
		`${doc.sheet.imageWidth}×${doc.sheet.imageHeight}px`;

	if (doc.selectedFrame) viewport.focusFrame(doc.selectedFrame);
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

// --- file menu ------------------------------------------------------------

const loadDialog = new LoadDialog();
const diskLoadDialog = new DiskLoadDialog();

async function doLoadSheet(path) {
	$('statusMessage').textContent = 'Loading…';
	try {
		const sheet = await loadSheet(path);
		doc.setSheet(sheet);
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Load failed: ' + err.message;
	}
}
async function doNewSheet() {
	if (doc.dirty && !window.confirm(
		'The current sheet has unsaved changes. Discard them and create a new sheet?'
	)) return;

	const values = await sheetDialog.openForNew();
	if (!values) return;

	$('statusMessage').textContent = 'Creating sheet…';
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
			// imageSrc is intentionally not passed: a new sheet has no
			// image on disk until the user saves.
		});
		sheet.imageSrc = null;

		doc.setSheet(sheet);
		savedFilenames = null;
		savedDirectory = null;
		saveMode = null;
		$('statusMessage').textContent =
			`New sheet: ${sheet.imageWidth}×${sheet.imageHeight}, ` +
			`${sheet.frameNames.length} frames`;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Create failed.';
		await errorDialog.show('Couldn\'t create the sheet', err.message);
	}
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

const fileMenu = new Menu(document.getElementById('fileMenuBtn'), [
	{ label: 'New', shortcut: 'Ctrl+Alt+N', action: doNewSheet },
	{ label: 'Open URL…', shortcut: 'Ctrl+O', action: async () => {
		const result = await loadDialog.open();
		if (result === null) return;
		if (typeof result === 'object' && result.browse) await doOpenFromDisk();
		else if (typeof result === 'string') await doLoadSheet(result);
	} },
	{ label: 'Open from disk…', shortcut: 'Ctrl+Shift+O', action: doOpenFromDisk },
	{ separator: true },
	{ label: 'Save Image',         shortcut: 'Ctrl+S',       action: doSaveImage },
	{ label: 'Save Sprite Data',   shortcut: 'Ctrl+Shift+S', action: doSaveData },
	{ label: 'Save All',           shortcut: 'Ctrl+Alt+S',   action: doSave },
	{ separator: true },
	{ label: 'Save Image As…',        action: doSaveImageAs },
	{ label: 'Save Sprite Data As…',  action: doSaveDataAs },
]);

function updateFileMenuState() {
	const enabled = !!doc.sheet;
	const setEnabled = (label, on) => {
		const item = fileMenu.items.find(i => i.label === label);
		if (item) item.disabled = !on;
	};
	setEnabled('Save Image',          enabled);
	setEnabled('Save Sprite Data',    enabled);
	setEnabled('Save All',            enabled);
	setEnabled('Save Image As…',      enabled);
	setEnabled('Save Sprite Data As…', enabled);
}
doc.on('sheetChanged', updateFileMenuState);
updateFileMenuState();

const sheetMenu = new Menu(document.getElementById('sheetMenuBtn'), [
	{ label: 'Sheet settings…', action: doEditSheet },
	{ label: 'Expand canvas…',  action: doExpandCanvas },
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

async function doExpandCanvas() {
	if (!doc.sheet || !doc.editable) return;
	const result = await sheetSizeDialog.open(
		doc.sheet.imageWidth, doc.sheet.imageHeight);
	if (!result) return;
	doc.editable.expandCanvas(result.width, result.height);
}

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
			doNewSheet();
			return;
		}
		if (key === 's' && e.altKey && !e.shiftKey) {
			e.preventDefault();
			doSave();
			return;
		}
		if (e.altKey) return;

		if (key === 'o') {
			e.preventDefault();
			if (e.shiftKey) {
				doOpenFromDisk();
			} else {
				loadDialog.open().then((result) => {
					if (result === null) return;
					if (typeof result === 'object' && result.browse) {
						doOpenFromDisk();
					} else if (typeof result === 'string') {
						doLoadSheet(result);
					}
				});
			}
			return;
		}
		if (!inField) {
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
