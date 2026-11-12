<script setup>
// The recognized score, editable: a note or rest picked on the score (click,
// or ← → from one to the next) can have its pitch, value, dots and accidental
// changed, become a rest / a note, or be deleted; missed notes and rests are
// added on their page. Ties and slurs (phrase marks are slurs) are picked
// the same way: they can be deleted, moved to the previous / next note at
// either end, or switch between tie and slur; missed ones are added from a
// note ("+ Tie", "+ Slur to…"). Crescendos and diminuendos (hairpins) too:
// deleted, switched, their ends moved along the notes, added from a note
// ("+ Cresc. to…", "+ Dim. to…"). Dynamics (p, mf, …) as well: changed,
// moved to another note, deleted, or added at a note. Edits are a list of operations (see
// pipeline/edit.js), each on a page, replayed by the recognition worker on its reading of that
// page, so undo and redo are one operation less or more. Hovering a note
// shows it on its page. The title and composer are shown above the score.
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	shallowRef,
	watch,
} from "vue";
import { download } from "../download.js";
import { TIMES } from "../pipeline/copisteria/vocab.js";
import {
	addedDynamicRef,
	addedHairpinRef,
	addedSpanRef,
} from "../pipeline/edit.js";
import { editRecognition } from "../pipeline/index.js";
import { addedDet, boxKey, VALUES } from "../pipeline/place.js";
import { musicXmlToMidi } from "../render/verovio.js";
import {
	buildScore,
	GROUP_SYMBOLS,
	measureMeters,
	partGroups,
	scoreKey,
	staffClefs,
	partStaves as stavesOfParts,
} from "../score.js";
import { useOmrState } from "../useOmr.js";
import AddSymbols from "./AddSymbols.vue";
import ExportButtons from "./ExportButtons.vue";
import PageHighlight from "./PageHighlight.vue";

const props = defineProps({
	// the recognition (see score.js buildScore)
	initial: { type: Object, required: true },
	// the pages as recognized, in order: { url, width, height }
	pages: { type: Array, required: true },
	active: { type: Boolean, default: true }, // shown (keys act on it)
});

const omr = useOmrState();
const credits = () => ({
	title: omr.title,
	composer: omr.composer,
	parts: omr.partNames,
	groups: omr.partGroups,
});

const result = shallowRef(props.initial);
// the hand edits (kept in the shared state too: a saved score keeps them)
const ops = shallowRef(omr.ops ?? []);
watch(ops, (v) => {
	omr.ops = v;
});
const undone = shallowRef([]); // for redo, the last undone last
const editing = ref(false);
const editProgress = ref(null);
const editError = ref(null);
const unplaced = ref(0);
const adding = ref(false);
const addCls = ref("note_quarter");
const addPage = ref(0);
const pageOf = (i) => props.pages[i] ?? null;
const canAdd = computed(() => props.pages.some((p) => p.url));

const hoveredId = ref(null);

// the score's zoom (1: its width fits; else wider, scrolled sideways): larger
// on a phone, where the fitted notes are too small to tap
const ZOOMS = [1, 1.25, 1.5, 2, 3];
const phone = () => window.matchMedia?.("(max-width: 640px)").matches ?? false;
const zoom = ref(phone() ? 2 : 1);
const zoomBy = (step) => {
	const i = ZOOMS.indexOf(zoom.value) + step;
	zoom.value = ZOOMS[Math.min(Math.max(i, 0), ZOOMS.length - 1)];
};
const selectedKey = ref(null); // symbols are named by their page and box
const scoreEl = ref(null);

const byId = computed(
	() => new Map(result.value.symbols.map((s) => [s.id, s])),
);
const byKey = computed(
	() => new Map(result.value.symbols.map((s) => [s.key, s])),
);
const selected = computed(() => byKey.value.get(selectedKey.value) ?? null);
const shown = computed(
	() => byId.value.get(hoveredId.value) ?? selected.value ?? null,
);
const isNote = computed(() => selected.value?.family === "note");
const isCurve = computed(() => selected.value?.family === "curve");
const isHairpin = computed(() => selected.value?.family === "hairpin");
// a tie, slur or hairpin: from one note to another
const isSpan = computed(() => isCurve.value || isHairpin.value);
const SPAN_FAMILIES = new Set(["curve", "hairpin"]);
const isDynamic = computed(() => selected.value?.family === "dynamic");
// the page shown beside the score: the hovered / selected note's (else the
// last one shown)
const lastPage = ref(0);
const shownPage = computed(() => shown.value?.page ?? lastPage.value);
watch(shownPage, (p) => {
	lastPage.value = p;
});
const highlightPage = computed(() => pageOf(shownPage.value));
const value = (s) => s.cls.split("_")[1];

// ---------------------------------------------------------------- editing

let editRun = 0;
// the pages' latest results: an edit superseded before it is shown still
// changed its page (the worker applies them all, in order)
let latest = [...props.initial.pageResults];

// an edit is on a page (op.page), or on the whole score (op.page null: a
// clef or key, see pipeline/edit.js)
const opsOf = (page) =>
	ops.value.filter((op) => op.page === page || op.page === null);
const pagesOf = (op) =>
	op.page === null ? latest.map((_, i) => i) : [op.page];

/**
 * Replay all the edits of the pages `pages`; then select `select` (a
 * symbol's key), if given.
 */
async function replay(pages, select = null) {
	const run = ++editRun;
	editing.value = true;
	editError.value = null;
	try {
		let musicXml = null;
		for (const page of pages) {
			const next = await editRecognition(page, opsOf(page), {
				onProgress: (p) => {
					if (run === editRun) {
						editProgress.value = p;
					}
				},
			});
			latest = latest.map((r, i) => (i === page ? next : r));
			({ musicXml } = next);
		}
		if (run !== editRun || musicXml === null) {
			return; // a later edit supersedes this one
		}
		const score = await buildScore(latest, musicXml, credits());
		if (run !== editRun) {
			return;
		}
		result.value = score;
		unplaced.value = score.unplaced;
		if (select !== null) {
			selectedKey.value = select;
		}
	} catch (e) {
		if (run === editRun) {
			console.error(e);
			editError.value = e.message;
		}
	} finally {
		if (run === editRun) {
			editing.value = false;
			editProgress.value = null;
			if (creditsChanged) {
				showCredits();
			}
		}
	}
}

// the title or composer changed: the score again, with them (after the edit
// in progress, if any)
let creditsChanged = false;
async function showCredits() {
	if (editing.value) {
		creditsChanged = true;
		return;
	}
	creditsChanged = false;
	const run = ++editRun;
	try {
		const score = await buildScore(latest, result.value.musicXml, credits());
		if (run === editRun) {
			result.value = score;
		}
	} catch (e) {
		if (run === editRun) {
			console.error(e);
			editError.value = e.message;
		}
	}
}
watch(
	() => [
		omr.title,
		omr.composer,
		JSON.stringify(omr.partNames),
		JSON.stringify(omr.partGroups),
	],
	showCredits,
);

// ------------------------------------------------------------ part names
//
// A part's name, at the left of its first system ("Part 1"…), picked on the
// score: Verovio draws the names apart from their staves, so a name is its
// part's by height (the part whose staves it is level with).

const selectedPart = ref(null); // the part picked (0, 1, …), or null
const partDraft = ref("");

/** How many staves each part has, in order (from the score). */
const partStaves = computed(() => stavesOfParts(result.value.musicXml));

/**
 * Where parts first … last are on the system of `el` (a name or bracket
 * drawn there): their staves' top and bottom on the screen, or null.
 */
function partsSpan(el, first, last) {
	const staves = [
		...(el.parentElement
			?.querySelector(".measure")
			?.querySelectorAll(":scope > .staff") ?? []),
	];
	const from = partStaves.value.slice(0, first).reduce((a, b) => a + b, 0);
	const to =
		from +
		partStaves.value.slice(first, last + 1).reduce((a, b) => a + b, 0) -
		1;
	if (!staves[from] || !staves[to]) {
		return null;
	}
	return {
		top: staves[from].getBoundingClientRect().top,
		bottom: staves[to].getBoundingClientRect().bottom,
	};
}

/** The part a name (a "label" element of the score) belongs to. */
function partOfLabel(label) {
	const box = label.getBoundingClientRect();
	const y = (box.top + box.bottom) / 2;
	let best = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	partStaves.value.forEach((_, k) => {
		const span = partsSpan(label, k, k);
		if (span) {
			const d =
				y < span.top ? span.top - y : y > span.bottom ? y - span.bottom : 0;
			if (d < bestDistance) {
				bestDistance = d;
				best = k;
			}
		}
	});
	return best;
}

