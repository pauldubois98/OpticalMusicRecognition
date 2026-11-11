// The saved scores, in the browser's / app's own database (IndexedDB: on the
// device, never uploaded). Three stores:
//   scores  id → { id, created, updated, title, composer, pageCount, thumb
//                  (a small JPEG of the first page), recognized, ops (the
//                  hand edits, see pipeline/edit.js), settings (engineId,
//                  perPage, evening, lighting, cleaning, strength), pages
//                  ([{ key, quad, detectedQuad, captureState, evening,
//                  lighting, cleaning, strength }], in order) }
//   photos  "<id>/<page key>" → the page's photo, as it was added (a Blob)
//   states  id → the recognition, per page (the worker's states, see
//                  pipeline/engine.js recognize): written and read by the
//                  recognition worker, so it is never copied to the page
// Usable from the page and from the worker (no DOM).

const DB_NAME = "musicocr";
const DB_VERSION = 1;
const STORES = ["scores", "photos", "states"];

let dbPromise = null;

function openDb() {
	dbPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			for (const name of STORES) {
				if (!db.objectStoreNames.contains(name)) {
					db.createObjectStore(name);
				}
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}).catch((error) => {
		dbPromise = null;
		throw error;
	});
	return dbPromise;
}

const done = (request) =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

/** Run `work(stores)` in one transaction over `names`; its result. */
async function transaction(names, mode, work) {
	const db = await openDb();
	const tx = db.transaction(names, mode);
	const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
	const result = await work(stores);
	await new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("Save aborted"));
	});
	return result;
}

export const photoKey = (id, pageKey) => `${id}/${pageKey}`;

/** All the saved scores, the latest changed first. */
export async function listScores() {
	const all = await transaction(["scores"], "readonly", (s) =>
		done(s.scores.getAll()),
	);
	return all.sort((a, b) => b.updated - a.updated);
}

export function getScore(id) {
	return transaction(["scores"], "readonly", (s) => done(s.scores.get(id)));
}

/**
 * Save a score's record, with the photos it does not have yet (`photos`:
 * page key → Blob), and remove those of pages it no longer has.
 */
export function putScore(score, photos = new Map()) {
	return transaction(["scores", "photos"], "readwrite", async (s) => {
		for (const [pageKey, blob] of photos) {
			s.photos.put(blob, photoKey(score.id, pageKey));
		}
		const keep = new Set(score.pages.map((p) => photoKey(score.id, p.key)));
		const range = IDBKeyRange.bound(`${score.id}/`, `${score.id}/￿`);
		for (const key of await done(s.photos.getAllKeys(range))) {
			if (!keep.has(key)) {
				s.photos.delete(key);
			}
		}
		s.scores.put(score, score.id);
	});
}

/** A score's photos, by page key. */
export function getPhotos(id) {
	return transaction(["photos"], "readonly", async (s) => {
		const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
		const [keys, blobs] = await Promise.all([
			done(s.photos.getAllKeys(range)),
			done(s.photos.getAll(range)),
		]);
		return new Map(keys.map((k, i) => [k.slice(id.length + 1), blobs[i]]));
	});
}

export function putStates(id, states) {
	return transaction(["states"], "readwrite", (s) => {
		s.states.put(states, id);
	});
}

export function getStates(id) {
	return transaction(["states"], "readonly", (s) => done(s.states.get(id)));
}

export function deleteStates(id) {
	return transaction(["states"], "readwrite", (s) => {
		s.states.delete(id);
	});
}

/** Delete a score: its record, photos and recognition. */
export function deleteScore(id) {
	return transaction(STORES, "readwrite", (s) => {
		s.scores.delete(id);
		s.states.delete(id);
		s.photos.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
	});
}

/**
 * Ask the browser to keep the scores (not to clear them by itself when the
 * disk runs low); best effort.
 */
export async function keepStorage() {
	try {
		if (!(await navigator.storage?.persisted?.())) {
			await navigator.storage?.persist?.();
		}
	} catch {
		// not offered: the scores are kept as long as the browser allows
	}
}
