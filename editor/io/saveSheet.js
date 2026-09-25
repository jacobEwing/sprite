// Serialise an edited sheet and write it out as a JSON + PNG pair.
//
// Three output modes:
//   • directory — File System Access API. Writes both files to a user-
//     chosen folder. Cacheable handle means subsequent saves are silent.
//   • download  — two browser downloads. Works everywhere, but the user
//     has to move the files into place manually.
//
// forceDownload: true skips the picker even if it's available. Used by
// Save (as opposed to Save As) so that download-mode sheets stay in
// download mode rather than prompting again.

export async function saveSheet({
	sheet,
	jsonFilename,
	imageFilename,
	directoryHandle = null,
	forceDownload = false,
}) {
	const data = sheet.toJSON();
	data.image = imageFilename;
	const jsonText = JSON.stringify(data, null, '\t') + '\n';

	const pngBlob = await new Promise((resolve, reject) => {
		sheet.image.toBlob(
			(b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
			'image/png'
		);
	});

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

// Propose filenames for a save, based on the current sheet's source paths.
export function proposeFilenames(sheet) {
	const image = (sheet.imageSrc || '').split('/').pop() || '';
	const json = image ? image.replace(/\.\w+$/, '') + '.json' : 'sheet.json';
	return {
		jsonFilename:  sheet.imageSrc ? json  : 'sheet.json',
		imageFilename: image || 'sheet.png',
	};
}
