import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type FormField, suggestAnswer } from "./answers.ts";
import { fetchBoard, type Job } from "./boards.ts";
import { ApplicationBrowser } from "./browser.ts";
import { canDiscover, discoverBoards, sortNewestFirst } from "./discover.ts";
import { filterJobs } from "./filter.ts";
import { type ApplicationStatus, appendRecord, handledJobIds, logPath, readRecords, submittedToday } from "./log.ts";
import { addBoards, loadProfile, missingProfileFields, type Profile, resumePath, saveProfile } from "./profile.ts";
import { type ProfileServer, startProfileServer } from "./profile-server.ts";

const FETCH_CONCURRENCY = 6;

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

function describeField(field: FormField, profile: Profile): string {
	const suggestion = suggestAnswer(field, profile);
	const parts = [`- ${field.id} [${field.kind}${field.required ? ", required" : ""}] ${field.label || "(no label)"}`];
	if (field.options.length > 0) parts.push(`  options: ${field.options.slice(0, 40).join(" | ")}`);
	if (field.value) parts.push(`  current value: ${field.value}`);
	parts.push(
		suggestion
			? `  suggested: ${suggestion.value} (from ${suggestion.source})`
			: "  suggested: NONE, answer it yourself or leave it empty",
	);
	return parts.join("\n");
}