// ---------------------------------------------------------------- brackets
//
// The brackets and braces at the left of the systems (see score.js
// partGroups): picked on the score (by height, as the names), or from a
// part's panel (those drawn as nothing too); their shape, the parts they
// join and their bar lines edited, or deleted; new ones added from a part.

const groups = computed(() => partGroups(result.value.musicXml));
const groupKey = (g) => `${g.first}-${g.last}`;
const selectedGroupKey = ref(null);
const selectedGroup = computed(
	() =>
		groups.value.find((g) => groupKey(g) === selectedGroupKey.value) ?? null,
);
const SYMBOL_NAMES = {
	brace: "Brace",
	bracket: "Bracket",
	square: "Square",
	line: "Line",
	none: "None",
};
const partsName = (g) =>
	g.first === g.last
		? `part ${g.first + 1}`
		: `parts ${g.first + 1}–${g.last + 1}`;

/** The group a bracket drawn on the score (a "grpSym" element) shows. */
function groupOfSym(el) {
	const box = el.getBoundingClientRect();
	let best = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const g of groups.value) {
		const span = partsSpan(el, g.first, g.last);
		if (span) {
			const d =
				Math.abs(span.top - box.top) + Math.abs(span.bottom - box.bottom);
			if (d < bestDistance) {
				bestDistance = d;
				best = g;
			}
		}
	}
	return best;
}

/**
 * The bracket drawn at a click, if any: thin ones (a line, a brace's
 * strokes) are hard to hit, so a little to either side counts too.
 */
function bracketAt({ target, clientX: x, clientY: y, pointerType }) {
	const hit = target?.closest?.(".grpSym");
	if (hit) {
		return hit;
	}
	// a name hit wins over a bracket near it, and so does a nearer clef or key
	if (target?.closest?.(".label")) {
		return null;
	}
	const clef = clefAt({ target, clientX: x, clientY: y, pointerType });
	const margin = pointerType === "touch" ? 16 : 8;
	for (const el of scoreEl.value?.querySelectorAll(".grpSym") ?? []) {
		const r = el.getBoundingClientRect();
		const dx = Math.max(r.left - x, 0, x - r.right);
		if (
			dx <= margin &&
			y >= r.top &&
			y <= r.bottom &&
			!(clef && clef.distance <= dx)
		) {
			return el;
		}
	}
	return null;
}

function pickGroup(g) {
	selectedKey.value = null;
	selectedPart.value = null;
	selectedStaff.value = null;
	selectedClefKey.value = null;
	selectedMeter.value = null;
	selectedGroupKey.value = g ? groupKey(g) : null;
}

/** The brackets edited: `change` maps the list (copies) to the new one. */
function editGroups(change) {
	omr.partGroups = change(groups.value.map((g) => ({ ...g })));
}

function setGroup(field, value) {
	const key = selectedGroupKey.value;
	editGroups((list) =>
		list.map((g) => (groupKey(g) === key ? { ...g, [field]: value } : g)),
	);
}

/** Whether the selected bracket's top ("first") or bottom ("last") can move. */
function canMoveGroup(end, step) {
	const g = selectedGroup.value;
	if (!g) {
		return false;
	}
	const moved = { ...g, [end]: g[end] + step };
	return (
		moved.first >= 0 &&
		moved.last < partStaves.value.length &&
		moved.first <= moved.last &&
		!groups.value.some((x) => groupKey(x) === groupKey(moved))
	);
}

/** Move the selected bracket's top ("first") or bottom ("last") a part. */
function moveGroupEnd(end, step) {
	const g = selectedGroup.value;
	if (!canMoveGroup(end, step)) {
		return;
	}
	const moved = { ...g, [end]: g[end] + step };
	const key = groupKey(g);
	editGroups((list) => list.map((x) => (groupKey(x) === key ? moved : x)));
	selectedGroupKey.value = groupKey(moved);
}

/**
 * Delete the selected bracket (a part of several staves keeps a group of
 * its own, drawn as nothing: else it would show its brace again).
 */
function deleteGroup() {
	const g = selectedGroup.value;
	if (!g) {
		return;
	}
	const key = groupKey(g);
	const own = g.first === g.last && partStaves.value[g.first] > 1;
	editGroups((list) =>
		own
			? list.map((x) => (groupKey(x) === key ? { ...x, symbol: "none" } : x))
			: list.filter((x) => groupKey(x) !== key),
	);
	if (!own) {
		selectedGroupKey.value = null;
	}
}

/** A new bracket around part k (to be stretched over the next ones). */
function addGroup(k) {
	const g = { first: k, last: k, symbol: "bracket", barline: true };
	if (!groups.value.some((x) => groupKey(x) === groupKey(g))) {
		editGroups((list) => [...list, g]);
	}
	pickGroup(g);
}

/** The brackets part k is in (for its panel). */
const partGroupsOf = (k) =>
	groups.value.filter((g) => g.first <= k && k <= g.last);

// ------------------------------------------------------- clefs and key
//
// A clef or key signature at the start of a system picks its staff: its
// clef is set for the whole score (that staff, see pipeline/edit.js), and
// the key too (all staves). A clef within a bar (a clef change) is picked
// on its own: changed or deleted.

const CLEF_CHOICES = [
	["G2", "Treble"],
	["F4", "Bass"],
	["C3", "Alto"],
	["C4", "Tenor"],
	["G2_8b", "Treble 8vb"],
];
const MORE_CLEFS = [
	["C1", "Soprano (C1)"],
	["C2", "Mezzo-soprano (C2)"],
	["C5", "Baritone (C5)"],
	["F3", "Baritone (F3)"],
	["F5", "Sub-bass (F5)"],
	["G1", "French violin (G1)"],
	["G2_8a", "Treble 8va"],
	["G2_15b", "Treble 15mb"],
	["G2_15a", "Treble 15ma"],
	["F4_8b", "Bass 8vb"],
	["F4_8a", "Bass 8va"],
	["F4_15b", "Bass 15mb"],
	["F4_15a", "Bass 15ma"],
	["perc", "Percussion"],
];
const CLEF_NAMES = Object.fromEntries([...CLEF_CHOICES, ...MORE_CLEFS]);
const KEYS = Array.from({ length: 15 }, (_, i) => i - 7);
const MAJOR = "C♭ G♭ D♭ A♭ E♭ B♭ F C G D A E B F♯ C♯".split(" ");
const MINOR = "A♭ E♭ B♭ F C G D A E B F♯ C♯ G♯ D♯ A♯".split(" ");
const keyLabel = (f) => (f === 0 ? "♮" : f > 0 ? `${f}♯` : `${-f}♭`);
const keyTitle = (f) => `${MAJOR[f + 7]} major / ${MINOR[f + 7]} minor`;

const selectedStaff = ref(null); // a staff's place in the systems (0: top)
const selectedClefKey = ref(null); // a clef within a bar
const selectedClef = computed(
	() =>
		result.value.clefs?.find((c) => c.key === selectedClefKey.value) ?? null,
);
const clefsNow = computed(() => staffClefs(result.value.musicXml));
const keyNow = computed(() => scoreKey(result.value.musicXml));
const isMoreClef = (name) => MORE_CLEFS.some(([n]) => n === name);

// the meter: a time signature picked sets it from its measure up to the
// next one shown (or the end of the score), see pipeline/edit.js
const TIME_CHOICES = ["2/4", "3/4", "4/4", "2/2", "3/8", "6/8", "9/8", "12/8"];
const MORE_TIMES = TIMES.filter(
	(t) => t?.includes("/") && !TIME_CHOICES.includes(t),
);
const selectedMeter = ref(null); // a time signature's measure (0: the first)
const metersNow = computed(() => measureMeters(result.value.musicXml));

/** A measure of the score (counted from 0) as [page, measure on the page]. */
function pageMeasure(n) {
	const counts = result.value.pageResults?.map((r) => r.measures ?? 0) ?? [];
	let m = n;
	for (let page = 0; page < counts.length; page++) {
		if (m < counts[page]) {
			return [page, m];
		}
		m -= counts[page];
	}
	return null;
}

/** The measure (counted from 0) a time signature drawn as `el` is in. */
const measureOf = (el) => Number(el.closest(".measure")?.dataset.n) - 1;

/** The next measure after `n` with a time signature shown, or null. */
function nextMeter(n) {
	let next = null;
	for (const el of scoreEl.value?.querySelectorAll(".meterSig") ?? []) {
		const m = measureOf(el);
		if (m > n && (next === null || m < next)) {
			next = m;
		}
	}
	return next;
}

