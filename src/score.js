// The score shown and edited: the pages' results (see pipeline/edit.js
// resultOf) together, with the joined MusicXML (given its title and composer)
// rendered.
import { CLEF_XML } from "./pipeline/copisteria/write.js";
import { renderMusicXml } from "./render/verovio.js";

const escapeXml = (s) =>
	s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// a title and composer, as the score keeps them (work, creator) and as they
// are printed on its first page (credits: what Verovio and others show)
const CREDIT_WORDS = {
	title: 'justify="center" valign="top" font-size="22"',
	composer: 'justify="right" valign="top" font-size="12"',
};
const credit = (type, text) =>
	`<credit page="1"><credit-type>${type}</credit-type>` +
	`<credit-words ${CREDIT_WORDS[type]}>${escapeXml(text)}</credit-words></credit>`;

// shown in the editor in place of a part's name left empty (hidden in the
// score itself), so that it can still be picked and named
export const PART_PLACEHOLDER = "+ name";

/**
 * The part names: `parts[k]` names part k + 1 (empty: no name shown;
 * undefined: as written, "Part 1"…); with `placeholders`, an empty one is
 * PART_PLACEHOLDER instead (for the editor).
 */
function withPartNames(xml, parts, placeholders) {
	return xml.replace(
		/(<score-part id="P(\d+)">\s*)<part-name\b[^>]*>[^<]*<\/part-name>/g,
		(tag, open, n) => {
			const name = parts[Number(n) - 1];
			if (typeof name !== "string") {
				return tag;
			}
			const text = name.trim();
			if (text) {
				return `${open}<part-name>${escapeXml(text)}</part-name>`;
			}
			return placeholders
				? `${open}<part-name>${PART_PLACEHOLDER}</part-name>`
				: `${open}<part-name print-object="no"></part-name>`;
		},
	);
}

/** The clef a MusicXML <clef> shows, by name (see vocab.js CLEFS). */
function clefName(clef) {
	const sign = clef.match(/<sign>\s*(\w+)/)?.[1];
	const line = Number(clef.match(/<line>\s*(\d+)/)?.[1] ?? 0) || null;
	const octave = Number(clef.match(/<clef-octave-change>\s*(-?\d+)/)?.[1] ?? 0);
	const found = Object.entries(CLEF_XML).find(
		([name, [s, l, o]]) =>
			name !== "other" &&
			s === sign &&
			(sign === "percussion" || l === line) &&
			o === octave,
	);
	return found?.[0] ?? null;
}

/**
 * Each staff's clef at the start of the score, in order (all parts' staves:
 * a staff's place, as in the systems), by name, or null.
 */
export function staffClefs(xml) {
	const out = [];
	for (const [part] of xml.matchAll(/<part id="[^"]*">[\s\S]*?<\/part>/g)) {
		const attrs = part.match(/<attributes>[\s\S]*?<\/attributes>/)?.[0] ?? "";
		const staves = Number(attrs.match(/<staves>(\d+)<\/staves>/)?.[1] ?? 1);
		const clefs = new Array(staves).fill(null);
		for (const [clef, n] of attrs.matchAll(
			/<clef(?: number="(\d+)")?[^>]*>[\s\S]*?<\/clef>/g,
		)) {
			clefs[Number(n ?? 1) - 1] = clefName(clef);
		}
		out.push(...clefs);
	}
	return out;
}

/** The score's key signature at its start, in fifths (-7 … 7). */
export const scoreKey = (xml) =>
	Number(xml.match(/<fifths>\s*(-?\d+)/)?.[1] ?? 0);

/** The meter of each measure ("3/4", …; null before any), of the first part. */
export function measureMeters(xml) {
	const part = xml.match(/<part id="[^"]*">[\s\S]*?<\/part>/)?.[0] ?? "";
	let meter = null;
	return part
		.split(/<measure\b/)
		.slice(1)
		.map((m) => {
			const t = m.match(
				/<time\b[^>]*>\s*<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/,
			);
			if (t) {
				meter = `${t[1]}/${t[2]}`;
			}
			return meter;
		});
}

// the brackets: a group of parts (first … last, counted from 0) joined by a
// symbol at the left of each system, its bar lines through all its staves or
// not. A part of several staves on its own (a piano) is a group of one part
// (its brace); a part in a larger group has no symbol of its own.
export const GROUP_SYMBOLS = ["brace", "bracket", "square", "line", "none"];

/** How many staves each part has, in order. */
export const partStaves = (xml) =>
	[...xml.matchAll(/<part id="[^"]*">[\s\S]*?<\/part>/g)].map(([part]) =>
		Number(part.match(/<staves>(\d+)<\/staves>/)?.[1] ?? 1),
	);

/**
 * The score's brackets, as shown: [{ first, last, symbol, barline }] (its
 * part groups, and the brace of each part of several staves not in one).
 */
