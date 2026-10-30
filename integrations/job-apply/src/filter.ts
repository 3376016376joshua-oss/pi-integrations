import type { Job } from "./boards.ts";
import type { Profile } from "./profile.ts";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive phrase match, so "iv" does not match "Driver". */
export function containsPhrase(text: string, phrase: string): boolean {
	const trimmed = phrase.trim();
	if (!trimmed) return false;
	return new RegExp(`(^|[^a-z0-9])${escapeRegExp(trimmed.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase());
}

export function titleMatches(title: string, profile: Profile): boolean {
	if (profile.excludeKeywords.some((k) => containsPhrase(title, k))) return false;
	return profile.roleKeywords.some((k) => containsPhrase(title, k));
}

const US_STATES = [
	"alabama|al",
	"alaska|ak",
	"arizona|az",
	"arkansas|ar",
	"california|ca",
	"colorado|co",
	"connecticut|ct",
	"delaware|de",
	"florida|fl",
	"georgia|ga",
	"hawaii|hi",
	"idaho|id",
	"illinois|il",
	"indiana|in",
	"iowa|ia",
	"kansas|ks",
	"kentucky|ky",
	"louisiana|la",
	"maine|me",
	"maryland|md",
	"massachusetts|ma",
	"michigan|mi",
	"minnesota|mn",
	"mississippi|ms",
	"missouri|mo",
	"montana|mt",
	"nebraska|ne",
	"nevada|nv",
	"new hampshire|nh",
	"new jersey|nj",
	"new mexico|nm",
	"new york|ny",
	"north carolina|nc",
	"north dakota|nd",
	"ohio|oh",
	"oklahoma|ok",
	"oregon|or",
	"pennsylvania|pa",
	"rhode island|ri",
	"south carolina|sc",
	"south dakota|sd",
	"tennessee|tn",
	"texas|tx",
	"utah|ut",
	"vermont|vt",
	"virginia|va",
	"washington|wa",
	"west virginia|wv",
	"wisconsin|wi",
	"wyoming|wy",
	"district of columbia|dc",
];

const US_CITIES = [
	"san francisco",
	"new york",
	"nyc",
	"seattle",
	"austin",
	"boston",
	"los angeles",
	"chicago",
	"denver",
	"palo alto",
	"mountain view",
	"menlo park",
	"sunnyvale",
	"san jose",
	"san mateo",
	"redwood city",
	"bay area",
	"atlanta",
	"miami",
	"pittsburgh",
	"philadelphia",
	"washington dc",
	"washington, d.c.",
	"bellevue",
	"cambridge, ma",
	"salt lake city",
	"san diego",
	"dallas",
	"houston",
	"portland",
];

const US_MARKERS = /(^|[^a-z])(united states|usa|u\.s\.a?\.?|us)($|[^a-z])/;
const NON_US_COUNTRIES =
	/(canada|united kingdom|\buk\b|england|london|ireland|dublin|germany|berlin|france|paris|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|australia|sydney|netherlands|amsterdam|spain|poland|brazil|mexico|israel|tel aviv|china|korea|toronto|vancouver|emea|apac|latam|europe)/;

function mentionsUS(location: string): boolean {
	const text = location.toLowerCase();
	if (US_MARKERS.test(text)) return true;
	if (US_CITIES.some((city) => text.includes(city))) return true;
	for (const state of US_STATES) {
		const [name, abbr] = state.split("|");
		if (text.includes(name)) return true;
		// Abbreviations only count in "City, ST" form to avoid matching words like "in" or "or".
		if (new RegExp(`,\\s*${abbr}($|[^a-z])`).test(text)) return true;
	}
	return false;
}

/** True when at least one listed location is in the US, or the job is remote without a non-US region. */
export function isUSLocation(location: string): boolean {
	const parts = location
		.split(/;|\||\bor\b|\//i)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return false;
	return parts.some((part) => {
		if (mentionsUS(part)) return true;
		const lower = part.toLowerCase();
		return lower.includes("remote") && !NON_US_COUNTRIES.test(lower);
	});
}

const NO_SPONSORSHIP_PATTERNS = [
	/(unable|not able|will not|won'?t|cannot|can'?t|do not|does not|don'?t|are not able|is not able)\s+(to\s+)?(provide\s+|offer\s+|support\s+)?(visa\s+|immigration\s+|employment\s+)?sponsor/i,
	/no\s+(visa\s+|immigration\s+)?sponsorship/i,
	/sponsorship\s+(is\s+)?not\s+(available|provided|offered|supported)/i,
	/without\s+(the\s+need\s+for\s+)?(current\s+or\s+future\s+)?(visa\s+|employer\s+|immigration\s+)?sponsorship/i,
	/must\s+be\s+(a\s+)?(u\.?s\.?|united states)\s+citizen/i,
	/(u\.?s\.?|united states)\s+citizenship\s+(is\s+)?required/i,
	/(active|current)\s+(secret|top secret|ts\/sci|security)\s+clearance/i,
	/(security\s+clearance|ts\/sci)\s+(is\s+)?required/i,
	/green\s+card\s+holders?\s+only/i,
];

/** Returns the matching sentence when a description rules out visa sponsorship. */
export function noSponsorshipReason(description: string): string | undefined {
	for (const pattern of NO_SPONSORSHIP_PATTERNS) {
		const match = pattern.exec(description);
		if (match) {
			const start = Math.max(0, description.lastIndexOf(".", match.index) + 1);
			const end = description.indexOf(".", match.index + match[0].length);
			return description.slice(start, end === -1 ? undefined : end + 1).trim();
		}
	}
	return undefined;
}

export interface FilterResult {
	accepted: Job[];
	rejected: { job: Job; reason: string }[];
}

export function filterJobs(jobs: Job[], profile: Profile, appliedIds: Set<string>): FilterResult {
	const result: FilterResult = { accepted: [], rejected: [] };
	for (const job of jobs) {
		let reason: string | undefined;
		if (appliedIds.has(job.id)) reason = "already applied";
		else if (!titleMatches(job.title, profile)) reason = "title does not match target roles";
		else if (!isUSLocation(job.location)) reason = `location not in the US: ${job.location}`;
		else if (profile.skipNoSponsorship && profile.requiresSponsorship) {
			const sentence = noSponsorshipReason(job.description);
			if (sentence) reason = `no sponsorship: ${sentence}`;
		}
		if (reason) result.rejected.push({ job, reason });
		else result.accepted.push(job);
	}
	return result;
}
