// Recognition Web Worker: runs the heavy work off the main thread so the UI
// stays responsive. One message in ({ id, task, ... }), progress and result
// messages out. ONNX sessions stay cached across runs.
//   task "detect":     { image }            → corners (TL, TR, BR, BL) or null
//   task "flatten":    { image, quad, strength, lighting } → the flattened, cleaned page
//   task "recognize":  { size, image, page, count, quad?, strength?, lighting? }
//                      → page `page` (of `count`) read: { summary, symbols,
//                      staves, musicXml } (with a quad, the page inside it is
//                      flattened and cleaned first with those settings, see
//                      capture/index.js)
//   task "has-models" / "fetch-models" / "remove-models": { size } → whether
//                      that detector's files are at hand / download them /
//                      remove the downloaded ones (see engine.js)
//   task "save":       { scoreId } → the last recognition's pages stored as
//                      score `scoreId` (see library.js; they never leave the worker)
//   task "restore":    { scoreId, ops } → score `scoreId`'s stored recognition made the
//                      current one, with its hand edits applied: { pages
//                      (each page's result, as "recognize"), musicXml }
//   task "edit":       { page, ops } → that page with hand edits applied
//                      (see edit.js), same shape
// `musicXml` is always the whole score: the pages read so far, joined (see
// join.js).

import { getStates, putStates } from "../library.js";
import { flattenAndClean } from "./capture/index.js";
import { xmlDocument } from "./copisteria/write.js";
import {
	describeError,
	detectPage,
	editRecognition,
	fetchModels,
	hasModels,
	recognize,
	removeModels,
	reviveState,
	storedState,
} from "./engine.js";
import { joinTrees } from "./join.js";

let current = null; // the run in progress, for errors raised outside it
// the pages of the last recognition: { state (for edits), tree (to join) }
let pages = [];
let edits = Promise.resolve(); // edits run one at a time, in order

const fail = (id, error) => {
	console.error(error);
	self.postMessage({ id, type: "error", message: describeError(error) });
};

// Errors thrown asynchronously by the runtime (outside the awaited chain)
self.addEventListener("unhandledrejection", (event) => {
	event.preventDefault();
	fail(current, event.reason);
});

/** Keep a page's reading; its result, with the whole score's MusicXML. */
function withScore(index, state, { tree, musicXml: _, ...result }) {
	pages[index] = { state, tree };
	const trees = pages.filter(Boolean).map((p) => p.tree);
	return { ...result, musicXml: xmlDocument(joinTrees(trees)) };
}

async function run(message, onProgress) {
	switch (message.task) {
		case "detect":
			return detectPage(message.image, { onProgress });
		case "flatten":
			return flattenAndClean(message.image, message.quad, {
				strength: message.strength,
				lighting: message.lighting,
			});
		case "recognize": {
			const page = message.quad
				? flattenAndClean(message.image, message.quad, {
						strength: message.strength ?? 0,
						lighting: message.lighting ?? 1,
					})
				: message.image;
			if (message.page === 0) {
				pages = new Array(message.count).fill(null);
			}
			pages[message.page] = null;
			const { state, ...result } = await recognize(message.size, page, {
				page: message.page,
				onProgress,
			});
			return withScore(message.page, state, result);
		}
		case "edit": {
			const run = edits.then(async () => {
				const state = pages[message.page]?.state;
				if (!state) {
					throw new Error("Nothing to edit: recognize the pages again");
				}
				const result = await editRecognition(state, message.ops, {
					onProgress,
				});
				return withScore(message.page, state, result);
			});
			edits = run.catch(() => {});
			return run;
		}
		case "save":
			if (pages.length === 0 || pages.some((p) => !p)) {
				throw new Error("Nothing to save: no complete recognition");
			}
			return putStates(
				message.scoreId,
				pages.map((p) => storedState(p.state)),
			);
		case "restore": {
			const states = await getStates(message.scoreId);
			if (!states?.length) {
				throw new Error("This score's recognition was not found");
			}
			pages = new Array(states.length).fill(null);
			const results = [];
			let musicXml = "";
			for (const [k, state] of states.entries()) {
				reviveState(state);
				const result = await editRecognition(
					state,
					message.ops.filter((op) => op.page === k),
				);
				const page = withScore(k, state, result);
				results.push(page);
				({ musicXml } = page);
			}
			return { pages: results, musicXml };
		}
		case "has-models":
			return hasModels(message.size);
		case "fetch-models":
			return fetchModels(message.size, { onProgress });
		case "remove-models":
			return removeModels(message.size);
		default:
			throw new Error(`unknown task ${message.task}`);
	}
}

self.onmessage = async (event) => {
	const { id } = event.data;
	current = id;
	const post = (message, transfer) =>
		self.postMessage({ id, ...message }, transfer ?? []);
	try {
		const result = await run(event.data, (progress) =>
			post({ type: "progress", progress }),
		);
		// pixels are moved, not copied
		const pixels = result?.data instanceof Uint8ClampedArray;
		post({ type: "result", result }, pixels ? [result.data.buffer] : []);
	} catch (error) {
		fail(id, error);
	}
};
