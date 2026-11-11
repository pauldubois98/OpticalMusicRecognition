<script setup>
// The recognizer, Recognize / Restart / Stop, and the progress.
import { useOmrState } from "../useOmr.js";

const omr = useOmrState();
</script>

<template>
	<div class="recognize-controls">
		<div class="row">
			<select v-model="omr.engineId" aria-label="Recognizer">
				<option v-for="engine in omr.engines" :key="engine.id" :value="engine.id">
					{{ engine.name }}
				</option>
			</select>
			<button :disabled="!omr.canRun" @click="omr.run">
				{{ omr.running ? "Restart" : "Recognize" }}{{
					omr.pages.length > 1 ? ` ${omr.pages.length} pages` : ""
				}}
			</button>
			<button v-if="omr.running" class="secondary" @click="omr.stop">Stop</button>
		</div>
		<!-- in the app: the high-accuracy models are an optional download -->
		<div v-if="omr.isApp && omr.models[omr.engineId] !== undefined && omr.engineId !== '2m'" class="row model">
			<template v-if="omr.models[omr.engineId] === 'ready'">
				<span class="hint">Downloaded: works offline.</span>
				<button class="secondary" @click="omr.removeModel(omr.engineId)">
					Remove (frees 115 MB)
				</button>
			</template>
			<template v-else>
				<span class="hint">Not in the app: a 115 MB download, kept for offline use.</span>
				<button
					:disabled="omr.models[omr.engineId] === 'downloading'"
					@click="omr.downloadModel(omr.engineId)"
				>
					{{ omr.models[omr.engineId] === "downloading" ? "Downloading…" : "Download" }}
				</button>
			</template>
		</div>
		<template v-if="omr.modelProgress">
			<div class="progress">
				<div :style="{ width: `${Math.round(omr.modelProgress.ratio * 100)}%` }"></div>
			</div>
			<p class="progress-label">{{ omr.modelProgress.stage }}</p>
		</template>
		<template v-if="omr.progress">
			<div class="progress">
				<div :style="{ width: `${Math.round(omr.progress.ratio * 100)}%` }"></div>
			</div>
			<p class="progress-label">{{ omr.progress.stage }}</p>
		</template>
		<p v-if="omr.error" class="error">{{ omr.error }}</p>
	</div>
</template>

<style scoped>
.model {
	margin-top: 0.5rem;
}

.model .hint {
	flex: 1 1 14rem;
}
</style>
