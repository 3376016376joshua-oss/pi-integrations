import type { Profile } from "./profile.ts";

export type FieldKind =
	| "text"
	| "textarea"
	| "select"
	| "radio"
	| "checkbox"
	| "file"
	| "combobox"
	| "buttons"
	| "date"
	| "number";

export interface FormField {
	/** Id the fill tool uses to find the element again (`data-pi-field`). */
	id: string;
	kind: FieldKind;
	label: string;
	required: boolean;
	options: string[];
	value: string;
}

export interface Suggestion {
	value: string;
	source: string;
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

const STOPWORDS = new Set(
	"a an the of to in on for with and or is are do does you your have has how many much what which who when where".split(
		" ",
	),
);

function tokens(text: string): Set<string> {
	return new Set(
		normalize(text)
			.split(" ")
			.filter((t) => t && !STOPWORDS.has(t)),
	);
}

export function similarity(a: string, b: string): number {
	const ta = tokens(a);
	const tb = tokens(b);
	if (ta.size === 0 || tb.size === 0) return 0;
	let shared = 0;
	for (const t of ta) if (tb.has(t)) shared++;
	return shared / Math.max(ta.size, tb.size);
}

const DECLINE = /decline|dont wish|do not wish|prefer not|not to (answer|disclose|say|identify)|choose not/;
const NEGATIVE = /^(no|none)\b|\bnot\b|\bdont\b|\bdo not\b/;

/** Picks the option that best represents `value`, or undefined when nothing fits. */
export function matchOption(options: string[], value: string): string | undefined {
	const target = normalize(value);
	if (!target) return undefined;
	const candidates = options.filter((o) => normalize(o) && !/^(select|choose|please select)\b/.test(normalize(o)));
	const exact = candidates.find((o) => normalize(o) === target);
	if (exact) return exact;
	const startsWith = candidates.find((o) => normalize(o).startsWith(target) || target.startsWith(normalize(o)));
	if (startsWith && (target === "yes" || target === "no" || normalize(startsWith).length > 2)) return startsWith;
	const contains = candidates.find((o) => normalize(o).includes(target) || target.includes(normalize(o)));
	if (contains && normalize(contains).length > 3) return contains;
	if (DECLINE.test(target)) return candidates.find((o) => DECLINE.test(normalize(o)));
	let best: { option: string; score: number } | undefined;
	for (const option of candidates) {
		const score = similarity(option, value);
		if (!best || score > best.score) best = { option, score };
	}
	if (best && best.score >= 0.5) return best.option;
	if (NEGATIVE.test(target)) return candidates.find((o) => NEGATIVE.test(normalize(o)) && !DECLINE.test(normalize(o)));
	if (target.startsWith("yes")) return candidates.find((o) => normalize(o).startsWith("yes"));
	return undefined;
}

type Rule = { pattern: RegExp; answer: (p: Profile) => string; source: string };

// Order matters: the first matching rule wins (sponsorship before work authorization).
const RULES: Rule[] = [
	{
		pattern: /preferred (first )?name/,
		answer: (p) => p.preferredName || p.firstName,
		source: "profile.preferredName",
	},
	{ pattern: /first name|given name/, answer: (p) => p.firstName, source: "profile.firstName" },
	{ pattern: /last name|family name|surname/, answer: (p) => p.lastName, source: "profile.lastName" },
	{
		pattern: /^(full |legal )?name\b|full name|legal name/,
		answer: (p) => `${p.firstName} ${p.lastName}`.trim(),
		source: "profile.name",
	},
	{ pattern: /e ?mail/, answer: (p) => p.email, source: "profile.email" },
	{ pattern: /phone|mobile/, answer: (p) => p.phone, source: "profile.phone" },
	{ pattern: /linkedin/, answer: (p) => p.linkedin, source: "profile.linkedin" },
	{ pattern: /github/, answer: (p) => p.github, source: "profile.github" },
	{
		pattern: /website|portfolio|personal (site|url)|other url/,
		answer: (p) => p.website || p.github,
		source: "profile.website",
	},
	// "Authorized to work without sponsorship?" has no honest one-word answer on OPT; leave it to the agent.
	{ pattern: /authori[sz]ed.*without.*sponsor/, answer: () => "", source: "agent" },
	{ pattern: /sponsor/, answer: (p) => yesNo(p.requiresSponsorship), source: "profile.requiresSponsorship" },
	{
		pattern: /authori[sz]ed to work|eligible to work|legally (able|permitted|authorized)|right to work/,
		answer: (p) => yesNo(p.authorizedToWorkInUS),
		source: "profile.authorizedToWorkInUS",
	},
	{
		pattern: /visa|immigration status|work authori[sz]ation status/,
		answer: (p) => p.visaStatus,
		source: "profile.visaStatus",
	},
	{ pattern: /gender|sex\b/, answer: (p) => p.gender, source: "profile.gender" },
	{ pattern: /hispanic|latino/, answer: (p) => p.hispanicOrLatino, source: "profile.hispanicOrLatino" },
	{ pattern: /\brace\b|ethnicity/, answer: (p) => p.race, source: "profile.race" },
	{ pattern: /veteran/, answer: (p) => p.veteranStatus, source: "profile.veteranStatus" },
	{ pattern: /disabilit/, answer: (p) => p.disabilityStatus, source: "profile.disabilityStatus" },
	{ pattern: /school|university|college|institution/, answer: (p) => p.school, source: "profile.school" },
	{ pattern: /graduat/, answer: (p) => p.graduationDate, source: "profile.graduationDate" },
	{ pattern: /\bdegree\b/, answer: (p) => p.degree, source: "profile.degree" },
	{ pattern: /major|discipline|field of study/, answer: (p) => p.major, source: "profile.major" },
	{ pattern: /\bgpa\b/, answer: (p) => p.gpa, source: "profile.gpa" },
	{
		pattern: /salary|compensation expectation|expected (pay|compensation)/,
		answer: (p) => p.salaryExpectation,
		source: "profile.salaryExpectation",
	},
	{
		pattern: /start date|when can you start|available to start|earliest/,
		answer: (p) => p.earliestStartDate,
		source: "profile.earliestStartDate",
	},
	{ pattern: /relocat/, answer: (p) => yesNo(p.willingToRelocate), source: "profile.willingToRelocate" },
	{
		pattern: /how did you hear|where did you (hear|find|learn)|referral source/,
		answer: (p) => p.howDidYouHear,
		source: "profile.howDidYouHear",
	},
	{
		pattern: /current (location|city)|^location\b|city/,
		answer: (p) => [p.city, p.state].filter(Boolean).join(", "),
		source: "profile.city",
	},
	{ pattern: /country/, answer: (p) => p.country, source: "profile.country" },
	{ pattern: /^state\b|state province|state of residence/, answer: (p) => p.state, source: "profile.state" },
];

/** Answers a field from the profile when the label is a standard question; undefined means the agent must answer. */
export function suggestAnswer(field: FormField, profile: Profile): Suggestion | undefined {
	const label = normalize(field.label);
	if (field.kind === "file") {
		if (/resume|cv\b/.test(label) && profile.resumeFile)
			return { value: profile.resumeFile, source: "profile.resumeFile" };
		return undefined;
	}
	let suggestion: Suggestion | undefined;
	const rule = RULES.find((r) => r.pattern.test(label));
	if (rule) {
		const value = rule.answer(profile);
		if (value) suggestion = { value, source: rule.source };
	}
	if (!suggestion) {
		let best: { answer: string; score: number } | undefined;
		for (const saved of profile.savedAnswers) {
			const score = similarity(saved.question, field.label);
			if (!best || score > best.score) best = { answer: saved.answer, score };
		}
		if (best && best.score >= 0.6) suggestion = { value: best.answer, source: "profile.savedAnswers" };
	}
	if (suggestion && field.options.length > 0 && field.kind !== "combobox") {
		const option = matchOption(field.options, suggestion.value);
		if (!option) return undefined;
		suggestion = { ...suggestion, value: option };
	}
	return suggestion;
}
