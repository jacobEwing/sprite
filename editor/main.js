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
import { saveSheet, proposeFilenames } from './io/saveSheet.js';
import { SaveDialog }                   from './view/SaveDialog.js';

// --- wiring ---------------------------------------------------------------

const history  = new History({ limit: 100 });
const doc      = new EditorDocument(history);
const palette  = new Palette();

const viewport = new Viewport(document.getElementById('viewport'));

new FrameList(document.getElementById('frameList'), doc);
new SequenceList(document.getElementById('sequenceList'), doc);

new FrameInspector(document.getElementById('frameInspector'), doc);
new SequenceInspector(document.getElementById('sequenceInspector'), doc);
new Timeline(document.getElementById('timeline'), doc, viewport);
new SpritePreview(document.getElementById('spritePreview'), doc);


const brushPicker = new BrushPicker(document.getElementById('brushPicker'));

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

};

toolLayer.setPanTool(TOOLS.pan);
toolLayer.setDefaultTool(TOOLS.pan);
toolLayer.setActiveTool(TOOLS.pan);

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

const toolButtons = document.querySelectorAll('.tool-btn');

function activateTool(name) {
	const tool = TOOLS[name];
	if (!tool) return;
	toolLayer.setActiveTool(tool);
	for (const btn of toolButtons) {
		btn.classList.toggle('selected', btn.dataset.tool === name);
	}
	viewport.canvas.style.cursor = name === 'pan' ? 'grab' : 'crosshair';
}

for (const btn of toolButtons) {
	btn.addEventListener('click', () => activateTool(btn.dataset.tool));
}
activateTool('pan');

// Keyboard shortcuts: single letter per tool, ignored while typing in a field.
const TOOL_KEYS = {
	p: 'pan', n: 'pencil', e : 'eraser', l: 'line', b: 'box',
	o: 'ellipse', f: 'fill', i: 'picker', m : 'frame',
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
	}
	viewport.invalidate();
});

doc.on('dirtyChanged', ({ dirty }) => {
	$('dirtyIndicator').hidden = !dirty;
});


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

const saveDialog = new SaveDialog();

// Cached between saves within a session. Lost on reload — that's fine.
let savedFilenames = null;
let savedDirectory = null;
let saveMode = null;  // 'directory' | 'download' | null

async function doSaveAs() {
	if (!doc.sheet) return;
	const defaults = savedFilenames || proposeFilenames(doc.sheet);
	const names = await saveDialog.open(defaults);
	if (!names) return;

	$('statusMessage').textContent = 'Saving…';
	try {
		// Save As always tries the directory picker (or falls back to
		// downloads if the browser doesn't support it).
		const result = await saveSheet({
			sheet: doc.sheet,
			jsonFilename: names.jsonFilename,
			imageFilename: names.imageFilename,
			directoryHandle: null,
			forceDownload: false,
		});
		savedDirectory = result.directoryHandle;
		savedFilenames = names;
		saveMode = result.mode;
		doc.markSaved();
		$('statusMessage').textContent = result.mode === 'directory'
			? `Saved ${names.jsonFilename} + ${names.imageFilename}`
			: `Downloaded ${names.jsonFilename} + ${names.imageFilename}`;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Save failed: ' + err.message;
	}
}

async function doSave() {
	if (!doc.sheet) return;
	if (!savedFilenames) return doSaveAs();

	$('statusMessage').textContent = 'Saving…';
	try {
		const result = await saveSheet({
			sheet: doc.sheet,
			jsonFilename: savedFilenames.jsonFilename,
			imageFilename: savedFilenames.imageFilename,
			directoryHandle: savedDirectory,
			forceDownload: saveMode === 'download',
		});
		savedDirectory = result.directoryHandle;
		saveMode = result.mode;
		doc.markSaved();
		$('statusMessage').textContent = result.mode === 'directory'
			? `Saved ${savedFilenames.jsonFilename}`
			: `Downloaded ${savedFilenames.jsonFilename}`;
	} catch (err) {
		console.error(err);
		$('statusMessage').textContent = 'Save failed: ' + err.message;
	}
}

const fileMenu = new Menu(document.getElementById('fileMenuBtn'), [
	{
		label: 'New', shortcut: 'Ctrl+N', disabled: true,
		title: 'Blank sheets are coming in a later phase',
	},
	{
		label: 'Open…', shortcut: 'Ctrl+O',
		action: async () => {
			const path = await loadDialog.open();
			if (path) await doLoadSheet(path);
		},
	},
	{ separator: true },
	{ label: 'Save', shortcut: 'Ctrl+S', action: doSave },
	{ label: 'Save As…', shortcut: 'Ctrl+Shift+S', action: doSaveAs },
]);

function updateFileMenuState() {
	const enabled = !!doc.sheet;
	fileMenu.items.find(i => i.label === 'Save').disabled = !enabled;
	fileMenu.items.find(i => i.label === 'Save As…').disabled = !enabled;
}
doc.on('sheetChanged', updateFileMenuState);
updateFileMenuState();

const sheetSizeDialog = new SheetSizeDialog();

new Menu(document.getElementById('sheetMenuBtn'), [
	{
		label: 'Expand canvas…',
		disabled: false,
		title: 'Increase the atlas dimensions',
		action: async () => {
			if (!doc.sheet || !doc.editable) return;
			const result = await sheetSizeDialog.open(
				doc.sheet.imageWidth, doc.sheet.imageHeight);
			if (!result) return;
			doc.editable.expandCanvas(result.width, result.height);
		},
	},
]);

// --- keyboard events ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
	const tag = (e.target.tagName || '').toLowerCase();
	const inField = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
	const mod = e.ctrlKey || e.metaKey;
	const key = e.key.toLowerCase();

	// File operations: always ours, even from inside a field. preventDefault
	// stops the browser from offering to save the page.
	if (mod && !e.altKey) {
		if (key === 's') {
			e.preventDefault();
			if (e.shiftKey) doSaveAs();
			else            doSave();
			return;
		}
		if (key === 'o') {
			e.preventDefault();
			loadDialog.open().then((path) => {
				if (path) doLoadSheet(path);
			});
			return;
		}
		// Edit history respects text-field context, so Ctrl+Z inside a
		// hex or number field undoes the text edit, not the document.
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

	// Unmodified keys: tool selection and palette swap.
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

// --- view toolbar ---------------------------------------------------------

$('btnFit').addEventListener('click',    () => viewport.fit());
$('btnZoomIn').addEventListener('click', () => viewport.zoomBy(1.25));
$('btnZoomOut').addEventListener('click',() => viewport.zoomBy(1 / 1.25));

// --- unsaved-changes warning ---------------------------------------------
window.addEventListener('beforeunload', (e) => {
	if (!doc.dirty) return;
	e.preventDefault();
	e.returnValue = '';
});
