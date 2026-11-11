// The app's state and actions, shared by its components (provided by App.vue
// as "omr", a reactive object: its fields read and assign as plain values).
//
// The score is read from one or more pages, in order: images picked or
// photographed, each with its own corners (detected, then adjustable) and
// flattened + cleaned page. For a scan, "Whole photo" keeps the full image.
// Lighting evened out, in %: 0 leaves the lighting as photographed, 100
// removes shadows and gradients. Cleaning strength, in %: 0 leaves the tones
// unchanged, 100 is scan-like (white paper, black ink), up to 200 harsher.
// Both apply to every page, or, with `perPage`, each page has its own
// (starting from the shared ones). `evening` and `cleaning` follow the
// sliders live; `lighting` and `strength` are applied when released (see
// applySettings).
//
// Recognition reads the pages, flattened inside their corners and cleaned
// like the previews, and joins them into one score. It never blocks the
// controls: Stop cancels it, Recognize restarts it, and changing its input
// stops it.
import {
	computed,
	inject,
	markRaw,
	reactive,
	ref,
	shallowRef,
	watch,
} from "vue";
import { canvasOf } from "./export.js";
import {
	deleteStates,
	getPhotos,
	getScore,
	keepStorage,
	putScore,
} from "./library.js";
import { imagesFromPhotos } from "./photos.js";
import { fullQuad } from "./pipeline/capture/index.js";
import {
	detectPageCorners,
	engines,
	fetchModels,
	flattenPage,
	hasModels,
	imageFromSource,
	isApp,
	removeModels,
	restoreRecognition,
	runPipeline,
	saveRecognition,
	stopRecognition,
} from "./pipeline/index.js";
import { buildScore, withCredits } from "./score.js";

/** The shared state, in a component under App.vue. */
export const useOmrState = () => inject("omr");

let nextPageId = 0;

