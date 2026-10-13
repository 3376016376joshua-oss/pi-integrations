import Anthropic from "@anthropic-ai/sdk";
import { extractBoards, type Job } from "./boards.ts";
import type { Board, Profile } from "./profile.ts";

export const DEFAULT_SEARCH_MODEL = "claude-opus-5-5";

export function canDiscover(): boolean {
	return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Uses Claude's web search tool to find Greenhouse, Lever and Ashby boards with matching openings.
 * Only the board tokens are kept; job details always come from the boards' own APIs.
 */
export async function discoverBoards(profile: Profile, query: string, signal?: AbortSignal): Promise<Board[]> {
	const client = new Anthropic();
	const roles = profile.roleKeywords.slice(0, 6).join(", ");
	const prompt = [
		`Find current job postings in the United States for: ${query || roles}.`,
		"Only postings hosted on job-boards.greenhouse.io, boards.greenhouse.io, jobs.lever.co or jobs.ashbyhq.com count.",
		"Prefer entry-level and new-grad roles at companies that sponsor H-1B visas.",
		'Run several searches (for example site:jobs.ashbyhq.com "software engineer"), then list every matching posting URL you found, one per line.',
	].join("\n");

	const response = await client.beta.messages.create(
		{
			model: process.env.JOB_APPLY_SEARCH_MODEL ?? DEFAULT_SEARCH_MODEL,
			max_tokens: 16000,
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
			output_config: { effort: "low" },
			tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
			messages: [{ role: "user", content: prompt }],
		},
		{ signal },
	);
	if (response.stop_reason === "refusal") return [];

	const urls: string[] = [];
	for (const block of response.content) {
		if (block.type === "text") urls.push(block.text);
		if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
			for (const result of block.content) urls.push(result.url);
		}
	}
	return extractBoards(urls.join("\n"));
}

export function sortNewestFirst(jobs: Job[]): Job[] {
	return [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}
