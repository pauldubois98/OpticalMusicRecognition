<script setup>
// The app's home screen: the saved scores (see library.js), the latest
// changed first, each a card with its first page, title and date, and
// Share (MusicXML), Edit (open) and ⋮ (share as MIDI / PDF, rename,
// delete). The round button takes a photo for a new score (the small one
// beside it picks images instead); ⓘ shows the credits and licences.
import { Capacitor } from "@capacitor/core";
import { onBeforeUnmount, onMounted, ref } from "vue";
import logoUrl from "../../favicon.svg";
import { download } from "../download.js";
import { exportScore } from "../export.js";
import { deleteScore, listScores, renameScore } from "../library.js";
import { takeCameraPhoto } from "../photos.js";
import { musicXmlToMidi } from "../render/verovio.js";
import { useOmrState } from "../useOmr.js";
import AboutText from "./AboutText.vue";

const omr = useOmrState();
const scores = ref(null); // null: loading
const urls = new Map(); // id → its thumbnail's object URL
const sheet = ref(null); // null | "about" | { score } (its ⋮ menu)
const naming = ref(null); // the new title being typed (Rename)
const confirming = ref(false); // Delete asked once
const busy = ref(null); // the id of the score being shared
const starting = ref(false); // the camera app is open
const fileInput = ref(null);

const thumbUrl = (s) => {
	if (!s.thumb) {
		return null;
	}
	if (!urls.has(s.id)) {
		urls.set(s.id, URL.createObjectURL(s.thumb));
	}
	return urls.get(s.id);
};

const date = (t) =>
	new Date(t).toLocaleDateString(undefined, {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});

async function load() {
	try {
		scores.value = await listScores();
	} catch (e) {
		console.error(e);
		scores.value = [];
		omr.error = `Could not read the saved scores: ${e.message}`;
	}
}

function openMenu(score) {
	sheet.value = { score };
	naming.value = null;
	confirming.value = false;
}

const closeSheet = () => {
	sheet.value = null;
};

/** Share a saved score as MusicXML, MIDI or PDF, without opening it. */
async function share(s, format) {
	closeSheet();
	busy.value = s.id;
	omr.error = null;
	try {
		const file = await omr.savedMusicXml(s.id);
		if (!file) {
			throw new Error("recognize it first");
		}
		if (format === "musicxml") {
			await download(
				`${file.name}.musicxml`,
				new Blob([file.musicXml], {
					type: "application/vnd.recordare.musicxml+xml",
				}),
			);
		} else if (format === "midi") {
			const bytes = await musicXmlToMidi(file.musicXml);
			await download(
				`${file.name}.mid`,
				new Blob([bytes], { type: "audio/midi" }),
			);
		} else {
			await exportScore(file.musicXml, "pdf", file.name);
		}
	} catch (e) {
		console.error(e);
		omr.error = `Could not share the score: ${e.message}`;
	} finally {
		busy.value = null;
	}
}

async function rename(s) {
	const title = (naming.value ?? "").trim();
	closeSheet();
	try {
		await renameScore(s.id, title);
	} catch (e) {
		console.error(e);
		omr.error = `Could not rename the score: ${e.message}`;
	}
	await load();
}

async function remove(s) {
	closeSheet();
	try {
		await deleteScore(s.id);
	} catch (e) {
		console.error(e);
		omr.error = `Could not delete the score: ${e.message}`;
	}
	await load();
}

/** The round button: a photo with the phone's camera, as a new score. */
async function newFromCamera() {
	if (!Capacitor.isNativePlatform()) {
		fileInput.value?.click(); // (a browser: images instead)
		return;
	}
	starting.value = true;
	try {
		const photo = await takeCameraPhoto();
		if (photo) {
			await omr.newScoreWith([photo]);
		}
	} catch (e) {
		console.error(e);
		omr.error = `Camera unavailable: ${e?.message ?? e}`;
	} finally {
		starting.value = false;
	}
}

const byName = new Intl.Collator(undefined, { numeric: true }).compare;

/** Images picked, as a new score (in file-name order). */
async function newFromImages(event) {
	const files = [...(event.target.files ?? [])].sort((a, b) =>
		byName(a.name, b.name),
	);
	event.target.value = "";
	if (files.length) {
		await omr.newScoreWith(files);
	}
}

onMounted(load);
onBeforeUnmount(() => {
	for (const url of urls.values()) {
		URL.revokeObjectURL(url);
	}
});
</script>

