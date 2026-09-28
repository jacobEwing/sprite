// Serialise an edited sheet. Three independent entry points, since the
// JSON and the image can be saved separately and marked clean
// independently.
//
// Each saver returns { directoryHandle, mode } where mode is either
// 'directory' (Chromium's File System Access API wrote the files to a
// user-chosen folder) or 'download' (the browser's download mechanism
// handled them). Callers cache the handle to skip the picker on
// subsequent saves.

export async function saveSheetImage({
	sheet,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const png = await imageToBlob(sheet.image);
	return writeFiles(
		[{ name: imageFilename, contents: png, type: 'image/png' }],
		{ directoryHandle, forceDownload }
	);
}

export async function saveSheetData({
	sheet,
	jsonFilename,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const json = serialiseSheet(sheet, imageFilename);
	return writeFiles(
		[{ name: jsonFilename, contents: json, type: 'application/json' }],
		{ directoryHandle, forceDownload }
	);
}

// Write both files together with a single directory-picker prompt. Used by
// the "Save All" menu action and its keyboard shortcut.
export async function saveSheetBoth({
	sheet,
	jsonFilename,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const png  = await imageToBlob(sheet.image);
	const json = serialiseSheet(sheet, imageFilename);
	return writeFiles([
		{ name: jsonFilename,  contents: json, type: 'application/json' },
		{ name: imageFilename, contents: png,  type: 'image/png' },
	], { directoryHandle, forceDownload });
}

// Propose filenames for a save, based on the current sheet's source paths.
export function proposeFilenames(sheet) {
	const image = (sheet.imageSrc || '').split('/').pop() || '';
	const json = image ? image.replace(/\.\w+$/, '') + '.json' : 'sheet.json';
	return {
		jsonFilename:  sheet.imageSrc ? json  : 'sheet.json',
		imageFilename: image || 'sheet.png',
	};
}

/* ==========================================================================
 *  Internals
 * ========================================================================== */

// The JSON the saver writes. Extracted so both saveSheetData and
// saveSheetBoth emit identically — differences there would be an easy
// source of round-trip bugs.
function serialiseSheet(sheet, imageFilename) {
	const data = sheet.toJSON();

	data.image = imageFilename;
	return JSON.stringify(data, null, '\t') + '\n';
}

// Write one or more files. Uses the File System Access API when available
// (caching the directory handle for next time), falling back to the
// browser's download mechanism otherwise.
async function writeFiles(files, { directoryHandle, forceDownload }) {
	if (!forceDownload && typeof window.showDirectoryPicker === 'function') {
		const dir = directoryHandle ?? await window.showDirectoryPicker({ mode: 'readwrite' });
		for (const f of files) await writeFile(dir, f.name, f.contents);
		return { directoryHandle: dir, mode: 'directory' };
	}

	for (const f of files) download(f.contents, f.name, f.type);
	return { directoryHandle: null, mode: 'download' };
}

// sheet.image is guaranteed to be a canvas by the time any save runs,
// because loadSheet's makeEditable() swaps it in immediately after load.
// An HTMLImageElement wouldn't have toBlob, which is why this matters.
function imageToBlob(source) {
	return new Promise((resolve, reject) => {
		source.toBlob(
			(b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
			'image/png'
		);
	});
}

async function writeFile(dirHandle, name, contents) {
	const handle = await dirHandle.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write(contents);
	await writable.close();
}

function download(contents, filename, type) {
	const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
