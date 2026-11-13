import type { Ats, Board } from "./profile.ts";

export interface Job {
	/** Stable id used for dedupe: `<ats>:<token>:<job id>`. */
	id: string;
	ats: Ats;
	company: string;
	title: string;
	location: string;
	/** Page with the application form. */
	applyUrl: string;
	description: string;
	postedAt?: string;
}

interface GreenhouseJob {
	id: number;
	title: string;
	location?: { name?: string };
	updated_at?: string;
	first_published?: string;
	content?: string;
}

interface LeverPosting {
	id: string;
	text: string;
	hostedUrl: string;
	applyUrl?: string;
	categories?: { location?: string; allLocations?: string[] };
	workplaceType?: string;
	descriptionPlain?: string;
	additionalPlain?: string;
	lists?: { text: string; content: string }[];
	createdAt?: number;
}

interface AshbyJob {
	id: string;
	title: string;
	location?: string;
	secondaryLocations?: { location?: string }[];
	isRemote?: boolean;
	isListed?: boolean;
	jobUrl: string;
	applyUrl?: string;
	descriptionPlain?: string;
	publishedAt?: string;
}

const DESCRIPTION_LIMIT = 6000;

function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

/** Greenhouse returns HTML that is itself entity-escaped, so decode, strip tags, then decode the text. */
export function htmlToText(html: string): string {
	return decodeEntities(
		decodeEntities(html)
			.replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n")
		.trim();
}

export function parseGreenhouse(token: string, payload: { jobs: GreenhouseJob[] }): Job[] {
	return payload.jobs.map((job) => ({
		id: `greenhouse:${token}:${job.id}`,
		ats: "greenhouse",
		company: token,
		title: job.title,
		location: job.location?.name ?? "",
		// The hosted board always carries the form; absolute_url may point at a company page with an embed.
		applyUrl: `https://job-boards.greenhouse.io/${token}/jobs/${job.id}`,
		description: htmlToText(job.content ?? "").slice(0, DESCRIPTION_LIMIT),
		postedAt: job.first_published ?? job.updated_at,
	}));
}

export function parseLever(token: string, payload: LeverPosting[]): Job[] {
	return payload.map((posting) => {
		const lists = (posting.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
		const description = [posting.descriptionPlain, lists, posting.additionalPlain].filter(Boolean).join("\n");
		const locations = posting.categories?.allLocations?.length
			? posting.categories.allLocations
			: [posting.categories?.location ?? ""];
		if (posting.workplaceType === "remote") locations.push("Remote");
		return {
			id: `lever:${token}:${posting.id}`,
			ats: "lever",
			company: token,
			title: posting.text,
			location: locations.filter(Boolean).join("; "),
			applyUrl: posting.applyUrl ?? `${posting.hostedUrl}/apply`,
			description: description.slice(0, DESCRIPTION_LIMIT),
			postedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : undefined,
		};
	});
}

export function parseAshby(token: string, payload: { jobs: AshbyJob[] }): Job[] {
	return payload.jobs
		.filter((job) => job.isListed !== false)
		.map((job) => {
			const locations = [job.location ?? "", ...(job.secondaryLocations ?? []).map((l) => l.location ?? "")];
			if (job.isRemote) locations.push("Remote");
			return {
				id: `ashby:${token}:${job.id}`,
				ats: "ashby",
				company: token,
				title: job.title,
				location: locations.filter(Boolean).join("; "),
				applyUrl: job.applyUrl ?? `${job.jobUrl}/application`,
				description: (job.descriptionPlain ?? "").slice(0, DESCRIPTION_LIMIT),
				postedAt: job.publishedAt,
			};
		});
}

function boardApiUrl(board: Board): string {
	const token = encodeURIComponent(board.token);
	switch (board.ats) {
		case "greenhouse":
			return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
		case "lever":
			return `https://api.lever.co/v0/postings/${token}?mode=json`;
		case "ashby":
			return `https://api.ashbyhq.com/posting-api/job-board/${token}`;
	}
}

export async function fetchBoard(board: Board, signal?: AbortSignal): Promise<Job[]> {
	const response = await fetch(boardApiUrl(board), { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`${board.ats}/${board.token}: HTTP ${response.status}`);
	const payload: unknown = await response.json();
	switch (board.ats) {
		case "greenhouse":
			return parseGreenhouse(board.token, payload as { jobs: GreenhouseJob[] });
		case "lever":
			return parseLever(board.token, payload as LeverPosting[]);
		case "ashby":
			return parseAshby(board.token, payload as { jobs: AshbyJob[] });
	}
}

const BOARD_URL_PATTERNS: { ats: Ats; pattern: RegExp }[] = [
	{
		ats: "greenhouse",
		pattern: /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g,
	},
	{ ats: "lever", pattern: /jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_.-]+)/g },
	{ ats: "ashby", pattern: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/g },
];

const NOT_A_BOARD = new Set(["embed", "v1", "jobs", "api", "search"]);

/** Extracts unique ATS board tokens from any text containing job URLs. */
export function extractBoards(text: string): Board[] {
	const found = new Map<string, Board>();
	for (const { ats, pattern } of BOARD_URL_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const token = decodeURIComponent(match[1]).toLowerCase();
			if (NOT_A_BOARD.has(token)) continue;
			found.set(`${ats}:${token}`, { ats, token });
		}
	}
	return [...found.values()];
}