export function partGroups(xml) {
	const list = xml.match(/<part-list>[\s\S]*?<\/part-list>/)?.[0] ?? "";
	const groups = [];
	const open = new Map(); // number → its group
	let part = 0;
	for (const [tag] of list.matchAll(
		/<part-group\b[^>]*?\/>|<part-group\b[^>]*>[\s\S]*?<\/part-group>|<score-part\b/g,
	)) {
		if (tag.startsWith("<score-part")) {
			part++;
			continue;
		}
		const number = tag.match(/\bnumber="([^"]*)"/)?.[1] ?? "1";
		if (/\btype="start"/.test(tag)) {
			const symbol = tag.match(/<group-symbol>\s*([a-z]+)/)?.[1] ?? "none";
			const barline = tag.match(/<group-barline>\s*([a-zA-Z]+)/)?.[1];
			open.set(number, {
				first: part,
				last: part,
				symbol: GROUP_SYMBOLS.includes(symbol) ? symbol : "bracket",
				barline: barline !== "no",
			});
		} else if (/\btype="stop"/.test(tag) && open.has(number)) {
			const g = open.get(number);
			open.delete(number);
			g.last = part - 1;
			if (g.last >= g.first) {
				groups.push(g);
			}
		}
	}
	// a part of several staves in no group: its brace (Verovio's own)
	partStaves(xml).forEach((staves, k) => {
		if (staves > 1 && !groups.some((g) => g.first <= k && k <= g.last)) {
			groups.push({ first: k, last: k, symbol: "brace", barline: true });
		}
	});
	return groups.sort((a, b) => a.first - b.first || b.last - a.last);
}

/**
 * The MusicXML with these brackets (see partGroups) in place of those it
 * had; groups past its last part are left out.
 */
export function withPartGroups(xml, groups) {
	const count = (xml.match(/<score-part\b/g) ?? []).length;
	const kept = groups
		.filter((g) => g.first <= g.last && g.last < count)
		.sort((a, b) => a.first - b.first || b.last - a.last); // outer first
	return xml.replace(/<part-list>[\s\S]*?<\/part-list>/, (list) => {
		let out = list.replace(
			/\s*(<part-group\b[^>]*?\/>|<part-group\b[^>]*>[\s\S]*?<\/part-group>)/g,
			"",
		);
		let k = -1;
		out = out.replace(/<score-part\b[\s\S]*?<\/score-part>/g, (sp) => {
			k++;
			const starts = kept
				.map((g, i) => [g, i + 1])
				.filter(([g]) => g.first === k)
				.map(
					([g, n]) =>
						`<part-group type="start" number="${n}"><group-symbol>${g.symbol}</group-symbol>` +
						`<group-barline>${g.barline ? "yes" : "no"}</group-barline></part-group>`,
				);
			const stops = kept
				.map((g, i) => [g, i + 1])
				.filter(([g]) => g.last === k)
				.reverse() // inner first
				.map(([, n]) => `<part-group type="stop" number="${n}"/>`);
			return [...starts, sp, ...stops].join("");
		});
		return out;
	});
}

/**
 * The MusicXML with this title and composer (either may be empty: none), in
 * place of those it had, the parts' names (see withPartNames) and, unless
 * null, these brackets (see withPartGroups).
 */
export function withCredits(
	musicXml,
	{
		title = "",
		composer = "",
		parts = [],
		groups = null,
		placeholders = false,
	} = {},
) {
	let xml = withPartNames(
		groups ? withPartGroups(musicXml, groups) : musicXml,
		parts ?? [],
		placeholders,
	)
		.replace(/<work>[\s\S]*?<\/work>/, "")
		.replace(/<creator type="composer">[\s\S]*?<\/creator>/, "")
		.replace(
			/<credit page="1"><credit-type>(title|composer)<\/credit-type>[\s\S]*?<\/credit>/g,
			"",
		);
	title = title.trim();
	composer = composer.trim();
	if (composer) {
		const creator = `<creator type="composer">${escapeXml(composer)}</creator>`;
		xml = xml.includes("<identification>")
			? xml.replace("<identification>", `<identification>${creator}`)
			: xml.replace(
					/<part-list\b/,
					`<identification>${creator}</identification><part-list`,
				);
	}
	// the credits come just before the part list, the work first of all
	const credits =
		(title ? credit("title", title) : "") +
		(composer ? credit("composer", composer) : "");
	if (credits) {
		xml = xml.replace(/<part-list\b/, `${credits}<part-list`);
	}
	if (title) {
		xml = xml.replace(
			/<score-partwise\b[^>]*>/,
			(open) =>
				`${open}<work><work-title>${escapeXml(title)}</work-title></work>`,
		);
	}
	return xml;
}

const SUMMED = ["staves", "systems", "notes", "rests", "changed", "edited"];

/**
 * { pageResults, musicXml, symbols (all pages, in order), summary (summed),
 * unplaced, svg } from the pages' results and the whole score's MusicXML,
 * given `credits` ({ title, composer }, see withCredits).
 */
export async function buildScore(pageResults, xml, credits = {}) {
	const musicXml = withCredits(xml, credits);
	const summary = Object.fromEntries(
		SUMMED.map((k) => [
			k,
			pageResults.reduce((n, r) => n + (r.summary[k] ?? 0), 0),
		]),
	);
	summary.pages = pageResults.length;
	// in the editor, the parts left without a name show a placeholder (marked
	// "placeholder", to be drawn faint)
	const shown = withCredits(xml, { ...credits, placeholders: true });
	const svg =
		summary.notes + summary.rests > 0
			? (await renderMusicXml(shown)).map((page) =>
					page.replace(/<g id="[^"]+" class="label">[\s\S]*?<\/g>/g, (g) =>
						g.includes(`>${PART_PLACEHOLDER}<`)
							? g.replace('class="label"', 'class="label placeholder"')
							: g,
					),
				)
			: [];
	return {
		pageResults,
		musicXml,
		symbols: pageResults.flatMap((r) => r.symbols),
		clefs: pageResults.flatMap((r) => r.clefs ?? []),
		summary,
		unplaced: pageResults.reduce((n, r) => n + (r.unplaced ?? 0), 0),
		svg,
	};
}