function setMeter(value) {
	const n = selectedMeter.value;
	const from = n === null ? null : pageMeasure(n);
	if (!value || !from) {
		return;
	}
	const end = nextMeter(n);
	apply({
		type: "time",
		page: null,
		from,
		to: end === null ? null : pageMeasure(end),
		value,
	});
}

/** Pick nothing but `what` (a staff, a clef within a bar, …). */
function pickOnly(what) {
	selectedKey.value = null;
	selectedPart.value = null;
	selectedGroupKey.value = null;
	selectedStaff.value = null;
	selectedClefKey.value = null;
	selectedMeter.value = null;
	what?.();
}

/** The clef within a bar drawn as `el`: the one after the note before it. */
function midClefOf(el) {
	let s = null;
	for (
		let e = el.previousElementSibling;
		e && !s;
		e = e.previousElementSibling
	) {
		s =
			[e, ...e.querySelectorAll("[id]")]
				.reverse()
				.map((x) => byId.value.get(x.id))
				.find(Boolean) ?? null;
	}
	if (!s) {
		return null;
	}
	let best = null;
	for (const c of result.value.clefs ?? []) {
		if (
			c.page === s.page &&
			c.staff === s.staff &&
			c.box[0] > s.box[0] &&
			(!best || c.box[0] < best.box[0])
		) {
			best = c;
		}
	}
	return best;
}

/**
 * The clef, key or time signature at a click: its glyphs are small and only their
 * ink catches a pointer (a third of their box), so the box counts, and a
 * little around it (a finger more). The nearest, and how far (px, 0 in its
 * box); null when none is near, or a note is nearer.
 */
function clefAt({ target, clientX: x, clientY: y, pointerType }) {
	const direct = target?.closest?.(".clef, .keySig, .meterSig");
	if (direct) {
		return { el: direct, distance: 0 };
	}
	const margin = pointerType === "touch" ? 12 : 4; // px
	let best = null;
	let bestDistance = margin;
	for (const el of scoreEl.value?.querySelectorAll(
		".clef, .keySig, .meterSig",
	) ?? []) {
		const r = el.getBoundingClientRect();
		const d = Math.hypot(
			Math.max(r.left - x, 0, x - r.right),
			Math.max(r.top - y, 0, y - r.bottom),
		);
		if (d <= bestDistance) {
			best = el;
			bestDistance = d;
		}
	}
	if (!best) {
		return null;
	}
	// a note nearer still is the one meant
	const [, noteDistance] = nearestNote({ clientX: x, clientY: y, pointerType });
	if (bestDistance > 0 && noteDistance < bestDistance) {
		return null;
	}
	return { el: best, distance: bestDistance };
}

/**
 * A clef, key or time signature clicked on the score: its staff, the clef,
 * or the time signature's measure.
 */
function pickClefAt(event) {
	const el = clefAt(event)?.el;
	if (!el) {
		return false;
	}
	if (el.classList.contains("meterSig")) {
		const n = measureOf(el);
		if (!(n >= 0) || !pageMeasure(n)) {
			return false;
		}
		pickOnly(() => {
			selectedMeter.value = n;
		});
		return true;
	}
	if (el.closest(".layer")) {
		const c = midClefOf(el);
		if (c) {
			pickOnly(() => {
				selectedClefKey.value = c.key;
			});
		}
		return !!c;
	}
	const staff = el.closest(".staff");
	const slot = staff?.parentElement
		? [...staff.parentElement.querySelectorAll(":scope > .staff")].indexOf(
				staff,
			)
		: -1;
	if (slot < 0) {
		return false;
	}
	pickOnly(() => {
		selectedStaff.value = slot;
	});
	return true;
}

const setStaffClef = (name) =>
	name &&
	apply({ type: "clef", page: null, slot: selectedStaff.value, value: name });
const setKey = (fifths) => apply({ type: "key", page: null, value: fifths });

function setMidClef(name) {
	const c = selectedClef.value;
	if (c && name) {
		apply({
			type: "set",
			page: c.page,
			box: c.box,
			field: "cls",
			value: `clef_${name}`,
		});
	}
}

function deleteMidClef() {
	const c = selectedClef.value;
	if (c) {
		selectedClefKey.value = null;
		selectedMeter.value = null;
		apply({
			type: "set",
			page: c.page,
			box: c.box,
			field: "deleted",
			value: true,
		});
	}
}

function pickPart(k) {
	selectedKey.value = null;
	selectedGroupKey.value = null;
	selectedStaff.value = null;
	selectedClefKey.value = null;
	selectedMeter.value = null;
	selectedPart.value = k;
	const name = omr.partNames[k];
	partDraft.value = typeof name === "string" ? name : `Part ${k + 1}`;
}

/** Name the picked part (empty: no name shown). */
function namePart() {
	const k = selectedPart.value;
	if (k === null) {
		return;
	}
	const names = [...omr.partNames];
	while (names.length < k) {
		names.push(null);
	}
	names[k] = partDraft.value.trim();
	omr.partNames = names;
}

watch(selectedKey, (key) => {
	if (key !== null) {
		selectedPart.value = null;
		selectedGroupKey.value = null;
		selectedStaff.value = null;
		selectedClefKey.value = null;
		selectedMeter.value = null;
	}
});

function apply(op, select = null) {
	ops.value = [...ops.value, op];
	undone.value = [];
	replay(pagesOf(op), select);
}

function set(field, v) {
	const s = selected.value;
	if (s) {
		apply({ type: "set", page: s.page, box: s.box, field, value: v }, s.key);
	}
}

function undo() {
	const op = ops.value.at(-1);
	if (op) {
		undone.value = [...undone.value, op];
		ops.value = ops.value.slice(0, -1);
		replay(pagesOf(op));
	}
}

function redo() {
	const op = undone.value.at(-1);
	if (op) {
		ops.value = [...ops.value, op];
		undone.value = undone.value.slice(0, -1);
		replay(pagesOf(op));
	}
}

function resetEdits() {
	if (ops.value.length) {
		const pages = [...new Set(ops.value.flatMap(pagesOf))];
		undone.value = [...undone.value, ...[...ops.value].reverse()];
		ops.value = [];
		replay(pages);
	}
}

const pitch = (step) => isNote.value && set("pos", selected.value.pos + step);
const setValue = (v) => set("cls", `${selected.value.family}_${v}`);
const cycleDots = () => set("dots", ((selected.value?.dots ?? 0) + 1) % 3);
const setAlter = (a) => isNote.value && set("alter", a);

/**
 * Turn an articulation on or off on the selected note (staccato and
 * staccatissimo exclude each other, as accent and marcato do).
 */
function toggleArtic(c) {
	if (!isNote.value) {
		return;
	}
	const now = selected.value.artic ?? [];
	const next = now.includes(c)
		? now.filter((x) => x !== c)
		: [...now.filter((x) => x !== ARTIC_EXCLUDES[c]), c];
	set("artic", next);
}
const toggleRest = () =>
	set("cls", `${isNote.value ? "rest" : "note"}_${value(selected.value)}`);

function remove() {
	const s = selected.value;
	if (SPAN_FAMILIES.has(s?.family)) {
		editSpan({ kind: null });
	} else if (s?.family === "dynamic") {
		editDynamic(s, { value: null });
	} else if (s) {
		const next = neighbour(1) ?? neighbour(-1);
		apply(
			{ type: "set", page: s.page, box: s.box, field: "deleted", value: true },
			next?.key ?? null,
		);
	}
}

// ------------------------------------------------------- ties and slurs

/** The notes on the same line as note `key` (its staff, system after system). */
function lineOf(key) {
	const n = byKey.value.get(key);
	if (!n) {
		return [];
	}
	return result.value.symbols
		.filter(
			(s) => s.family === "note" && s.page === n.page && s.slot === n.slot,
		)
		.sort(
			(a, b) =>
				a.system - b.system || a.box[0] - b.box[0] || a.box[1] - b.box[1],
		);
}

/** The note `step` places after (or before) note `key` on its line, or null. */
function alongLine(key, step) {
	const line = lineOf(key);
	const at = line.findIndex((s) => s.key === key);
	return at < 0 ? null : (line[at + step] ?? null);
}

const pitchName = (s) =>
	s?.pitch
		? `${s.pitch.step}${ACCIDENTALS[s.pitch.alter] ?? ""}${s.pitch.octave}`
		: "?";
const samePitch = (a, b) =>
	!!a?.pitch &&
	!!b?.pitch &&
	a.pitch.step === b.pitch.step &&
	a.pitch.octave === b.pitch.octave;

/**
 * Set the selected tie, slur or hairpin's kind and notes (kind null: none).
 */