export function useOmr() {
	const engineId = ref("2m");
	const running = ref(false);
	const progress = ref(null);
	const error = ref(null);
	// the recognition (see score.js buildScore), edited in ScoreEditor (a new
	// one starts it afresh)
	const result = ref(null);
	// the hand edits on it (see pipeline/edit.js; ScoreEditor keeps them here)
	const ops = shallowRef([]);
	// the score's title and composer (kept from one recognition to the next)
	const title = ref("");
	const composer = ref("");

	const evening = ref(100);
	const lighting = ref(100);
	const cleaning = ref(100);
	const strength = ref(100);
	const perPage = ref(false); // each page its own lighting and cleaning

	/**
	 * The pages, in score order: { id, image (RGBA, raw), previewUrl, quad
	 * (TL, TR, BR, BL in image pixels), detectedQuad, captureState
	 * ("detecting" | "found" | "not-found" | "error"), captureError,
	 * pageImage (the flattened, cleaned page, raw), pageUrl, flattening }.
	 */
	const pages = ref([]);
	const currentIndex = ref(0);
	const page = computed(() => pages.value[currentIndex.value] ?? null);

	// In the app, each detector's models: "ready" (inside the app, or
	// downloaded), "missing" or "downloading" (on the web, models are
	// downloaded when first used: always "ready")
	const models = ref({});
	const modelProgress = ref(null);
	const modelReady = computed(
		() => !isApp || models.value[engineId.value] === "ready",
	);

	async function refreshModels() {
		for (const { id } of engines) {
			try {
				models.value[id] = (await hasModels(id)) ? "ready" : "missing";
			} catch (e) {
				console.error(e);
				models.value[id] = "missing";
			}
		}
	}
	if (isApp) {
		refreshModels();
	}

	/** Download a detector's models (in the app), to keep them. */
	async function downloadModel(id) {
		models.value[id] = "downloading";
		modelProgress.value = { stage: "starting", ratio: 0 };
		error.value = null;
		try {
			await fetchModels(id, {
				onProgress: (q) => {
					modelProgress.value = q;
				},
			});
			models.value[id] = "ready";
		} catch (e) {
			console.error(e);
			error.value = `Download failed: ${e.message}`;
			models.value[id] = "missing";
		} finally {
			modelProgress.value = null;
		}
	}

	/** Remove a detector's downloaded models (in the app), to free the space. */
	async function removeModel(id) {
		try {
			await removeModels(id);
		} catch (e) {
			console.error(e);
		}
		await refreshModels();
	}

	const canRun = computed(
		() =>
			modelReady.value &&
			pages.value.length > 0 &&
			pages.value.every((p) => p.captureState !== "detecting"),
	);
	let recognitionRun = 0;

	/** Stop the recognition in progress, if any. */
	function stop() {
		if (running.value) {
			recognitionRun++; // its outcome is ignored
			stopRecognition();
			running.value = false;
			progress.value = null;
		}
	}

	/** The input changed: the result (or the run in progress) is stale. */
	function resetResult() {
		stop();
		error.value = null;
		result.value = null;
		ops.value = [];
	}

	// ------------------------------------------------------------ the pages

	let detecting = Promise.resolve(); // one page at a time

	/** New photos, after the pages there are: show them, find their corners. */
	function addImages(images) {
		if (images.length === 0) {
			return;
		}
		resetResult();
		const added = images.map(({ image, url, photo }) =>
			reactive({
				id: ++nextPageId,
				key: crypto.randomUUID(), // its name in the saved score
				photo: photo && markRaw(photo), // the image as added (a Blob)
				image: markRaw(image),
				previewUrl: url,
				quad: fullQuad(image.width, image.height),
				// its own lighting and cleaning (used with perPage), as shared
				evening: lighting.value,
				lighting: lighting.value,
				cleaning: strength.value,
				strength: strength.value,
				detectedQuad: null,
				captureState: "detecting",
				captureError: null,
				pageImage: null,
				pageUrl: null,
				flattening: false,
				flattenRun: 0,
			}),
		);
		currentIndex.value = pages.value.length;
		pages.value = [...pages.value, ...added];
		for (const p of added) {
			detecting = detecting.then(() => detectCorners(p));
		}
	}

	async function detectCorners(p) {
		if (!pages.value.includes(p)) {
			return; // removed meanwhile
		}
		try {
			const found = await detectPageCorners(p.image);
			p.detectedQuad = found;
			p.quad = found ?? p.quad;
			p.captureState = found ? "found" : "not-found";
		} catch (e) {
			console.error(e);
			p.captureState = "error";
			p.captureError = e.message;
		}
		await refreshPage(p);
	}

	function releasePage(p) {
		URL.revokeObjectURL(p.previewUrl);
		if (p.pageUrl) {
			URL.revokeObjectURL(p.pageUrl);
		}
	}

	function removePage(i) {
		resetResult();
		releasePage(pages.value[i]);
		pages.value = pages.value.filter((_, j) => j !== i);
		currentIndex.value = Math.max(
			0,
			Math.min(currentIndex.value, pages.value.length - 1),
		);
	}

	/** Move page `i` one place earlier (-1) or later (+1). */
	function movePage(i, step) {
		const j = i + step;
		if (j < 0 || j >= pages.value.length) {
			return;
		}
		resetResult();
		const next = [...pages.value];
		[next[i], next[j]] = [next[j], next[i]];
		pages.value = next;
		if (currentIndex.value === i) {
			currentIndex.value = j;
		} else if (currentIndex.value === j) {
			currentIndex.value = i;
		}
	}

	function selectPage(i) {
		currentIndex.value = i;
	}

	function setPageImage(p, flat) {
		p.pageImage = flat && markRaw(flat);
		if (p.pageUrl) {
			URL.revokeObjectURL(p.pageUrl);
			p.pageUrl = null;
		}
		if (flat) {
			canvasOf(flat).toBlob((blob) => {
				if (p.pageImage === flat) {
					p.pageUrl = URL.createObjectURL(blob);
				}
			}, "image/png");
		}
	}

	/** The lighting and cleaning a page is prepared with (0 … 1, 0 … 2). */
	const settingsOf = (p) => {
		const from = perPage.value ? p : { lighting, strength };
		const value = (x) => (perPage.value ? x : x.value);
		return {
			lighting: value(from.lighting) / 100,
			strength: value(from.strength) / 100,
		};
	};

	/** Flatten and clean a page inside its corners (latest call wins). */
	async function refreshPage(p) {
		const run = ++p.flattenRun;
		p.flattening = true;
		try {
			const flat = await flattenPage(p.image, p.quad, settingsOf(p));
			if (run === p.flattenRun) {
				setPageImage(p, flat);
			}
		} catch (e) {
			console.error(e);
			error.value = e.message;
		} finally {
			if (run === p.flattenRun) {
				p.flattening = false;
			}
		}
	}

	/** Refresh pages, one at a time (those still detecting come later). */
	async function refreshPages(list) {
		for (const p of list) {
			if (p.captureState !== "detecting") {
				await refreshPage(p);
			}
		}
	}

	/**
	 * A slider was released: apply the settings it shows (to the current
	 * page with perPage, else to every page).
	 */
	function applySettings() {
		const target = perPage.value ? page.value : null;
		const from = target ?? { evening: evening.value, cleaning: cleaning.value };
		const to = target ?? { lighting: lighting.value, strength: strength.value };
		if (to.lighting === from.evening && to.strength === from.cleaning) {
			return;
		}
		if (target) {
			target.lighting = from.evening;
			target.strength = from.cleaning;
		} else {
			lighting.value = from.evening;
			strength.value = from.cleaning;
		}
		resetResult();
		refreshPages(target ? [target] : pages.value);
	}

	/**
	 * Tick: each page starts from the shared settings. Untick: every page
	 * goes back to them (those that differed are prepared again).
	 */
	function setPerPage(on) {
		if (on === perPage.value) {
			return;
		}
		const differ = (p) =>
			p.lighting !== lighting.value || p.strength !== strength.value;
		const changed = on ? [] : pages.value.filter(differ);
		for (const p of pages.value) {
			p.evening = p.lighting = lighting.value;
			p.cleaning = p.strength = strength.value;
		}
		perPage.value = on;
		if (changed.length) {
			resetResult();
			refreshPages(changed);
		}
	}

	function onCornersCommit() {
		resetResult();
		refreshPage(page.value);
	}

	function resetCorners() {
		page.value.quad = page.value.detectedQuad;
		onCornersCommit();
	}

	function useWholePhoto() {
		const { width, height } = page.value.image;
		page.value.quad = fullQuad(width, height);
		onCornersCommit();
	}

	// ---------------------------------------------------------- recognition

	async function run() {
		if (!canRun.value) {
			return;
		}
		resetResult();
		const run = ++recognitionRun;
		const todo = [...pages.value];
		const n = todo.length;
		running.value = true;
		progress.value = { stage: "starting", ratio: 0 };
		try {
			const pageResults = [];
			let musicXml = "";
			for (const [k, p] of todo.entries()) {
				const read = await runPipeline(engineId.value, p.image, {
					page: k,
					count: n,
					quad: p.quad,
					...settingsOf(p),
					onProgress: (q) => {
						if (run === recognitionRun) {
							progress.value = {
								stage: n > 1 ? `Page ${k + 1}/${n} · ${q.stage}` : q.stage,
								ratio: (k + q.ratio) / n,
							};
						}
					},
				});
				if (run !== recognitionRun) {
					return; // stopped or restarted meanwhile
				}
				({ musicXml } = read);
				pageResults.push(read);
			}
			const score = await buildScore(pageResults, musicXml, {
				title: title.value,
				composer: composer.value,
			});
			if (run !== recognitionRun) {
				return;
			}
			result.value = markRaw(score);
			if (isApp) {
				await saveRecognized();
			}
		} catch (e) {
			if (run === recognitionRun) {
				console.error(e);
				error.value = e.message;
			}
		} finally {
			if (run === recognitionRun) {
				running.value = false;
				progress.value = null;
			}
		}
	}

	// ------------------------------------------------- saved scores (the app)
	//
	// In the app, the scores are kept (library.js) and listed on the main
	// menu: a score is saved when first recognized, then again after every
	// change (photos, corners, settings, title, edits…), and can be reopened
	// as it was. On the website there is one score, not kept.

	const screen = ref(isApp ? "menu" : "score"); // "menu" | "score"
	const docId = ref(null); // the saved score shown (null: not saved yet)
	const opening = ref(null); // the id of the score being opened
	let created = 0;
	let lastSaved = ""; // what was last saved (see savedForm)
	let savedPhotos = new Set(); // the pages whose photo is saved
	let thumb = null; // the first page, small (a JPEG Blob)
	let thumbOf = ""; // … of which page as prepared (see pageForm)

	const pageForm = (p) => ({
		key: p.key,
		quad: p.quad?.map(([x, y]) => [x, y]) ?? null,
		detectedQuad: p.detectedQuad?.map(([x, y]) => [x, y]) ?? null,
		captureState: p.captureState === "detecting" ? "not-found" : p.captureState,
		evening: p.evening,
		lighting: p.lighting,
		cleaning: p.cleaning,
		strength: p.strength,
	});

	/** The saved score's fields (but its dates and thumbnail). */
	const savedForm = () => ({
		title: title.value,
		composer: composer.value,
		pageCount: pages.value.length,
		recognized: result.value !== null,
		ops: JSON.parse(JSON.stringify(ops.value)),
		settings: {
			engineId: engineId.value,
			perPage: perPage.value,
			evening: evening.value,
			lighting: lighting.value,
			cleaning: cleaning.value,
			strength: strength.value,
		},
		pages: pages.value.map(pageForm),
	});

	/** The first page, small, when it changed (and is ready); else null. */
	async function newThumbnail() {
		const first = pages.value[0];
		const form = first && JSON.stringify([pageForm(first), perPage.value]);
		if (!first?.pageImage || first.flattening || form === thumbOf) {
			return null;
		}
		const big = canvasOf(first.pageImage);
		const canvas = document.createElement("canvas");
		canvas.width = 360;
		canvas.height = Math.round((360 * big.height) / big.width);
		canvas.getContext("2d").drawImage(big, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
		thumbOf = form;
		return blob;
	}

	let saving = Promise.resolve();
	let saveTimer = null;

	async function saveNow() {
		const id = docId.value;
		if (!id) {
			return;
		}
		const form = savedForm();
		const text = JSON.stringify(form);
		const newThumb = await newThumbnail();
		if (text === lastSaved && !newThumb) {
			return;
		}
		thumb = newThumb ?? thumb;
		const photos = new Map(
			pages.value
				.filter((p) => !savedPhotos.has(p.key) && p.photo)
				.map((p) => [p.key, p.photo]),
		);
		await putScore(
			{ id, created, updated: Date.now(), thumb, ...form },
			photos,
		);
		for (const key of photos.keys()) {
			savedPhotos.add(key);
		}
		if (!form.recognized && !running.value) {
			await deleteStates(id); // the recognition no longer matches
		}
		lastSaved = text;
	}

	/** Save the score (in turn after any save in progress). */
	function save() {
		clearTimeout(saveTimer);
		saveTimer = null;
		saving = saving.then(saveNow).catch((e) => {
			console.error(e);
			error.value = `Could not save the score: ${e.message}`;
		});
		return saving;
	}

	// saved shortly after any change
	watch(
		() =>
			docId.value && [JSON.stringify(savedForm()), pages.value[0]?.pageImage],
		(changed) => {
			if (changed) {
				clearTimeout(saveTimer);
				saveTimer = setTimeout(save, 500);
			}
		},
	);

	/** A recognition just finished: the score saved, with its recognition. */
	async function saveRecognized() {
		if (!docId.value) {
			docId.value = crypto.randomUUID();
			created = Date.now();
			keepStorage();
		}
		await save(); // after the saves before (which drop the old recognition)
		await saveRecognition(docId.value);
	}

	/** Back to an empty score (nothing kept: see closeScore). */
	function clearScore() {
		clearTimeout(saveTimer);
		saveTimer = null;
		docId.value = null;
		stop();
		for (const p of pages.value) {
			releasePage(p);
		}
		pages.value = [];
		currentIndex.value = 0;
		result.value = null;
		ops.value = [];
		error.value = null;
		title.value = "";
		composer.value = "";
		lastSaved = "";
		savedPhotos = new Set();
		thumb = null;
		thumbOf = "";
	}

	// the phone's Back button: from a score to the menu, from the menu out
	const showScore = () => {
		screen.value = "score";
	};
	if (isApp) {
		import("@capacitor/app").then(({ App }) =>
			App.addListener("backButton", () => {
				if (screen.value === "score") {
					closeScore();
				} else {
					App.exitApp();
				}
			}),
		);
	}

	/** Start a new score (from the menu). */
	function newScore() {
		clearScore();
		showScore();
	}

	/** Start a new score with these photos (Blobs) as its pages. */
	async function newScoreWith(photos) {
		newScore();
		addImages(await imagesFromPhotos(photos));
	}

	/**
	 * Saved score `id` as it is now (with its edits and credits), without
	 * opening it: { musicXml, name (for its files) }, or null when it is not
	 * recognized.
	 */
	async function savedMusicXml(id) {
		const score = await getScore(id);
		if (!score?.recognized) {
			return null;
		}
		const read = await restoreRecognition(id, score.ops);
		const name =
			score.title
				.trim()
				.replace(/[\\/:*?"<>|]+/g, "")
				.slice(0, 80) || "score";
		return {
			musicXml: withCredits(read.musicXml, score),
			name,
		};
	}

	/** Leave the score for the menu (it is saved first, if it was saved). */
	async function closeScore() {
		if (docId.value) {
			await save();
		}
		clearScore();
		screen.value = "menu";
	}

	/** Open saved score `id` as it was left. */
	async function openScore(id) {
		opening.value = id;
		error.value = null;
		try {
			clearScore();
			const [score, photos] = await Promise.all([getScore(id), getPhotos(id)]);
			if (!score) {
				throw new Error("This score was not found");
			}
			const restored = [];
			for (const p of score.pages) {
				const photo = photos.get(p.key);
				const bitmap = await createImageBitmap(photo);
				const image = imageFromSource(bitmap, bitmap.width, bitmap.height);
				bitmap.close();
				restored.push(
					reactive({
						...p,
						id: ++nextPageId,
						photo: markRaw(photo),
						image: markRaw(image),
						previewUrl: URL.createObjectURL(photo),
						pageImage: null,
						pageUrl: null,
						flattening: false,
						flattenRun: 0,
						captureError: null,
					}),
				);
			}
			const s = score.settings;
			engineId.value = s.engineId;
			perPage.value = s.perPage;
			evening.value = s.evening;
			lighting.value = s.lighting;
			cleaning.value = s.cleaning;
			strength.value = s.strength;
			title.value = score.title;
			composer.value = score.composer;
			pages.value = restored;
			if (score.recognized) {
				const read = await restoreRecognition(id, score.ops);
				ops.value = score.ops;
				result.value = markRaw(
					await buildScore(read.pages, read.musicXml, {
						title: title.value,
						composer: composer.value,
					}),
				);
			}
			docId.value = id;
			created = score.created;
			savedPhotos = new Set(score.pages.map((p) => p.key));
			thumb = score.thumb;
			thumbOf = restored[0]
				? JSON.stringify([pageForm(restored[0]), perPage.value])
				: "";
			lastSaved = JSON.stringify(savedForm());
			showScore();
			refreshPages(restored); // the pages prepared again, as they were
		} catch (e) {
			console.error(e);
			clearScore();
			error.value = `Could not open the score: ${e.message}`;
		} finally {
			opening.value = null;
		}
	}

	return reactive({
		screen,
		docId,
		opening,
		openScore,
		newScore,
		newScoreWith,
		savedMusicXml,
		closeScore,
		ops,
		engines,
		engineId,
		isApp,
		models,
		modelProgress,
		modelReady,
		downloadModel,
		removeModel,
		running,
		progress,
		error,
		result,
		title,
		composer,
		evening,
		lighting,
		cleaning,
		strength,
		perPage,
		setPerPage,
		applySettings,
		pages,
		currentIndex,
		page,
		canRun,
		stop,
		resetResult,
		addImages,
		removePage,
		movePage,
		selectPage,
		onCornersCommit,
		resetCorners,
		useWholePhoto,
		run,
	});
}