<template>
	<div class="home">
		<header class="top">
			<img class="logo" :src="logoUrl" alt="" />
			<span class="name">MusicOCR</span>
			<button class="icon" title="About &amp; licences" aria-label="About and licences" @click="sheet = 'about'">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="9.5" />
					<path d="M12 11v6" />
					<circle class="dot" cx="12" cy="7.5" r="1.1" />
				</svg>
			</button>
		</header>

		<main>
			<p v-if="omr.error" class="error">{{ omr.error }}</p>
			<div v-if="scores && scores.length === 0" class="empty">
				<p>No scores yet.</p>
				<p class="hint">
					Take a photo of a page of printed music with the camera button
					below, or pick images. Everything stays on your phone.
				</p>
			</div>
			<ul v-if="scores?.length" class="list">
				<li v-for="s in scores" :key="s.id" class="card" :class="{ busy: omr.opening === s.id || busy === s.id }">
					<button
						class="thumb"
						:disabled="omr.opening !== null"
						:title="`Open ${s.title || 'Untitled'}`"
						@click="omr.openScore(s.id)"
					>
						<img v-if="thumbUrl(s)" :src="thumbUrl(s)" alt="" />
					</button>
					<div class="body">
						<button class="info" :disabled="omr.opening !== null" @click="omr.openScore(s.id)">
							<span class="title">{{ s.title || "Untitled" }}</span>
							<span v-if="s.composer" class="meta">{{ s.composer }}</span>
							<span class="meta">
								{{ date(s.updated) }} · {{ s.pageCount }} {{ s.pageCount === 1 ? "page" : "pages" }}
							</span>
							<span v-if="omr.opening === s.id" class="state">Opening…</span>
							<span v-else-if="busy === s.id" class="state">Preparing…</span>
							<span v-else-if="!s.recognized" class="state">Not recognized</span>
						</button>
						<div class="icons">
							<button
								class="icon"
								title="Share as MusicXML"
								aria-label="Share as MusicXML"
								:disabled="!s.recognized || busy !== null"
								@click="share(s, 'musicxml')"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<circle cx="18" cy="5" r="2.6" />
									<circle cx="6" cy="12" r="2.6" />
									<circle cx="18" cy="19" r="2.6" />
									<path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4" />
								</svg>
							</button>
							<button
								class="icon"
								title="Edit"
								aria-label="Edit"
								:disabled="omr.opening !== null"
								@click="omr.openScore(s.id)"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M4 20h4L19.5 8.5l-4-4L4 16z" />
									<path d="M13.5 6.5l4 4" />
								</svg>
							</button>
							<button class="icon" title="More" aria-label="More" @click="openMenu(s)">
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<circle class="dot" cx="12" cy="5" r="1.7" />
									<circle class="dot" cx="12" cy="12" r="1.7" />
									<circle class="dot" cx="12" cy="19" r="1.7" />
								</svg>
							</button>
						</div>
					</div>
				</li>
			</ul>
		</main>

		<div class="fabs">
			<button
				class="fab"
				title="New score from a photo"
				aria-label="New score from a photo"
				:disabled="starting || omr.opening !== null"
				@click="newFromCamera"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.5-2h5.4l1.5 2h3.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
					<circle cx="12" cy="13" r="3.6" />
				</svg>
			</button>
			<label class="fab small" title="New score from images" aria-label="New score from images">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
					<circle cx="9" cy="9.5" r="1.6" />
					<path d="M4 17l5-5 4 4 2.5-2.5L20 18" />
				</svg>
				<input ref="fileInput" type="file" accept="image/*" multiple @change="newFromImages" />
			</label>
		</div>

		<!-- a sheet from the bottom: the credits, or a score's ⋮ menu -->
		<div v-if="sheet" class="scrim" @click="closeSheet">
			<div class="sheet" role="dialog" @click.stop>
				<template v-if="sheet === 'about'">
					<h2>MusicOCR</h2>
					<p class="hint">
						Sheet music → MusicXML, entirely on your device: no image is
						ever uploaded.
					</p>
					<AboutText />
					<button class="secondary close" @click="closeSheet">Close</button>
				</template>
				<template v-else>
					<h2>{{ sheet.score.title || "Untitled" }}</h2>
					<template v-if="naming !== null">
						<input v-model="naming" class="rename" type="text" placeholder="Untitled" @keydown.enter="rename(sheet.score)" />
						<div class="row">
							<button @click="rename(sheet.score)">Save</button>
							<button class="secondary" @click="naming = null">Cancel</button>
						</div>
					</template>
					<template v-else-if="confirming">
						<p>Delete this score, its photos and edits? This cannot be undone.</p>
						<div class="row">
							<button class="danger" @click="remove(sheet.score)">Delete</button>
							<button class="secondary" @click="confirming = false">Keep</button>
						</div>
					</template>
					<div v-else class="items">
						<button class="item" :disabled="!sheet.score.recognized" @click="share(sheet.score, 'midi')">Share as MIDI</button>
						<button class="item" :disabled="!sheet.score.recognized" @click="share(sheet.score, 'pdf')">Share as PDF</button>
						<button class="item" @click="naming = sheet.score.title">Rename</button>
						<button class="item danger-text" @click="confirming = true">Delete…</button>
					</div>
				</template>
			</div>
		</div>
	</div>