function editSpan(changes) {
	const s = selected.value;
	const span = { kind: s.kind, from: s.from, to: s.to, ...changes };
	const from = byKey.value.get(span.from);
	const to = byKey.value.get(span.to);
	apply(
		{
			type: s.family === "hairpin" ? "hairpin" : "span",
			page: s.page,
			ref: s.ref,
			kind: span.kind,
			from: from?.box ?? null,
			to: to?.box ?? null,
		},
		span.kind ? s.key : span.from,
	);
}

/** Move the selected tie, slur or hairpin's start or end a note along. */
function moveEnd(end, step) {
	const next = alongLine(selected.value[end], step);
	if (next) {
		editSpan({ [end]: next.key });
	}
}

const spanEnds = computed(() => {
	const s = isCurve.value ? selected.value : null;
	return s && { from: byKey.value.get(s.from), to: byKey.value.get(s.to) };
});
const canTie = computed(
	() => !!spanEnds.value && samePitch(spanEnds.value.from, spanEnds.value.to),
);
const canMove = (end, step) =>
	!!selected.value && !!alongLine(selected.value[end], step);

/** The ties, slurs and hairpins starting or ending on the selected note. */
const noteSpans = computed(() => {
	const s = isNote.value ? selected.value : null;
	return s
		? result.value.symbols.filter(
				(c) =>
					SPAN_FAMILIES.has(c.family) && (c.from === s.key || c.to === s.key),
			)
		: [];
});

const HAIRPIN_KINDS = new Set(["cres", "dim"]);
const KIND_NAMES = {
	tie: "Tie",
	slur: "Slur",
	cres: "Crescendo",
	dim: "Diminuendo",
};

/** Add a tie, slur or hairpin from note `from` to note `to` (symbols). */
function addSpan(kind, from, to) {
	const hairpin = HAIRPIN_KINDS.has(kind);
	const ref = (hairpin ? addedHairpinRef : addedSpanRef)(from.box, to.box);
	apply(
		{
			type: hairpin ? "hairpin" : "span",
			page: from.page,
			ref,
			kind,
			from: from.box,
			to: to.box,
		},
		`${from.page}:${ref}`,
	);
}

// "Slur to…", "Cresc. to…", …: the next note clicked ends it
const picking = ref(null); // { from (a note), kind }, while picking
const pickHint = ref(null);

function startPick(kind) {
	picking.value = { from: selected.value, kind };
	pickHint.value = null;
}

function endPick(to) {
	const { from, kind } = picking.value;
	const what = KIND_NAMES[kind];
	picking.value = null;
	if (to.family !== "note" || to.key === from.key) {
		pickHint.value = `A ${what.toLowerCase()} ends on another note.`;
	} else if (to.page !== from.page) {
		pickHint.value = `A ${what.toLowerCase()} starts and ends on the same page.`;
	} else {
		addSpan(kind, from, to);
	}
}

/** The next note of the same pitch on the selected note's line, if any. */
const tieTarget = computed(() => {
	const s = isNote.value ? selected.value : null;
	if (!s || noteSpans.value.some((c) => c.kind === "tie" && c.from === s.key)) {
		return null;
	}
	const line = lineOf(s.key);
	const at = line.findIndex((n) => n.key === s.key);
	return line.slice(at + 1, at + 12).find((n) => samePitch(n, s)) ?? null;
});

// --------------------------------------------------------------- dynamics

/**
 * Set dynamic `d`'s value and note (value null: none); then select it (else
 * its note), or `select`.
 */
function editDynamic(d, changes, select = undefined) {
	const next = { value: d.value, at: d.at, ...changes };
	apply(
		{
			type: "dynamic",
			page: d.page,
			ref: d.ref,
			value: next.value,
			at: byKey.value.get(next.at)?.box ?? null,
		},
		select !== undefined ? select : next.value ? d.key : next.at,
	);
}

/** The dynamic at note `key`, if any. */
const dynamicAt = (key) =>
	result.value.symbols.find((s) => s.family === "dynamic" && s.at === key) ??
	null;

/** The selected note's dynamic, if any. */
const noteDynamic = computed(() =>
	isNote.value ? dynamicAt(selected.value.key) : null,
);

/**
 * Set the dynamic of the selected note, or of the selected dynamic, to `v`
 * (its own value again: none).
 */
function setDynamic(v) {
	const s = selected.value;
	const d = isDynamic.value ? s : noteDynamic.value;
	if (d) {
		editDynamic(
			d,
			{ value: d.value === v ? null : v },
			isNote.value ? s.key : undefined,
		);
	} else if (isNote.value) {
		// named after the note and the edit (several may be added at a note)
		const ref = addedDynamicRef(s.box, ops.value.length);
		apply({ type: "dynamic", page: s.page, ref, value: v, at: s.box }, s.key);
	}
}

/** Move the selected dynamic to the previous / next note on its line. */
function moveDynamic(step) {
	const next = alongLine(selected.value.at, step);
	if (next) {
		editDynamic(selected.value, { at: next.key });
	}
}

const addStaves = computed(
	() => result.value.pageResults[addPage.value]?.staves ?? [],
);
const addSymbols = computed(() =>
	result.value.symbols.filter(
		(s) =>
			s.page === addPage.value && (s.family === "note" || s.family === "rest"),
	),
);

function add(at) {
	const page = addPage.value;
	const det = addedDet(addCls.value, at, addStaves.value);
	if (det) {
		apply(
			{ type: "add", page, cls: addCls.value, at },
			`${page}:${boxKey(det.xyxy)}`,
		);
	}
}

/** Adding: start on the page of the selected note, if any. */
function toggleAdding() {
	adding.value = !adding.value;
	if (adding.value && selected.value) {
		addPage.value = selected.value.page;
	}
}

// ---------------------------------------------------------------- the score

/** Score elements (notes, rests) linked to a symbol, in the score's order. */
const scoreElements = () =>
	scoreEl.value
		? [...scoreEl.value.querySelectorAll("g.note, g.rest")].filter((el) =>
				byId.value.has(el.id),
			)
		: [];

/** The symbol `step` places after (or before) the selected one on the score. */
function neighbour(step) {
	const els = scoreElements();
	const at = els.findIndex((el) => el.id === selected.value?.id);
	const el = at < 0 ? null : els[at + step];
	return el ? byId.value.get(el.id) : null;
}

function selectNeighbour(step) {
	const s = selected.value ? neighbour(step) : null;
	const first = scoreElements()[0];
	const next = s ?? (selected.value ? null : byId.value.get(first?.id));
	if (next) {
		selectedKey.value = next.key;
	}
}

/**
 * The note, rest, tie, slur or hairpin at a pointer: a note or rest it is
 * on, else a tie or slur it is on (their hit area is widened, see
 * style.css), else a hairpin it is within, else the note or rest within a
 * few pixels; or null.
 */
function nearest(event) {
	const [note, distance] = nearestNote(event);
	if (note && distance < 1) {
		return note;
	}
	const curve = event.target?.closest?.("g.slur, g.tie");
	return byId.value.get(curve && curveId(curve)) ?? nearestMark(event) ?? note;
}

/**
 * The hairpin or dynamic whose outline (a few pixels around) a pointer is
 * in, the smallest, or null.
 */
function nearestMark({ clientX: x, clientY: y, pointerType }) {
	let best = null;
	let bestArea = Number.POSITIVE_INFINITY;
	for (const el of scoreEl.value?.querySelectorAll("g.hairpin, g.dynam") ??
		[]) {
		const s = byId.value.get(curveId(el));
		const r = el.getBoundingClientRect();
		const m = pointerType === "touch" ? 10 : 4; // px
		const area = r.width * r.height;
		if (
			s &&
			r.left - m <= x &&
			x <= r.right + m &&
			r.top - m <= y &&
			y <= r.bottom + m &&
			area < bestArea
		) {
			best = s;
			bestArea = area;
		}
	}
	return best;
}

/**
 * A symbol's id on the score: a class "id-<its id>" (a tie or slur across a
 * line break is drawn in two, the second so classed; a dynamic, whose id
 * Verovio drops, see render/verovio.js), else its element's id.
 */
const curveId = (el) =>
	(el.getAttribute("class") ?? "").match(/\bid-(\S+)/)?.[1] || el.id || null;

/**
 * The note or rest nearest a pointer, within a few pixels (Verovio's glyphs
 * are thin, hit-testing them misses), and how far (px): [symbol, distance],
 * or [null].
 */
