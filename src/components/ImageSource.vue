<script setup>
// Add pages: images picked (several at once: in file-name order) or
// photographed with the camera: in the app, the phone's own camera app (full
// resolution, focus, HDR); on the website, a camera preview in the page, the
// photo a still at the camera's best resolution where the browser can take
// one (else a frame of the preview).
import { Capacitor } from "@capacitor/core";
import { onBeforeUnmount, ref } from "vue";
import { imageFromSource } from "../pipeline/index.js";
import { useOmrState } from "../useOmr.js";

const omr = useOmrState();

const cameraActive = ref(false);
const videoEl = ref(null);
let cameraStream = null;

const byName = new Intl.Collator(undefined, { numeric: true }).compare;

async function onFileChange(event) {
	const files = [...(event.target.files ?? [])].sort((a, b) =>
		byName(a.name, b.name),
	);
	event.target.value = "";
	if (files.length === 0) {
		return;
	}
	stopCamera();
	await addPhotos(files);
}

/** Add images (Blobs or Files) as pages, in order. */
async function addPhotos(photos) {
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
	omr.addImages(images);
}

const native = Capacitor.isNativePlatform();
const taking = ref(false); // the phone's camera app is open

/** In the app: a photo with the phone's camera app. */
async function takeNativePhoto() {
	taking.value = true;
	try {
		const { Camera } = await import("@capacitor/camera");
		const { webPath } = await Camera.takePhoto({
			quality: 92,
			correctOrientation: true,
			saveToGallery: false,
			editable: "no",
		});
		const blob = await (await fetch(webPath)).blob();
		await addPhotos([blob]);
	} catch (e) {
		// closing the camera without a photo is not an error
		if (!/cancel/i.test(String(e?.message ?? e))) {
			console.error(e);
			omr.error = `Camera unavailable: ${e?.message ?? e}`;
		}
	} finally {
		taking.value = false;
	}
}

async function startCamera() {
	if (native) {
		return takeNativePhoto();
	}
	try {
		cameraStream = await navigator.mediaDevices.getUserMedia({
			// the best the camera offers (without a size, browsers give 640×480)
			video: {
				facingMode: "environment",
				width: { ideal: 4096 },
				height: { ideal: 3072 },
			},
		});
		cameraActive.value = true;
		// Wait a tick for the <video> element to exist
		requestAnimationFrame(() => {
			if (videoEl.value) {
				videoEl.value.srcObject = cameraStream;
			}
		});
	} catch (e) {
		omr.error = `Camera unavailable: ${e.message}`;
	}
}

async function capturePhoto() {
	const video = videoEl.value;
	if (!video || video.videoWidth === 0) {
		return;
	}
	// a still photo, at the camera's photo resolution (Chrome, Edge…)
	const track = cameraStream?.getVideoTracks()[0];
	if (track && typeof ImageCapture !== "undefined") {
		try {
			const photo = await new ImageCapture(track).takePhoto();
			stopCamera();
			await addPhotos([photo]);
			return;
		} catch (e) {
			console.warn("No still photo, a frame of the preview instead:", e);
		}
	}
	const image = imageFromSource(video, video.videoWidth, video.videoHeight);
	const canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	canvas
		.getContext("2d")
		.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
	stopCamera();
	const photo = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
	omr.addImages([{ image, url: URL.createObjectURL(photo), photo }]);
}

function stopCamera() {
	if (cameraStream) {
		for (const track of cameraStream.getTracks()) {
			track.stop();
		}
		cameraStream = null;
	}
	cameraActive.value = false;
}

onBeforeUnmount(stopCamera);
</script>

<template>
	<div class="image-source">
		<div class="row">
			<label class="file-label">
				{{ omr.pages.length ? "Add images" : "Choose images" }}
				<input type="file" accept="image/*" multiple @change="onFileChange" />
			</label>
			<button v-if="!cameraActive" class="secondary" :disabled="taking" @click="startCamera">
				{{ omr.pages.length ? "Add a photo" : "Use camera" }}
			</button>
			<template v-else>
				<button @click="capturePhoto">Capture</button>
				<button class="secondary" @click="stopCamera">Cancel</button>
			</template>
		</div>
		<p class="hint">
			One image per page, several for a longer piece. Printed music, flat
			page, even lighting, the whole page in frame. Phone photos work.
		</p>
		<video v-if="cameraActive" ref="videoEl" autoplay playsinline></video>
	</div>
</template>
