// Photos as pages: decoded to pixels, and taken with the phone's camera app
// (in the Android / iOS app).
import { imageFromSource } from "./pipeline/index.js";

/** Images (Blobs or Files) as addImages takes them, in order. */
export async function imagesFromPhotos(photos) {
	const images = [];
	for (const photo of photos) {
		const bitmap = await createImageBitmap(photo);
		images.push({
			image: imageFromSource(bitmap, bitmap.width, bitmap.height),
			url: URL.createObjectURL(photo),
			photo,
		});
		bitmap.close();
	}
	return images;
}

/**
 * A photo taken with the phone's camera app (full resolution, its focus and
 * HDR), as a Blob; null when closed without one.
 */
export async function takeCameraPhoto() {
	const { Camera } = await import("@capacitor/camera");
	try {
		const { webPath } = await Camera.takePhoto({
			quality: 92,
			correctOrientation: true,
			saveToGallery: false,
			editable: "no",
		});
		return await (await fetch(webPath)).blob();
	} catch (e) {
		if (/cancel/i.test(String(e?.message ?? e))) {
			return null; // closed without a photo
		}
		throw e;
	}
}
