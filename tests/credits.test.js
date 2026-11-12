import { describe, expect, it } from "vitest";
import { withCredits } from "../src/score.js";

const xml =
	'<?xml version="1.0"?>\n<!DOCTYPE score-partwise PUBLIC "x" "y">\n' +
	'<score-partwise version="4.0">\n  <identification>\n' +
	"    <encoding><software>copisteria</software></encoding>\n" +
	"  </identification>\n  <part-list/>\n</score-partwise>\n";

describe("the score's title and composer", () => {
	it("puts them in the score, the work first", () => {
		const out = withCredits(xml, { title: "Rondo", composer: "Clementi" });
		expect(out).toContain(
			'<score-partwise version="4.0"><work><work-title>Rondo</work-title></work>',
		);
		expect(out).toContain(
			'<identification><creator type="composer">Clementi</creator>',
		);
		// printed on the first page, before the part list
		expect(out).toMatch(
			/<credit-type>title<\/credit-type><credit-words [^>]*>Rondo<\/credit-words><\/credit><credit page="1"><credit-type>composer<\/credit-type>[\s\S]*<part-list/,
		);
	});

	it("replaces those it had, and drops empty ones", () => {
		const once = withCredits(xml, { title: "A", composer: "B" });
		const again = withCredits(once, { title: " C & D ", composer: "" });
		expect(again).toContain("<work-title>C &amp; D</work-title>");
		expect(again.match(/<work>/g)).toHaveLength(1);
		expect(again.match(/<credit /g)).toHaveLength(1);
		expect(again).not.toContain("creator");
		expect(withCredits(once, {})).toBe(withCredits(xml, {}));
		expect(withCredits(xml, {})).toBe(xml);
	});
});

describe("the parts' names", () => {
	const parts =
		'<?xml version="1.0"?>\n<score-partwise version="4.0">\n  <part-list>\n' +
		'    <score-part id="P1">\n      <part-name>Part 1</part-name>\n    </score-part>\n' +
		'    <score-part id="P2">\n      <part-name>Part 2</part-name>\n    </score-part>\n' +
		"  </part-list>\n</score-partwise>\n";

	it("names, hides, or keeps each part's name", () => {
		const out = withCredits(parts, { parts: [" Violin & co ", ""] });
		expect(out).toContain("<part-name>Violin &amp; co</part-name>");
		expect(out).toContain('<part-name print-object="no"></part-name>');
		expect(withCredits(parts, { parts: [undefined, "Cello"] })).toContain(
			"<part-name>Part 1</part-name>",
		);
	});

	it("shows a placeholder for a hidden name in the editor", () => {
		const out = withCredits(parts, { parts: ["", ""], placeholders: true });
		expect(out.match(/<part-name>\+ name<\/part-name>/g)).toHaveLength(2);
	});

	it("can be renamed again", () => {
		const once = withCredits(parts, { parts: ["", "Cello"] });
		expect(withCredits(once, { parts: ["Piano"] })).toContain(
			"<part-name>Piano</part-name>",
		);
	});
});

describe("the brackets", async () => {
	const { partGroups, withPartGroups } = await import("../src/score.js");
	const sp = (n) =>
		`<score-part id="P${n}"><part-name>Part ${n}</part-name></score-part>`;
	const part = (n, staves) =>
		`<part id="P${n}"><measure number="1"><attributes><staves>${staves}</staves></attributes></measure></part>`;
	const score = (list, parts) =>
		`<score-partwise version="4.0"><part-list>${list}</part-list>${parts}</score-partwise>`;

	it("reads the groups, and a piano's own brace", () => {
		const xml = score(
			'<part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group>' +
				sp(1) +
				sp(2) +
				'<part-group type="stop" number="1"/>' +
				sp(3),
			part(1, 1) + part(2, 1) + part(3, 2),
		);
		expect(partGroups(xml)).toEqual([
			{ first: 0, last: 1, symbol: "bracket", barline: true },
			{ first: 2, last: 2, symbol: "brace", barline: true },
		]);
	});

	it("writes nested groups, outer first, and reads them back", () => {
		const xml = score(
			sp(1) + sp(2) + sp(3),
			part(1, 2) + part(2, 2) + part(3, 1),
		);
		const groups = [
			{ first: 0, last: 0, symbol: "brace", barline: true },
			{ first: 0, last: 2, symbol: "square", barline: false },
			{ first: 1, last: 1, symbol: "none", barline: true },
			{ first: 2, last: 5, symbol: "line", barline: true }, // past the parts
		];
		const out = withPartGroups(xml, groups);
		expect(out.indexOf("<group-symbol>square")).toBeLessThan(
			out.indexOf("<group-symbol>brace"),
		);
		expect(partGroups(out)).toEqual([
			{ first: 0, last: 2, symbol: "square", barline: false },
			{ first: 0, last: 0, symbol: "brace", barline: true },
			{ first: 1, last: 1, symbol: "none", barline: true },
		]);
		// again: the old groups replaced, not added to
		expect(withPartGroups(out, groups)).toBe(out);
	});
});

describe("the clefs and key", async () => {
	const { scoreKey, staffClefs } = await import("../src/score.js");
	it("reads each staff's clef and the key", () => {
		const xml =
			'<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
			"<key><fifths>-3</fifths></key><staves>2</staves>" +
			'<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' +
			'<clef number="2"><sign>F</sign><line>4</line></clef></attributes></measure></part>' +
			'<part id="P2"><measure number="1"><attributes><clef><sign>C</sign><line>3</line></clef>' +
			"</attributes></measure></part></score-partwise>";
		expect(staffClefs(xml)).toEqual(["G2_8b", "F4", "C3"]);
		expect(scoreKey(xml)).toBe(-3);
	});
});

describe("the meters", () => {
	it("reads each measure's meter, from the first part", async () => {
		const { measureMeters } = await import("../src/score.js");
		const time = (b, t, attrs = "") =>
			`<attributes><time${attrs}><beats>${b}</beats><beat-type>${t}</beat-type></time></attributes>`;
		const xml =
			'<score-partwise><part id="P1">' +
			`<measure number="1">${time(3, 8)}</measure>` +
			'<measure number="2"></measure>' +
			`<measure number="3">${time(2, 4, ' print-object="no"')}</measure>` +
			'</part><part id="P2"><measure number="1">' +
			`${time(4, 4)}</measure></part></score-partwise>`;
		expect(measureMeters(xml)).toEqual(["3/8", "3/8", "2/4"]);
	});
});