export default function jobApply(pi: ExtensionAPI) {
	const jobs = new Map<string, Job>();
	let current: { job: Job; fields: FormField[] } | undefined;
	let browser: ApplicationBrowser | undefined;
	let server: ProfileServer | undefined;

	const getBrowser = (ctx: ExtensionContext) => {
		browser ??= new ApplicationBrowser({
			headless: process.env.JOB_APPLY_HEADLESS === "1",
			captchaTimeoutMs: Number(process.env.JOB_APPLY_CAPTCHA_TIMEOUT_MS ?? 10 * 60_000),
			onCaptcha: () =>
				ctx.ui.notify(
					"A CAPTCHA appeared in the job-apply browser window. Solve it there and the agent continues.",
					"warning",
				),
		});
		return browser;
	};

	pi.registerTool({
		name: "job_profile",
		label: "Job Profile",
		description:
			"Returns the applicant's profile (contact details, education, work authorization, saved answers) and resume text. Read it once before answering application questions.",
		promptSnippet: "Read the job applicant's profile and resume",
		parameters: Type.Object({}),
		async execute() {
			const profile = loadProfile();
			const missing = missingProfileFields(profile);
			const { boards: _boards, resumeText, ...rest } = profile;
			return text(
				[
					missing.length
						? `Profile is missing: ${missing.join(", ")}. Ask the user to run /job-profile.`
						: "Profile is complete.",
					"## Profile",
					JSON.stringify(rest, null, 2),
					"## Resume",
					resumeText || "(no resume text)",
				].join("\n"),
			);
		},
	});

	pi.registerTool({
		name: "job_search",
		label: "Job Search",
		description:
			"Finds open jobs on Greenhouse, Lever and Ashby boards that match the applicant's target roles, are in the US, are not yet applied to, and do not rule out visa sponsorship. Returns job ids for job_open_application.",
		promptSnippet: "Find matching jobs on Greenhouse, Lever and Ashby",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({ description: "Extra search terms for web discovery, e.g. 'new grad AI agent engineer'" }),
			),
			limit: Type.Optional(Type.Number({ description: "Maximum jobs to return (default 20)" })),
			discover: Type.Optional(
				Type.Boolean({
					description:
						"Use web search to find more company boards before searching (default true when ANTHROPIC_API_KEY is set)",
				}),
			),
		}),
		async execute(_id, params, signal, onUpdate) {
			const profile = loadProfile();
			const notes: string[] = [];
			if ((params.discover ?? true) && canDiscover()) {
				onUpdate?.(text("Searching the web for more company boards..."));
				try {
					const found = await discoverBoards(profile, params.query ?? "", signal);
					const added = addBoards(profile, found);
					if (added > 0) saveProfile(profile);
					notes.push(`Web search found ${found.length} boards (${added} new).`);
				} catch (error) {
					notes.push(`Web search failed: ${error instanceof Error ? error.message : String(error)}`);
				}
			} else if (params.discover) {
				notes.push("Web search skipped: ANTHROPIC_API_KEY is not set.");
			}

			onUpdate?.(text(`Fetching ${profile.boards.length} boards...`));
			const errors: string[] = [];
			const lists = await mapLimit(profile.boards, FETCH_CONCURRENCY, async (board) => {
				try {
					return await fetchBoard(board, signal);
				} catch (error) {
					errors.push(error instanceof Error ? error.message : String(error));
					return [];
				}
			});
			const records = readRecords();
			const { accepted, rejected } = filterJobs(lists.flat(), profile, handledJobIds(records));
			const selected = sortNewestFirst(accepted).slice(0, params.limit ?? 20);
			for (const job of selected) jobs.set(job.id, job);

			const sponsorshipSkips = rejected.filter((r) => r.reason.startsWith("no sponsorship")).length;
			const remaining = Math.max(0, profile.dailyLimit - submittedToday(records));
			const lines = [
				...notes,
				`Checked ${lists.flat().length} jobs on ${profile.boards.length} boards. ${accepted.length} match; ${sponsorshipSkips} skipped for no sponsorship.`,
				`Applications left today: ${remaining} of ${profile.dailyLimit}.`,
				...(errors.length ? [`Boards that failed: ${errors.join("; ")}`] : []),
				"",
				...selected.map((job) => `- ${job.id} | ${job.company} | ${job.title} | ${job.location}`),
			];
			return text(lines.join("\n"));
		},
	});

	pi.registerTool({
		name: "job_open_application",
		label: "Open Application",
		description:
			"Opens a job's application form in the browser and lists its fields with ids, options and answers suggested from the profile. Fields marked NONE need an answer written from the resume and job description.",
		promptSnippet: "Open a job application form and list its fields",
		executionMode: "sequential",
		parameters: Type.Object({
			jobId: Type.String({ description: "Job id from job_search" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const job = jobs.get(params.jobId);
			if (!job) return text(`Unknown job id ${params.jobId}. Run job_search first.`);
			const profile = loadProfile();
			const fields = await getBrowser(ctx).open(job.applyUrl);
			current = { job, fields };
			if (fields.length === 0)
				return text(`No form fields found at ${job.applyUrl}. Log it with job_log as needs_review.`);
			return text(
				[
					`# ${job.title} at ${job.company} (${job.location})`,
					job.applyUrl,
					"## Description (truncated)",
					job.description.slice(0, 2500),
					"## Form fields",
					...fields.map((f) => describeField(f, profile)),
				].join("\n"),
			);
		},
	});

	pi.registerTool({
		name: "job_fill_form",
		label: "Fill Application",
		description:
			"Fills fields of the open application form. Pass every field to fill, including suggested answers you accept. For file fields pass 'resume' to upload the resume. For checkbox groups separate choices with ';'.",
		promptSnippet: "Fill the open application form",
		executionMode: "sequential",
		parameters: Type.Object({
			answers: Type.Array(
				Type.Object({
					fieldId: Type.String(),
					value: Type.String(),
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!current) return text("No application is open. Call job_open_application first.");
			const results = await getBrowser(ctx).fill(params.answers, current.fields, resumePath(loadProfile()));
			const fields = await getBrowser(ctx).scan();
			current.fields = fields;
			const emptyRequired = fields.filter((f) => f.required && !f.value);
			return text(
				[
					...results.map((r) => `- ${r.fieldId}: ${r.ok ? "ok" : "FAILED"} ${r.note}`),
					emptyRequired.length
						? `Required fields still empty:\n${emptyRequired.map((f) => `- ${f.id} [${f.kind}] ${f.label}`).join("\n")}`
						: "All required fields have values.",
				].join("\n"),
			);
		},
	});

	pi.registerTool({
		name: "job_submit",
		label: "Submit Application",
		description:
			"Submits the open application and records it in the applications log. Returns validation errors if the form was rejected so they can be fixed and submitted again.",
		promptSnippet: "Submit the open job application",
		executionMode: "sequential",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (!current) return text("No application is open. Call job_open_application first.");
			const profile = loadProfile();
			const done = submittedToday(readRecords());
			if (done >= profile.dailyLimit)
				return text(`Daily limit reached (${done} of ${profile.dailyLimit}). Stop for today.`);
			if (!profile.autoSubmit && ctx.hasUI) {
				const ok = await ctx.ui.confirm("Submit application?", `${current.job.title} at ${current.job.company}`);
				if (!ok) return text("The user declined this submission. Log it with job_log as skipped and move on.");
			}
			const { job } = current;
			const result = await getBrowser(ctx).submit(job.id);
			if (result.status === "submitted") {
				appendRecord({
					appliedAt: new Date().toISOString(),
					company: job.company,
					title: job.title,
					location: job.location,
					ats: job.ats,
					jobId: job.id,
					url: job.applyUrl,
					status: "submitted",
					notes: result.screenshot ? `screenshot: ${result.screenshot}` : "",
				});
				current = undefined;
				return text(`Submitted. Logged to ${logPath()}. Submitted today: ${done + 1} of ${profile.dailyLimit}.`);
			}
			const detail = result.errors.length ? `\nErrors:\n${result.errors.map((e) => `- ${e}`).join("\n")}` : "";
			const advice =
				result.status === "validation_errors"
					? "Fix the fields with job_fill_form and call job_submit again (at most twice), otherwise log it as failed."
					: "Log it with job_log as needs_review and move on.";
			return text(`Not confirmed as submitted (${result.status}). Page: ${result.url}${detail}\n${advice}`);
		},
	});

	pi.registerTool({
		name: "job_log",
		label: "Log Application",
		description:
			"Records a job that was skipped, failed, or needs the user's review in the applications log so it is not retried.",
		promptSnippet: "Log a skipped or failed job application",
		parameters: Type.Object({
			jobId: Type.String(),
			status: StringEnum(["skipped", "failed", "needs_review"] as const),
			notes: Type.String({ description: "Short reason" }),
		}),
		async execute(_id, params) {
			const job = jobs.get(params.jobId);
			if (!job) return text(`Unknown job id ${params.jobId}.`);
			appendRecord({
				appliedAt: new Date().toISOString(),
				company: job.company,
				title: job.title,
				location: job.location,
				ats: job.ats,
				jobId: job.id,
				url: job.applyUrl,
				status: params.status as ApplicationStatus,
				notes: params.notes,
			});
			if (current?.job.id === job.id) current = undefined;
			return text(`Logged ${job.id} as ${params.status}.`);
		},
	});

	pi.registerCommand("job-profile", {
		description: "Open the page for uploading your resume and editing your job profile",
		handler: async (_args, ctx) => {
			server ??= await startProfileServer(Number(process.env.JOB_APPLY_PORT ?? 4729));
			ctx.ui.notify(`Job profile page: ${server.url}`, "info");
			const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
			await pi.exec(opener, [server.url]).catch(() => undefined);
		},
	});

	pi.registerCommand("apply", {
		description: "Find matching jobs and apply automatically. Optional argument: number of applications (default 10)",
		handler: async (args, ctx) => {
			const profile = loadProfile();
			const missing = missingProfileFields(profile);
			if (missing.length > 0) {
				ctx.ui.notify(`Profile is missing ${missing.join(", ")}. Run /job-profile first.`, "error");
				return;
			}
			const remaining = profile.dailyLimit - submittedToday(readRecords());
			if (remaining <= 0) {
				ctx.ui.notify(`Daily limit of ${profile.dailyLimit} applications reached.`, "warning");
				return;
			}
			const count = Math.min(Number.parseInt(args.trim(), 10) || 10, remaining);
			pi.sendUserMessage(`/skill:job-apply Apply to ${count} jobs.`, { expandPromptTemplates: true });
		},
	});

	pi.registerCommand("job-log", {
		description: "Show today's application count and where the log is saved",
		handler: async (_args, ctx) => {
			const records = readRecords();
			const profile = loadProfile();
			ctx.ui.notify(
				`Submitted today: ${submittedToday(records)} of ${profile.dailyLimit}. Total logged: ${records.length}. Log: ${logPath()}`,
				"info",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await browser?.close();
		browser = undefined;
		await server?.close();
		server = undefined;
	});
}
