<script setup>
// The app's main menu: the saved scores (see library.js), the latest changed
// first, each as its first page; open one, delete one, or start a new one.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { deleteScore, listScores } from "../library.js";
import { useOmrState } from "../useOmr.js";

const omr = useOmrState();
const scores = ref(null); // null: loading
const urls = new Map(); // id → its thumbnail's object URL
const confirming = ref(null); // the id whose deletion is asked

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
		day: "numeric",
		month: "short",
		year:
			new Date(t).getFullYear() === new Date().getFullYear()
				? undefined
				: "numeric",
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

async function remove(id) {
	confirming.value = null;
	try {
		await deleteScore(id);
	} catch (e) {
		console.error(e);
		omr.error = `Could not delete the score: ${e.message}`;
	}
	await load();
}

onMounted(load);
onBeforeUnmount(() => {
	for (const url of urls.values()) {
		URL.revokeObjectURL(url);
	}
});
</script>

<template>
	<section class="library">
		<button class="new" @click="omr.newScore">+ New score</button>
		<p v-if="omr.error" class="error">{{ omr.error }}</p>
		<p v-if="scores && scores.length === 0" class="hint">
			Your scores will be listed here: start with a photo of a page of
			printed music.
		</p>
		<ul v-if="scores?.length" class="grid">
			<li v-for="s in scores" :key="s.id" class="card" :class="{ busy: omr.opening === s.id }">
				<button
					class="open"
					:disabled="omr.opening !== null"
					:title="`Open ${s.title || 'Untitled'}`"
					@click="omr.openScore(s.id)"
				>
					<span class="thumb">
						<img v-if="thumbUrl(s)" :src="thumbUrl(s)" alt="" />
						<span v-if="omr.opening === s.id" class="opening">Opening…</span>
						<span v-else-if="!s.recognized" class="badge">Not recognized</span>
					</span>
					<span class="title">{{ s.title || "Untitled" }}</span>
					<span class="meta">{{ s.composer || "—" }}</span>
					<span class="meta">
						{{ date(s.updated) }} · {{ s.pageCount }} {{ s.pageCount === 1 ? "page" : "pages" }}
					</span>
				</button>
				<div class="actions">
					<template v-if="confirming === s.id">
						<button class="danger" @click="remove(s.id)">Delete</button>
						<button class="secondary" @click="confirming = null">Keep</button>
					</template>
					<button
						v-else
						class="secondary"
						:disabled="omr.opening !== null"
						:title="`Delete ${s.title || 'Untitled'}`"
						@click="confirming = s.id"
					>
						Delete…
					</button>
				</div>
			</li>
		</ul>
	</section>
</template>

<style scoped>
.new {
	font-size: 1.05rem;
	padding: 0.75rem 1.4rem;
	margin-bottom: 1rem;
}

.grid {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 1rem;
}

.card {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	min-width: 0;
}

.card.busy {
	opacity: 0.7;
}

.open {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 0.15rem;
	padding: 0;
	background: none;
	color: var(--ink);
	text-align: left;
	border-radius: 8px;
}

.thumb {
	position: relative;
	display: block;
	aspect-ratio: 0.71;
	background: #fff;
	border: 1px solid var(--border);
	border-radius: 8px;
	overflow: hidden;
	margin-bottom: 0.3rem;
}

.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	object-position: top;
}

.opening,
.badge {
	position: absolute;
	inset: auto 0.4rem 0.4rem;
	padding: 0.2rem 0.4rem;
	border-radius: 6px;
	font-size: 0.75rem;
	text-align: center;
	background: rgb(0 0 0 / 0.65);
	color: #fff;
}

.opening {
	inset: 45% 0.4rem auto;
}

.title {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	color: var(--muted);
	font-size: 0.85rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	display: flex;
	gap: 0.4rem;
}

.actions button {
	padding: 0.35rem 0.7rem;
	font-size: 0.85rem;
}

.danger {
	background: #b3372f;
	color: #fff;
}

@media (max-width: 640px) {
	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
}
</style>
