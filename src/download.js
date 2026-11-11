// Saving files: in a browser, as downloads; in the Android / iOS app (where a
// download link does nothing), written to the app's cache and handed to the
// system share sheet (save to Files or Drive, send, open in another app).
import { Capacitor } from "@capacitor/core";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function browserDownload(name, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

/** A blob's bytes as base64 (what the Filesystem plugin writes). */
function base64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function shareFiles(files) {
	const [{ Directory, Filesystem }, { Share }] = await Promise.all([
		import("@capacitor/filesystem"),
		import("@capacitor/share"),
	]);
	const uris = [];
	for (const { name, blob } of files) {
		const { uri } = await Filesystem.writeFile({
			path: `exports/${name}`,
			data: await base64(blob),
			directory: Directory.Cache,
			recursive: true,
		});
		uris.push(uri);
	}
	try {
		await Share.share({ title: files[0].name, files: uris });
	} catch (error) {
		// closing the share sheet without picking anything is not an error
		if (!/cancel/i.test(String(error?.message ?? error))) {
			throw error;
		}
	}
}

/** Save files ({ name, blob }), together. */
export async function downloadAll(files) {
	if (Capacitor.isNativePlatform()) {
		return shareFiles(files);
	}
	for (const [k, { name, blob }] of files.entries()) {
		if (k > 0) {
			await pause(300); // browsers drop downloads started at once
		}
		browserDownload(name, blob);
	}
}

/** Save a blob as a file named `name`. */
export function download(name, blob) {
	return downloadAll([{ name, blob }]);
}
