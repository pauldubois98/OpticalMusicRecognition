<script setup>
// The header, the steps, and the credits. The state is shared through "omr"
// (useOmr.js).
import { provide } from "vue";
import ScoreLibrary from "./components/ScoreLibrary.vue";
import StepTabs from "./components/StepTabs.vue";
import { isApp } from "./pipeline/index.js";
import { useOmr } from "./useOmr.js";

const omr = useOmr();
provide("omr", omr);
</script>

<template>
	<div class="app">
		<header>
			<h1>🎼 MusicOCR</h1>
			<p>
				<template v-if="isApp">
					Sheet music → MusicXML, entirely on your device: no image is ever
					uploaded.
				</template>
				<template v-else>
					Sheet music → MusicXML, entirely in your browser. No image ever
					leaves your device.
				</template>
			</p>
		</header>
		<!-- the app: the main menu (the saved scores), or a score -->
		<ScoreLibrary v-if="omr.screen === 'menu'" />
		<template v-else>
			<div v-if="isApp" class="back">
				<button class="secondary" @click="omr.closeScore">← My scores</button>
				<span v-if="!omr.docId" class="hint">Saved once recognized</span>
			</div>
			<StepTabs />
		</template>
		<!-- the licences' notices (Verovio's LGPL asks for it in the app) -->
		<footer>
			<details>
				<summary>About &amp; licences</summary>
				<p>
					MusicOCR is free software under the MIT licence:
					<a href="https://github.com/pauldubois98/OpticalMusicRecognition" target="_blank" rel="noopener">source code</a>.
				</p>
				<ul>
					<li>
						Recognition: a port of
						<a href="https://github.com/kobimusic/copisteria" target="_blank" rel="noopener">copisteria</a>
						and the copista models by KobiMusic (Apache-2.0)
					</li>
					<li>
						Page detection:
						<a href="https://github.com/DocsaidLab/DocAligner" target="_blank" rel="noopener">DocAligner</a>
						(Apache-2.0)
					</li>
					<li>
						Score rendering and MIDI:
						<a href="https://github.com/rism-digital/verovio" target="_blank" rel="noopener">Verovio</a>
						(LGPL-3.0; its source and licence are at that link)
					</li>
					<li>
						ONNX Runtime Web, Vue, jsPDF, svg2pdf.js, Capacitor, coi-serviceworker (MIT)
					</li>
				</ul>
			</details>
		</footer>
	</div>
</template>

<style scoped>
.back {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	margin-bottom: 0.75rem;
}

footer {
	margin-top: 2rem;
	color: var(--muted);
	font-size: 0.85rem;
}

footer summary {
	cursor: pointer;
}

footer a {
	color: var(--accent);
}
</style>