</template>

<style scoped>
.home {
	min-height: 100dvh;
	padding-bottom: 7rem; /* the last card above the round button */
}

.top {
	position: sticky;
	top: 0;
	z-index: 5;
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: calc(0.6rem + env(safe-area-inset-top)) 0.75rem 0.6rem 1rem;
	background: var(--panel);
	border-bottom: 1px solid var(--border);
}

.logo {
	width: 2rem;
	height: 2rem;
}

.name {
	flex: 1;
	font-size: 1.25rem;
	font-weight: 600;
}

main {
	max-width: 720px;
	margin: 0 auto;
	padding: 0.75rem;
}

.empty {
	text-align: center;
	padding: 3rem 1rem;
}

.list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.card {
	display: grid;
	grid-template-columns: minmax(0, 36%) minmax(0, 1fr);
	gap: 1rem;
	padding: 0.75rem;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 10px;
}

.card.busy {
	opacity: 0.75;
}

.thumb {
	display: block;
	padding: 0;
	aspect-ratio: 0.8;
	background: #fff;
	border-radius: 2px;
	overflow: hidden;
}

.thumb img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	object-position: top;
}

.body {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	min-width: 0;
}

.info {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.3rem;
	padding: 0.25rem 0;
	background: none;
	color: var(--ink);
	text-align: left;
	min-width: 0;
}

.title {
	max-width: 100%;
	font-size: 1.15rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	max-width: 100%;
	color: var(--muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.state {
	font-size: 0.8rem;
	padding: 0.1rem 0.45rem;
	border-radius: 6px;
	background: var(--border);
	color: var(--ink);
}

.icons {
	display: flex;
	justify-content: space-around;
	align-items: center;
}

button.icon {
	display: grid;
	place-items: center;
	width: 2.75rem;
	height: 2.75rem;
	padding: 0;
	background: none;
	color: var(--muted);
	border-radius: 50%;
}

button.icon:not(:disabled):hover {
	background: var(--border);
}

svg {
	width: 1.5rem;
	height: 1.5rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.7;
	stroke-linecap: round;
	stroke-linejoin: round;
}

svg .dot {
	fill: currentColor;
	stroke: none;
}

.top button.icon {
	color: var(--ink);
}

/* the round buttons, at the bottom centre */
.fabs {
	position: fixed;
	left: 50%;
	bottom: calc(1.25rem + env(safe-area-inset-bottom));
	transform: translateX(-50%);
	z-index: 6;
	display: flex;
	align-items: center;
	gap: 1rem;
}

.fab {
	display: grid;
	place-items: center;
	width: 4.5rem;
	height: 4.5rem;
	padding: 0;
	border-radius: 50%;
	background: var(--accent);
	color: var(--accent-ink);
	box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
	cursor: pointer;
}

.fab svg {
	width: 2.1rem;
	height: 2.1rem;
}

.fab.small {
	/* beside the big one, the big one still in the middle */
	position: absolute;
	left: calc(100% + 1rem);
	width: 3.2rem;
	height: 3.2rem;
	background: var(--panel);
	color: var(--ink);
	border: 1px solid var(--border);
}

.fab.small svg {
	width: 1.5rem;
	height: 1.5rem;
}

/* the bottom sheet */
.scrim {
	position: fixed;
	inset: 0;
	z-index: 20;
	display: flex;
	align-items: flex-end;
	justify-content: center;
	background: rgb(0 0 0 / 0.45);
}

.sheet {
	width: 100%;
	max-width: 560px;
	max-height: 85dvh;
	overflow-y: auto;
	padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
	background: var(--panel);
	border-radius: 14px 14px 0 0;
}

.sheet h2 {
	margin: 0 0 0.75rem;
	font-size: 1.15rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.items {
	display: flex;
	flex-direction: column;
}

.item {
	padding: 0.9rem 0.25rem;
	background: none;
	color: var(--ink);
	text-align: left;
	border-radius: 0;
	border-bottom: 1px solid var(--border);
	font-size: 1rem;
}

.item:last-child {
	border-bottom: none;
}

.danger-text {
	color: #d9534f;
}

.danger {
	background: #b3372f;
	color: #fff;
}

.rename {
	width: 100%;
	margin-bottom: 0.75rem;
	padding: 0.6rem;
	font-size: 1rem;
	background: var(--bg);
	color: var(--ink);
	border: 1px solid var(--border);
	border-radius: 8px;
}

.close {
	margin-top: 0.5rem;
}
</style>