function nearestNote({ clientX: x, clientY: y, pointerType }) {
	let best = null;
	let bestDistance = pointerType === "touch" ? 20 : 8; // px (a finger: wider)
	for (const el of scoreElements()) {
		const r = el.getBoundingClientRect();
		const dx = Math.max(r.left - x, 0, x - r.right);
		const dy = Math.max(r.top - y, 0, y - r.bottom);
		// inside several (a chord's notes share a stem): the closest centre
		const centre = Math.hypot(
			x - (r.left + r.right) / 2,
			y - (r.top + r.bottom) / 2,
		);
		const distance = Math.hypot(dx, dy) + 0.01 * centre;
		if (distance < bestDistance) {
			best = el;
			bestDistance = distance;
		}
	}
	return best ? [byId.value.get(best.id), bestDistance] : [null];
}

function onPointerMove(event) {
	if (event.pointerType === "touch") {
		return; // a finger scrolling, not pointing
	}
	const s = nearest(event);
	if (s) {
		hoveredId.value = s.id;
	}
}

function onScoreClick(event) {
	const sym = bracketAt(event);
	if (sym && !picking.value) {
		const g = groupOfSym(sym);
		if (g) {
			pickGroup(g);
			return;
		}
	}
	selectedGroupKey.value = null;
	const label = event.target?.closest?.(".label");
	if (label && !picking.value) {
		const k = partOfLabel(label);
		if (k !== null) {
			pickPart(k);
			return;
		}
	}
	selectedPart.value = null;
	if (!picking.value && pickClefAt(event)) {
		return;
	}
	selectedStaff.value = null;
	selectedClefKey.value = null;
	selectedMeter.value = null;
	const s = nearest(event);
	if (picking.value) {
		if (s) {
			endPick(s);
		}
		return;
	}
	pickHint.value = null;
	selectedKey.value = s?.key ?? null;
}

/** Mark the hovered and selected notes on the score (after each render). */
async function markScore() {
	await nextTick();
	if (!scoreEl.value) {
		return;
	}
	for (const el of scoreEl.value.querySelectorAll(".hovered, .selected")) {
		el.classList.remove("hovered", "selected");
	}
	// a symbol's elements (a tie or slur may have a second part)
	const find = (id) =>
		id
			? [
					...scoreEl.value.querySelectorAll(
						`#${CSS.escape(id)}, .id-${CSS.escape(id)}`,
					),
				]
			: [];
	for (const el of find(hoveredId.value)) {
		el.classList.add("hovered");
	}
	const els = find(selected.value?.id);
	if (selectedStaff.value !== null) {
		for (const measure of scoreEl.value.querySelectorAll(".measure")) {
			const staff =
				measure.querySelectorAll(":scope > .staff")[selectedStaff.value];
			els.push(
				...(staff?.querySelectorAll(":scope > .clef, :scope > .keySig") ?? []),
			);
		}
	}
	if (selectedMeter.value !== null) {
		for (const el of scoreEl.value.querySelectorAll(".meterSig")) {
			if (measureOf(el) === selectedMeter.value) {
				els.push(el);
			}
		}
	}
	if (selectedGroup.value) {
		const key = groupKey(selectedGroup.value);
		for (const sym of scoreEl.value.querySelectorAll(".grpSym")) {
			const g = groupOfSym(sym);
			if (g && groupKey(g) === key) {
				els.push(sym);
			}
		}
	}
	if (selectedPart.value !== null) {
		for (const label of scoreEl.value.querySelectorAll(".label")) {
			if (partOfLabel(label) === selectedPart.value) {
				els.push(label);
			}
		}
	}
	for (const el of els) {
		el.classList.add("selected");
	}
	return els[0] ?? null;
}

watch(
	[
		hoveredId,
		() => selected.value?.id,
		selectedPart,
		selectedGroup,
		selectedStaff,
		selectedMeter,
		result,
	],
	markScore,
	{ flush: "post" },
);
watch(
	() => selected.value?.id,
	async () => {
		const el = await markScore();
		el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	},
);

// zoomed: the selected symbol kept in view
watch(zoom, async () => {
	await nextTick();
	scoreEl.value
		?.querySelector(".selected")
		?.scrollIntoView?.({ block: "nearest", inline: "center" });
});

// ---------------------------------------------------------------- keyboard

const VALUE_KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // → VALUES

