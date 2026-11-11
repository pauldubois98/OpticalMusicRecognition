<script setup>
// What MusicOCR is made of, and the licences (Verovio's LGPL asks for the
// notice): in the website's footer and the app's ⓘ sheet.
</script>

<template>
	<div class="about-text">
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
			<li>ONNX Runtime Web, Vue, jsPDF, svg2pdf.js, Capacitor, coi-serviceworker (MIT)</li>
		</ul>
	</div>
</template>

<style scoped>
.about-text a {
	color: var(--accent);
}

.about-text ul {
	padding-left: 1.2rem;
}
</style>
