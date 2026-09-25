import { serialiseCollision } from '../model/collisionUtils.js';


// Serialise the edited sheet. Two independent savers, since the JSON and
// the image can be written separately and marked clean independently.

export async function saveSheetImage({
	sheet,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const pngBlob = await _imageToBlob(sheet.image);

	if (!forceDownload && typeof window.showDirectoryPicker === 'function') {
		const dir = directoryHandle ?? await window.showDirectoryPicker({ mode: 'readwrite' });
		await _writeFile(dir, imageFilename, pngBlob);
		return { directoryHandle: dir, mode: 'directory' };
	}

	_download(pngBlob, imageFilename, 'image/png');
	return { directoryHandle: null, mode: 'download' };
}

export async function saveSheetData({
	sheet,
	jsonFilename,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const data = sheet.toJSON();
	if (data.collision) {
		const shorthand = serialiseCollision(data.collision);
		if (shorthand) data.collision = shorthand;
		else delete data.collision;
	}

	data.image = imageFilename;
	const jsonText = JSON.stringify(data, null, '\t') + '\n';

	if (!forceDownload && typeof window.showDirectoryPicker === 'function') {
		const dir = directoryHandle ?? await window.showDirectoryPicker({ mode: 'readwrite' });
		await _writeFile(dir, jsonFilename, jsonText);
		return { directoryHandle: dir, mode: 'directory' };
	}

	_download(jsonText, jsonFilename, 'application/json');
	return { directoryHandle: null, mode: 'download' };
}

// Convenience: write both files with a single directory-picker prompt.
export async function saveSheetBoth({
	sheet,
	jsonFilename,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const pngBlob = await _imageToBlob(sheet.image);
	const data = sheet.toJSON();
	if (data.collision) {
		const shorthand = serialiseCollision(data.collision);
		if (shorthand) data.collision = shorthand;
		else delete data.collision;
	}

	data.image = imageFilename;
	const jsonText = JSON.stringify(data, null, '\t') + '\n';

	if (!forceDownload && typeof window.showDirectoryPicker === 'function') {
		const dir = directoryHandle ?? await window.showDirectoryPicker({ mode: 'readwrite' });
		await _writeFile(dir, jsonFilename, jsonText);
		await _writeFile(dir, imageFilename, pngBlob);
		return { directoryHandle: dir, mode: 'directory' };
	}

	_download(jsonText, jsonFilename, 'application/json');
	_download(pngBlob, imageFilename, 'image/png');
	return { directoryHandle: null, mode: 'download' };
}

function _imageToBlob(source) {
	return new Promise((resolve, reject) => {
		source.toBlob(
			(b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
			'image/png'
		);
	});
}

async function _writeFile(dirHandle, name, contents) {
	const handle = await dirHandle.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write(contents);
	await writable.close();
}

function _download(contents, filename, type) {
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

export function proposeFilenames(sheet) {
	const image = (sheet.imageSrc || '').split('/').pop() || '';
	const json = image ? image.replace(/\.\w+$/, '') + '.json' : 'sheet.json';
	return {
		jsonFilename:  sheet.imageSrc ? json  : 'sheet.json',
		imageFilename: image || 'sheet.png',
	};
}
