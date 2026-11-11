<script setup>
// The header, the steps, and the credits. The state is shared through "omr"
// (useOmr.js).
import { provide } from "vue";
import StepTabs from "./components/StepTabs.vue";
import { isApp } from "./pipeline/index.js";
import { useOmr } from "./useOmr.js";

provide("omr", useOmr());
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
		<StepTabs />
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