function onKey(event) {
	if (!props.active) {
		return;
	}
	const t = event.target;
	if (t instanceof HTMLElement && t.closest("input, select, textarea")) {
		return;
	}
	const mod = event.ctrlKey || event.metaKey;
	const key = event.key;
	if (mod && key.toLowerCase() === "z") {
		event.preventDefault();
		event.shiftKey ? redo() : undo();
		return;
	}
	if (mod && key.toLowerCase() === "y") {
		event.preventDefault();
		redo();
		return;
	}
	if (mod || event.altKey) {
		return;
	}
	if (key === "Escape") {
		if (picking.value) {
			picking.value = null;
		} else if (adding.value) {
			adding.value = false;
		} else {
			selectedKey.value = null;
			selectedPart.value = null;
			selectedGroupKey.value = null;
			selectedStaff.value = null;
			selectedClefKey.value = null;
			selectedMeter.value = null;
		}
		return;
	}
	if (!selected.value) {
		return;
	}
	if (isSpan.value || isDynamic.value) {
		if (key === "Delete" || key === "Backspace") {
			event.preventDefault();
			remove();
		}
		return;
	}
	const actions = {
		ArrowUp: () => pitch(1),
		ArrowDown: () => pitch(-1),
		ArrowLeft: () => selectNeighbour(-1),
		ArrowRight: () => selectNeighbour(1),
		".": cycleDots,
		"#": () => setAlter(1),
		s: () => setAlter(1),
		b: () => setAlter(-1),
		n: () => setAlter(0),
		k: () => setAlter("key"),
		r: toggleRest,
		t: () => set("tup", selected.value.tup === "3/2" ? "none" : "3/2"),
		"'": () => toggleArtic("artic_stacc"),
		"-": () => toggleArtic("artic_ten"),
		">": () => toggleArtic("artic_acc"),
		"^": () => toggleArtic("artic_marc"),
		Delete: remove,
		Backspace: remove,
	};
	const action =
		actions[key] ??
		(key in VALUE_KEYS ? () => setValue(VALUES[VALUE_KEYS[key]]) : null);
	if (action) {
		event.preventDefault();
		action();
	}
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

// ---------------------------------------------------------------- display

const ACCIDENTALS = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
const DOTS = ["", " dotted", " double-dotted"];

function describe(s) {
	const where = props.pages.length > 1 ? ` · page ${s.page + 1}` : "";
	return describeSymbol(s) + where;
}

function describeSymbol(s) {
	const tuplet = TUP_NAMES[s.tup] ? ` · ${TUP_NAMES[s.tup]}` : "";
	return describeBase(s) + (SPAN_FAMILIES.has(s.family) ? "" : tuplet);
}

function describeBase(s) {
	if (s.family === "dynamic") {
		const name = DYNAMIC_NAMES[s.value];
		const at = pitchName(byKey.value.get(s.at));
		return `Dynamic ${s.value}${name ? ` (${name})` : ""} · at ${at}`;
	}
	if (SPAN_FAMILIES.has(s.family)) {
		const from = byKey.value.get(s.from);
		const to = byKey.value.get(s.to);
		return `${KIND_NAMES[s.kind]} · ${pitchName(from)} → ${pitchName(to)}`;
	}
	const length = `${value(s)}${DOTS[s.dots] ?? ""}`;
	if (s.family === "rest") {
		return `${length} rest`;
	}
	if (!s.pitch) {
		return `${length} note`;
	}
	const { step, octave, alter } = s.pitch;
	return `${step}${ACCIDENTALS[alter] ?? ""}${octave} · ${length} note`;
}

const fitHint = computed(() => {
	const s = selected.value;
	if (!s || (s.family !== "note" && s.family !== "rest")) {
		return null;
	}
	if (!s.written) {
		return "Not on the score: its bar is already full (shorten or delete another note there), or it is outside any bar.";
	}
	if (s.written.type !== value(s) || s.written.dots !== s.dots) {
		return `Too long for its bar: written as ${s.written.type}${DOTS[s.written.dots] ?? ""}.`;
	}
	return null;
});

// added from the selected note, to a note clicked next
const PICKS = [
	[
		"slur",
		"+ Slur to…",
		"Add a slur or phrase mark: then click the note it ends on",
	],
	["cres", "+ Cresc. to…", "Add a crescendo: then click the note it ends on"],
	["dim", "+ Dim. to…", "Add a diminuendo: then click the note it ends on"],
];

// articulations offered: [class, label, title]
const ARTIC_CHOICES = [
	["artic_stacc", "·", "Staccato (')"],
	["artic_stacciss", "▾", "Staccatissimo"],
	["artic_ten", "–", "Tenuto (-)"],
	["artic_acc", ">", "Accent (>)"],
	["artic_marc", "^", "Marcato (^)"],
];
const ARTIC_EXCLUDES = {
	artic_stacc: "artic_stacciss",
	artic_stacciss: "artic_stacc",
	artic_acc: "artic_marc",
	artic_marc: "artic_acc",
};

// tuplets offered: [value (see TUPLETS), label, title]
const TUP_CHOICES = [
	["none", "No tuplet", "Not in a tuplet"],
	["3/2", "3", "Triplet: 3 in the time of 2 (t)"],
	["2/3", "2", "Duplet: 2 in the time of 3"],
	["4/3", "4", "Quadruplet: 4 in the time of 3"],
	["5/4", "5", "Quintuplet: 5 in the time of 4"],
	["6/4", "6", "Sextuplet: 6 in the time of 4"],
	["7/4", "7", "Septuplet: 7 in the time of 4"],
];
const TUP_NAMES = {
	"3/2": "triplet",
	"2/3": "duplet",
	"4/3": "quadruplet",
	"5/4": "quintuplet",
	"6/4": "sextuplet",
	"7/4": "septuplet",
};

// dynamics offered (see write.js DYN)
const DYNAMIC_CHOICES = [
	"ppp",
	"pp",
	"p",
	"mp",
	"mf",
	"f",
	"ff",
	"fff",
	"sf",
	"sfz",
	"fz",
	"fp",
];
const DYNAMIC_NAMES = {
	ppp: "pianississimo",
	pp: "pianissimo",
	p: "piano",
	mp: "mezzo-piano",
	mf: "mezzo-forte",
	f: "forte",
	ff: "fortissimo",
	fff: "fortississimo",
	sf: "sforzando",
	sfz: "sforzato",
	fz: "forzando",
	fp: "forte-piano",
};

const ALTER_CHOICES = [
	["key", "Key", "As the key signature (k)"],
	[-1, "♭", "Flat (b)"],
	[0, "♮", "Natural (n)"],
	[1, "♯", "Sharp (s or #)"],
];

// ---------------------------------------------------------------- downloads

function downloadMusicXml() {
	download(
		"score.musicxml",
		new Blob([result.value.musicXml], {
			type: "application/vnd.recordare.musicxml+xml",
		}),
	);
}

async function downloadMidi() {
	const bytes = await musicXmlToMidi(result.value.musicXml);
	download("score.mid", new Blob([bytes], { type: "audio/midi" }));
}
</script>

<template>
	<div class="score-editor">
		<div class="credits">
			<label>
				Title
				<input v-model.lazy="omr.title" type="text" placeholder="Untitled" />
			</label>
			<label>
				Composer
				<input v-model.lazy="omr.composer" type="text" placeholder="Unknown" />
			</label>
		</div>
		<div class="toolbar">
			<span class="summary" :title="`${result.summary.staves} staves in ${result.summary.systems} systems; ${result.summary.changed} corrected from context`">
				<template v-if="pages.length > 1">{{ pages.length }} pages · </template>
				{{ result.summary.notes }} notes, {{ result.summary.rests }} rests<template v-if="result.summary.edited"> · {{ result.summary.edited }} edited</template>
			</span>
			<div class="section" aria-label="Edit">
				<div class="group">
					<button class="secondary" :disabled="!ops.length" title="Undo (Ctrl+Z)" @click="undo">↶ Undo</button>
					<button class="secondary" :disabled="!undone.length" title="Redo (Ctrl+Shift+Z)" @click="redo">↷ Redo</button>
					<button class="secondary" :disabled="!ops.length" title="Undo all edits" @click="resetEdits">Undo all</button>
				</div>
				<button
					class="secondary"
					:aria-pressed="adding"
					:disabled="!canAdd"
					@click="toggleAdding"
				>
					{{ adding ? "Stop adding" : "+ Add missed notes" }}
				</button>
			</div>
			<div class="section" aria-label="Download">
				<span class="label">Download</span>
				<button title="Download MusicXML" @click="downloadMusicXml">MusicXML</button>
				<button class="secondary" :disabled="result.summary.notes === 0" title="Download MIDI" @click="downloadMidi">MIDI</button>
				<ExportButtons step="score" :music-xml="result.musicXml" :arrows="false" />
			</div>
		</div>
		<div class="status-row">
			<p class="status-line">
				<span v-if="editing" class="status">
					{{ editProgress?.stage === "reading in context" ? "Reading the page again…" : "Updating…" }}
				</span>
				<span v-else-if="editError" class="error">{{ editError }}</span>
				<span v-else-if="unplaced" class="status">
					{{ unplaced }} added symbol{{ unplaced > 1 ? "s" : "" }} could not be
					placed in a bar.
				</span>
				<span v-else-if="picking" class="status">
					Click the note the {{ KIND_NAMES[picking.kind].toLowerCase() }} ends on
					(Esc: cancel).
				</span>
				<span v-else-if="pickHint" class="error">{{ pickHint }}</span>
				<span v-else class="hint">
					A first draft: click a note, tie, slur, hairpin or dynamic to correct
					it, or a clef, key, time signature, bracket or part's name.
				</span>
			</p>
			<div v-if="result.svg.length > 0" class="group zoom" aria-label="Zoom">
				<button class="secondary" title="Zoom out" :disabled="zoom === ZOOMS[0]" @click="zoomBy(-1)">−</button>
				<button class="secondary" title="Fit the width" :aria-pressed="zoom === 1" @click="zoom = 1">{{ zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%` }}</button>
				<button class="secondary" title="Zoom in" :disabled="zoom === ZOOMS.at(-1)" @click="zoomBy(1)">+</button>
			</div>
		</div>
		<AddSymbols
			v-if="adding && pageOf(addPage)?.url"
			v-model:cls="addCls"
			v-model:page="addPage"
			:page-count="pages.length"
			:src="pageOf(addPage).url"
			:width="pageOf(addPage).width"
			:height="pageOf(addPage).height"
			:symbols="addSymbols"
			:staves="addStaves"
			@add="add"
			@done="adding = false"
		/>
		<div v-if="result.svg.length > 0" class="result-view">
			<div
				ref="scoreEl"
				class="score-view"
				:class="{ busy: editing }"
				@pointermove="onPointerMove"
				@pointerleave="hoveredId = null"
				@click="onScoreClick"
			>
				<!-- SVG produced locally by Verovio from our own MusicXML -->
				<!-- eslint-disable-next-line vue/no-v-html -->
				<div class="score-pages" :style="{ width: `${zoom * 100}%` }">
					<div v-for="(svg, i) in result.svg" :key="i" v-html="svg"></div>
				</div>
			</div>
			<!-- beside the score; on a phone, a sheet at the bottom while a symbol is selected -->
			<div class="side" :class="{ open: !!selected || selectedPart !== null || !!selectedGroup || selectedStaff !== null || !!selectedClef || selectedMeter !== null }">
				<div v-if="selectedPart !== null && !selected" class="note-editor">
					<div class="note-title">
						<strong>Part {{ selectedPart + 1 }}{{ partStaves.length > 1 ? ` of ${partStaves.length}` : "" }}</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedPart = null">✕</button>
					</div>
					<div class="rows">
						<span class="label">Name</span>
						<div class="group">
							<input
								v-model="partDraft"
								class="part-name"
								type="text"
								placeholder="No name"
								aria-label="Part name"
								@change="namePart"
								@keydown.enter="namePart"
							/>
						</div>
					</div>
					<div class="rows">
						<span class="label">Brackets</span>
						<div class="group" aria-label="Brackets">
							<button
								v-for="g in partGroupsOf(selectedPart)"
								:key="groupKey(g)"
								:title="`Select this ${SYMBOL_NAMES[g.symbol].toLowerCase()}`"
								@click="pickGroup(g)"
							>
								{{ SYMBOL_NAMES[g.symbol] }} · {{ partsName(g) }}
							</button>
							<button title="A bracket from this part (then stretch it over the next ones)" @click="addGroup(selectedPart)">
								+ Bracket
							</button>
						</div>
					</div>
					<p class="hint">The name is printed at the left of the first system. Leave it empty to print no name.</p>
				</div>
				<div v-if="selectedStaff !== null && !selected" class="note-editor">
					<div class="note-title">
						<strong>Staff {{ selectedStaff + 1 }} · clef and key</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedStaff = null">✕</button>
					</div>
					<div class="rows">
						<span class="label">Clef</span>
						<div class="group" aria-label="Clef">
							<button
								v-for="[name, text] in CLEF_CHOICES"
								:key="name"
								:aria-pressed="clefsNow[selectedStaff] === name"
								@click="setStaffClef(name)"
							>
								{{ text }}
							</button>
							<select
								:value="isMoreClef(clefsNow[selectedStaff]) ? clefsNow[selectedStaff] : ''"
								aria-label="Other clefs"
								@change="setStaffClef($event.target.value)"
							>
								<option value="" disabled>More…</option>
								<option v-for="[name, text] in MORE_CLEFS" :key="name" :value="name">{{ text }}</option>
							</select>
						</div>
						<span class="label">Key</span>
						<div class="group key-choices" aria-label="Key signature">
							<button
								v-for="f in KEYS"
								:key="f"
								:aria-pressed="keyNow === f"
								:title="keyTitle(f)"
								@click="setKey(f)"
							>
								{{ keyLabel(f) }}
							</button>
						</div>
					</div>
					<p class="hint">
						The clef is set for this staff, the key for all staves, both in the
						whole score ({{ keyTitle(keyNow) }} now). The notes keep their place on the
						staff: their pitches follow.
					</p>
				</div>
				<div v-if="selectedClef && !selected" class="note-editor">
					<div class="note-title">
						<strong>Clef change · {{ CLEF_NAMES[selectedClef.cls.slice(5)] ?? selectedClef.cls.slice(5) }}</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedClefKey = null">✕</button>
					</div>
					<div class="rows">
						<span class="label">Clef</span>
						<div class="group" aria-label="Clef">
							<button
								v-for="[name, text] in CLEF_CHOICES"
								:key="name"
								:aria-pressed="selectedClef.cls === `clef_${name}`"
								@click="setMidClef(name)"
							>
								{{ text }}
							</button>
							<select
								:value="isMoreClef(selectedClef.cls.slice(5)) ? selectedClef.cls.slice(5) : ''"
								aria-label="Other clefs"
								@change="setMidClef($event.target.value)"
							>
								<option value="" disabled>More…</option>
								<option v-for="[name, text] in MORE_CLEFS" :key="name" :value="name">{{ text }}</option>
							</select>
						</div>
					</div>
					<p class="hint">A clef change within a bar: from here to the next clef.</p>
					<div class="actions">
						<button class="danger" title="Delete this clef change" @click="deleteMidClef">Delete</button>
					</div>
				</div>
				<div v-if="selectedMeter !== null && !selected" class="note-editor">
					<div class="note-title">
						<strong>Time signature · bar {{ selectedMeter + 1 }}</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedMeter = null">✕</button>
					</div>
					<div class="rows">
						<span class="label">Time</span>
						<div class="group" aria-label="Time signature">
							<button
								v-for="t in TIME_CHOICES"
								:key="t"
								:aria-pressed="metersNow[selectedMeter] === t"
								@click="setMeter(t)"
							>
								{{ t }}
							</button>
							<select
								:value="MORE_TIMES.includes(metersNow[selectedMeter]) ? metersNow[selectedMeter] : ''"
								aria-label="Other time signatures"
								@change="setMeter($event.target.value)"
							>
								<option value="" disabled>More…</option>
								<option v-for="t in MORE_TIMES" :key="t" :value="t">{{ t }}</option>
							</select>
						</div>
					</div>
					<p class="hint">
						From bar {{ selectedMeter + 1 }} to the next time signature, or the end of the
						score. The bars are read again with this length.
					</p>
				</div>
				<div v-if="selectedGroup && !selected" class="note-editor">
					<div class="note-title">
						<strong>{{ SYMBOL_NAMES[selectedGroup.symbol] }} · {{ partsName(selectedGroup) }}</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedGroupKey = null">✕</button>
					</div>
					<div class="rows">
						<span class="label">Shape</span>
						<div class="group" aria-label="Shape">
							<button
								v-for="sym in GROUP_SYMBOLS"
								:key="sym"
								:aria-pressed="selectedGroup.symbol === sym"
								@click="setGroup('symbol', sym)"
							>
								{{ SYMBOL_NAMES[sym] }}
							</button>
						</div>
						<span class="label">Top</span>
						<div class="group" aria-label="Top">
							<button title="Start a part higher" :disabled="!canMoveGroup('first', -1)" @click="moveGroupEnd('first', -1)">▲</button>
							<button title="Start a part lower" :disabled="!canMoveGroup('first', 1)" @click="moveGroupEnd('first', 1)">▼</button>
							<span class="hint">part {{ selectedGroup.first + 1 }}</span>
						</div>
						<span class="label">Bottom</span>
						<div class="group" aria-label="Bottom">
							<button title="End a part higher" :disabled="!canMoveGroup('last', -1)" @click="moveGroupEnd('last', -1)">▲</button>
							<button title="End a part lower" :disabled="!canMoveGroup('last', 1)" @click="moveGroupEnd('last', 1)">▼</button>
							<span class="hint">part {{ selectedGroup.last + 1 }}</span>
						</div>
						<span class="label">Bar lines</span>
						<div class="group" aria-label="Bar lines">
							<button :aria-pressed="selectedGroup.barline" title="Bar lines through all its staves" @click="setGroup('barline', true)">Through</button>
							<button :aria-pressed="!selectedGroup.barline" title="Bar lines on each staff only" @click="setGroup('barline', false)">Per staff</button>
						</div>
					</div>
					<div class="actions">
						<button class="danger" title="Delete this bracket" @click="deleteGroup">Delete</button>
					</div>
				</div>
				<div v-if="selected" class="note-editor">
					<div class="note-title">
						<strong>{{ describe(selected) }}</strong>
						<button class="link" title="Deselect (Esc)" @click="selectedKey = null">✕</button>
					</div>
					<p v-if="fitHint" class="hint">{{ fitHint }}</p>
					<div v-if="isDynamic" class="rows">
						<span class="label">Value</span>
						<div class="group" aria-label="Value">
							<button
								v-for="v in DYNAMIC_CHOICES"
								:key="v"
								class="dyn"
								:aria-pressed="selected.value === v"
								:title="DYNAMIC_NAMES[v]"
								@click="setDynamic(v)"
							>
								{{ v }}
							</button>
						</div>
						<span class="label">Note</span>
						<div class="group" aria-label="Note">
							<button title="At the previous note" :disabled="!canMove('at', -1)" @click="moveDynamic(-1)">◀</button>
							<button title="At the next note" :disabled="!canMove('at', 1)" @click="moveDynamic(1)">▶</button>
						</div>
					</div>
					<div v-else-if="isSpan" class="rows">
						<span class="label">Kind</span>
						<div v-if="isHairpin" class="group" aria-label="Kind">
							<button
								v-for="k in ['cres', 'dim']"
								:key="k"
								:aria-pressed="selected.kind === k"
								:title="k === 'cres' ? 'Getting louder (<)' : 'Getting softer (>)'"
								@click="editSpan({ kind: k })"
							>
								{{ KIND_NAMES[k] }}
							</button>
						</div>
						<div v-else class="group" aria-label="Kind">
							<button
								:aria-pressed="selected.kind === 'tie'"
								:disabled="!canTie && selected.kind !== 'tie'"
								:title="canTie ? 'A tie: one note held on' : 'A tie joins two notes of the same pitch'"
								@click="editSpan({ kind: 'tie' })"
							>
								Tie
							</button>
							<button
								:aria-pressed="selected.kind === 'slur'"
								title="A slur or phrase mark: notes played smoothly"
								@click="editSpan({ kind: 'slur' })"
							>
								Slur
							</button>
						</div>
						<span class="label">Start</span>
						<div class="group" aria-label="Start">
							<button title="Start on the previous note" :disabled="!canMove('from', -1)" @click="moveEnd('from', -1)">◀</button>
							<button title="Start on the next note" :disabled="!canMove('from', 1)" @click="moveEnd('from', 1)">▶</button>
						</div>
						<span class="label">End</span>
						<div class="group" aria-label="End">
							<button title="End on the previous note" :disabled="!canMove('to', -1)" @click="moveEnd('to', -1)">◀</button>
							<button title="End on the next note" :disabled="!canMove('to', 1)" @click="moveEnd('to', 1)">▶</button>
						</div>
					</div>
					<div v-else class="rows">
						<template v-if="isNote">
							<span class="label">Pitch</span>
							<div class="group" aria-label="Pitch">
								<button title="Higher (↑)" @click="pitch(1)">▲</button>
								<button title="Lower (↓)" @click="pitch(-1)">▼</button>
								<span class="gap"></span>
								<button
									v-for="[a, text, title] in ALTER_CHOICES"
									:key="a"
									:aria-pressed="selected.alter === a"
									:title="title"
									@click="setAlter(a)"
								>
									{{ text }}
								</button>
							</div>
						</template>
						<span class="label">Duration</span>
						<div class="group" aria-label="Duration">
							<button
								v-for="(v, i) in VALUES"
								:key="v"
								:aria-pressed="value(selected) === v"
								:title="`${v} (${i + 1})`"
								@click="setValue(v)"
							>
								{{ v === "eighth" ? "8th" : v }}
							</button>
							<span class="gap"></span>
							<button :aria-pressed="selected.dots > 0" title="Dots: none, one, two (.)" @click="cycleDots">
								{{ selected.dots === 2 ? "··" : "·" }} dot
							</button>
						</div>
						<span class="label">Tuplet</span>
						<div class="group" aria-label="Tuplet">
							<button
								v-for="[t, text, title] in TUP_CHOICES"
								:key="t"
								:aria-pressed="selected.tup === t"
								:disabled="!selected.written"
								:title="title"
								@click="set('tup', t)"
							>
								{{ text }}
							</button>
						</div>
						<template v-if="isNote">
							<span class="label">Marks</span>
							<div class="group" aria-label="Marks">
								<button
									v-for="[c, text, title] in ARTIC_CHOICES"
									:key="c"
									class="artic"
									:aria-pressed="!!selected.artic?.includes(c)"
									:disabled="!selected.written"
									:title="title"
									@click="toggleArtic(c)"
								>
									{{ text }}
								</button>
							</div>
							<span class="label">Dynamic</span>
							<div class="group" aria-label="Dynamic">
								<button
									v-for="v in DYNAMIC_CHOICES"
									:key="v"
									class="dyn"
									:aria-pressed="noteDynamic?.value === v"
									:disabled="!selected.written"
									:title="noteDynamic?.value === v ? `Remove the ${DYNAMIC_NAMES[v]}` : `${DYNAMIC_NAMES[v]} at this note`"
									@click="setDynamic(v)"
								>
									{{ v }}
								</button>
								<button
									v-if="noteDynamic"
									:title="`Select this dynamic (to move it)`"
									@click="selectedKey = noteDynamic.key"
								>
									Select {{ noteDynamic.value }}
								</button>
							</div>
							<span class="label">Lines</span>
							<div class="group" aria-label="Ties, slurs and hairpins">
								<button
									v-for="c in noteSpans"
									:key="c.key"
									:title="`Select this ${KIND_NAMES[c.kind].toLowerCase()}`"
									@click="selectedKey = c.key"
								>
									{{ KIND_NAMES[c.kind] }} {{ c.from === selected.key ? "→" : "←" }} {{ pitchName(byKey.get(c.from === selected.key ? c.to : c.from)) }}
								</button>
								<button v-if="tieTarget" :title="`Tie to the next ${pitchName(tieTarget)}`" @click="addSpan('tie', selected, tieTarget)">
									+ Tie
								</button>
								<button
									v-for="[kind, text, title] in PICKS"
									:key="kind"
									:aria-pressed="picking?.kind === kind"
									:title="title"
									@click="picking?.kind === kind ? (picking = null) : startPick(kind)"
								>
									{{ text }}
								</button>
							</div>
						</template>
					</div>
					<div class="actions">
						<button v-if="!isSpan && !isDynamic" title="Rest ↔ note (r)" @click="toggleRest">
							{{ isNote ? "To rest" : "To note" }}
						</button>
						<button class="danger" title="Delete (Del)" @click="remove">Delete</button>
					</div>
					<p class="hint keys">{{ isSpan || isDynamic ? "Del delete · Esc deselect" : "← → previous / next · Esc deselect" }}</p>
				</div>
				<!-- not for a part, bracket or staff: no place on the page to show -->
				<PageHighlight
					v-if="highlightPage?.url && selectedPart === null && !selectedGroup && selectedStaff === null && selectedMeter === null"
					:key="shownPage"
					:src="highlightPage.url"
					:width="highlightPage.width"
					:height="highlightPage.height"
					:box="shown?.box ?? null"
				/>
			</div>
		</div>
		<p v-else class="hint">No notes found — nothing to render.</p>
	</div>
</template>

<style scoped>
.part-name {
	flex: 1;
	min-width: 0;
	padding: 0.45rem 0.6rem;
	background: var(--panel);
	color: var(--ink);
	border: 1px solid var(--border);
	border-radius: 8px;
	font-size: 0.95rem;
}

.credits {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	margin-bottom: 0.75rem;
}

.credits label {
	display: flex;
	flex: 1 1 14rem;
	gap: 0.5rem;
	align-items: center;
	color: var(--muted);
	font-size: 0.9rem;
}

.credits input {
	flex: 1;
	min-width: 0;
	padding: 0.45rem 0.6rem;
	background: var(--panel);
	color: var(--ink);
	border: 1px solid var(--border);
	border-radius: 8px;
	font-size: 0.95rem;
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 0.75rem;
	align-items: center;
}

.toolbar .summary {
	font-weight: 600;
	margin-right: auto;
}

.toolbar .group,
.toolbar .section {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
	align-items: center;
}

.toolbar .section {
	gap: 0.3rem 0.6rem;
	padding-left: 0.75rem;
	border-left: 1px solid var(--border);
}

.toolbar .section .label {
	color: var(--muted);
	font-size: 0.85rem;
}

.toolbar .section .group + button {
	margin-left: 0.15rem;
}

.toolbar button {
	padding: 0.4rem 0.75rem;
	font-size: 0.9rem;
}

.toolbar button[aria-pressed="true"] {
	background: var(--accent);
	color: var(--accent-ink);
}

.status-row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem 0.75rem;
	align-items: center;
	margin: 0.4rem 0 0.75rem;
}

.status-line {
	flex: 1 1 16rem;
	margin: 0;
	font-size: 0.85rem;
	min-height: 1.2em;
}

.zoom button {
	min-width: 2.2rem;
	padding: 0.25rem 0.5rem;
	font-size: 0.85rem;
	font-variant-numeric: tabular-nums;
}

.zoom button[aria-pressed="true"] {
	border-color: var(--accent);
}

.score-pages {
	min-width: 100%;
}

.status-line .status {
	color: var(--muted);
}

.status-line .error {
	margin: 0;
}

.status-line .hint {
	font-size: inherit;
}

.score-view.busy {
	opacity: 0.6;
	transition: opacity 0.2s 0.15s;
}

.side {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.note-editor {
	border: 1px solid var(--border);
	border-radius: 6px;
	padding: 0.6rem;
	background: var(--panel);
}

.note-title {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	gap: 0.5rem;
	padding-bottom: 0.4rem;
	border-bottom: 1px solid var(--border);
}

/* no keyboard on a touch screen, as a rule */
@media (hover: none) {
	.note-editor .keys {
		display: none;
	}
}

/* a finger: bigger targets */
@media (pointer: coarse) {
	.toolbar button,
	.rows button,
	.actions button,
	.zoom button {
		min-height: 2.5rem;
	}

	.rows button {
		min-width: 2.5rem;
	}
}

/* a phone: the toolbar's groups on lines of their own */
@media (max-width: 640px) {
	.toolbar .section {
		padding-left: 0;
		border-left: none;
	}

	.toolbar .summary {
		flex-basis: 100%;
	}

	.side .note-editor {
		border: none;
		padding: 0;
	}
}

.note-editor .hint {
	margin: 0.35rem 0 0;
	font-size: 0.8rem;
}

/* a label, then its buttons (which wrap in their own column) */
.rows {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 0.4rem 0.6rem;
	align-items: center;
	margin-top: 0.6rem;
}

.group {
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
	align-items: center;
}

.group .gap {
	width: 0.5rem;
}

.actions {
	display: flex;
	gap: 0.4rem;
	margin-top: 0.6rem;
	padding-top: 0.5rem;
	border-top: 1px solid var(--border);
}

.actions .danger {
	margin-left: auto;
}

.rows button,
.actions button {
	padding: 0.25rem 0.5rem;
	font-size: 0.85rem;
	background: var(--bg);
	color: var(--ink);
	border: 1px solid var(--border);
}

.rows button[aria-pressed="true"] {
	background: var(--accent);
	color: var(--accent-ink);
	border-color: var(--accent);
}

.rows .label {
	color: var(--muted);
	font-size: 0.8rem;
}

.rows button.artic {
	min-width: 1.9rem;
	font-weight: 700;
}

.rows button.dyn {
	min-width: 1.9rem;
	font-family: "Times New Roman", Times, serif;
	font-style: italic;
	font-weight: 700;
}

.rows button:disabled {
	opacity: 0.45;
}

.actions button.danger {
	color: #b3372f;
}

button.link {
	background: none;
	border: none;
	color: var(--muted);
	padding: 0 0.25rem;
	cursor: pointer;
}
</style>
