import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { type FormField, matchOption, suggestAnswer } from "../src/answers.ts";
import { extractBoards, type Job, parseAshby, parseGreenhouse, parseLever } from "../src/boards.ts";
import { filterJobs, isUSLocation, noSponsorshipReason, titleMatches } from "../src/filter.ts";
import { appendRecord, handledJobIds, parseCsv, readRecords, submittedToday } from "../src/log.ts";
import { defaultProfile, type Profile } from "../src/profile.ts";
import { sanitizeProfile } from "../src/profile-server.ts";

function profile(overrides: Partial<Profile> = {}): Profile {
	return {
		...defaultProfile(),
		firstName: "Alex",
		lastName: "Chen",
		email: "alex@example.com",
		phone: "555-0100",
		city: "Seattle",
		state: "WA",
		school: "University of Washington",
		resumeFile: "resume.pdf",
		...overrides,
	};
}

function field(label: string, kind: FormField["kind"] = "text", options: string[] = []): FormField {
	return { id: "f0", kind, label, required: true, options, value: "" };
}

describe("titleMatches", () => {
	const p = profile();
	it("accepts entry-level engineering titles", () => {
		assert.equal(titleMatches("Software Engineer, New Grad", p), true);
		assert.equal(titleMatches("SWE - Backend", p), true);
		assert.equal(titleMatches("AI Agent Engineer", p), true);
	});
	it("rejects senior and unrelated titles", () => {
		assert.equal(titleMatches("Senior Software Engineer", p), false);
		assert.equal(titleMatches("Staff SWE", p), false);
		assert.equal(titleMatches("Account Executive", p), false);
	});
	it("matches whole words only", () => {
		// "iv" is excluded but must not block "Driver"; "sr" must not block "Software Engineer, Srvc"
		assert.equal(titleMatches("Software Engineer, Driver Platform", p), true);
		assert.equal(titleMatches("Software Engineer IV", p), false);
	});
});

describe("isUSLocation", () => {
	it("accepts US cities, states and US remote", () => {
		assert.equal(isUSLocation("San Francisco, CA"), true);
		assert.equal(isUSLocation("New York City"), true);
		assert.equal(isUSLocation("Remote - US"), true);
		assert.equal(isUSLocation("Remote"), true);
		assert.equal(isUSLocation("London, UK; Seattle, WA"), true);
	});
	it("rejects non-US locations", () => {
		assert.equal(isUSLocation("London, UK"), false);
		assert.equal(isUSLocation("Remote - Canada"), false);
		assert.equal(isUSLocation("Bengaluru, India"), false);
		assert.equal(isUSLocation("Latin America"), false);
		assert.equal(isUSLocation(""), false);
	});
});

describe("noSponsorshipReason", () => {
	it("finds sentences that rule out sponsorship", () => {
		assert.match(
			noSponsorshipReason("Great team. We are unable to sponsor visas at this time. Apply now.") ?? "",
			/unable to sponsor/,
		);
		assert.ok(noSponsorshipReason("Candidates must be authorized to work in the US without sponsorship."));
		assert.ok(noSponsorshipReason("Must be a U.S. citizen."));
		assert.ok(noSponsorshipReason("An active Secret clearance is needed."));
	});
	it("ignores descriptions that allow sponsorship", () => {
		assert.equal(noSponsorshipReason("We sponsor H-1B visas and welcome international candidates."), undefined);
	});
});

describe("filterJobs", () => {
	const base: Job = {
		id: "greenhouse:acme:1",
		ats: "greenhouse",
		company: "acme",
		title: "Software Engineer",
		location: "Austin, TX",
		applyUrl: "https://example.com",
		description: "",
	};
	it("keeps matches and explains rejections", () => {
		const jobs: Job[] = [
			base,
			{ ...base, id: "greenhouse:acme:2", description: "We do not sponsor visas." },
			{ ...base, id: "greenhouse:acme:3", location: "Toronto, Canada" },
			{ ...base, id: "greenhouse:acme:4" },
		];
		const result = filterJobs(jobs, profile(), new Set(["greenhouse:acme:4"]));
		assert.deepEqual(
			result.accepted.map((j) => j.id),
			["greenhouse:acme:1"],
		);
		assert.deepEqual(
			result.rejected.map((r) => r.reason.split(":")[0]),
			["no sponsorship", "location not in the US", "already applied"],
		);
	});
});

describe("board parsers", () => {
	it("normalizes Greenhouse, Lever and Ashby payloads", () => {
		const gh = parseGreenhouse("acme", {
			jobs: [{ id: 7, title: "SWE", location: { name: "NYC" }, content: "&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;" }],
		});
		assert.equal(gh[0].applyUrl, "https://job-boards.greenhouse.io/acme/jobs/7");
		assert.equal(gh[0].description, "Build & ship");
		const lever = parseLever("acme", [
			{
				id: "abc",
				text: "SWE",
				hostedUrl: "https://jobs.lever.co/acme/abc",
				categories: { location: "Austin, TX" },
			},
		]);
		assert.equal(lever[0].applyUrl, "https://jobs.lever.co/acme/abc/apply");
		const ashby = parseAshby("acme", {
			jobs: [
				{ id: "x", title: "SWE", location: "Remote", jobUrl: "https://jobs.ashbyhq.com/acme/x", isRemote: true },
				{ id: "y", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/y", isListed: false },
			],
		});
		assert.equal(ashby.length, 1);
		assert.equal(ashby[0].applyUrl, "https://jobs.ashbyhq.com/acme/x/application");
	});
	it("extracts board tokens from URLs", () => {
		const boards = extractBoards(
			"https://job-boards.greenhouse.io/Stripe/jobs/123 https://jobs.lever.co/palantir/abc https://jobs.ashbyhq.com/openai/xyz https://boards.greenhouse.io/embed/job_board?for=figma",
		);
		assert.deepEqual(
			boards.map((b) => `${b.ats}:${b.token}`),
			["greenhouse:stripe", "greenhouse:figma", "lever:palantir", "ashby:openai"],
		);
	});
});

describe("answers", () => {
	const p = profile();
	it("answers standard questions from the profile", () => {
		assert.equal(suggestAnswer(field("First Name*"), p)?.value, "Alex");
		assert.equal(suggestAnswer(field("Email"), p)?.value, "alex@example.com");
		assert.equal(
			suggestAnswer(
				field("Will you now or in the future require sponsorship?", "select", ["Select...", "Yes", "No"]),
				p,
			)?.value,
			"Yes",
		);
		assert.equal(
			suggestAnswer(field("Are you legally authorized to work in the United States?", "radio", ["Yes", "No"]), p)
				?.value,
			"Yes",
		);
		assert.equal(suggestAnswer(field("Resume/CV", "file"), p)?.value, "resume.pdf");
	});
	it("maps EEO answers onto the form's wording", () => {
		const veteran = suggestAnswer(
			field("Veteran Status", "select", [
				"I am a protected veteran",
				"I am not a protected veteran",
				"I don't wish to answer",
			]),
			p,
		);
		assert.equal(veteran?.value, "I am not a protected veteran");
		const disability = suggestAnswer(
			field("Disability Status", "radio", [
				"Yes, I have a disability (or previously had a disability)",
				"No, I do not have a disability and have not had one in the past",
				"I do not want to answer",
			]),
			p,
		);
		assert.equal(disability?.value, "No, I do not have a disability and have not had one in the past");
		assert.equal(
			suggestAnswer(field("Race", "select", ["White", "Asian", "Decline To Self Identify"]), p)?.value,
			"Decline To Self Identify",
		);
		assert.equal(suggestAnswer(field("Gender", "select", ["Male", "Female", "Decline"]), p)?.value, "Male");
	});
	it("leaves open and ambiguous questions to the agent", () => {
		assert.equal(suggestAnswer(field("Why do you want to work at Acme?", "textarea"), p), undefined);
		assert.equal(
			suggestAnswer(field("Are you authorized to work in the US without sponsorship?", "radio", ["Yes", "No"]), p),
			undefined,
		);
		assert.equal(suggestAnswer(field("Please state why you are interested"), p), undefined);
	});
	it("uses saved answers for repeated questions", () => {
		const withSaved = profile({ savedAnswers: [{ question: "Years of Python experience", answer: "3" }] });
		assert.equal(suggestAnswer(field("How many years of Python experience do you have?"), withSaved)?.value, "3");
	});
	it("matchOption prefers exact, then yes/no", () => {
		assert.equal(matchOption(["Yes", "No"], "no"), "No");
		assert.equal(matchOption(["Yes, I will", "No, I won't"], "Yes"), "Yes, I will");
		assert.equal(matchOption(["Apple", "Banana"], "Cherry"), undefined);
	});
});

describe("applications log", () => {
	it("round-trips CSV with quotes and commas", () => {
		const path = join(mkdtempSync(join(tmpdir(), "job-apply-")), "log.csv");
		const record = {
			appliedAt: new Date().toISOString(),
			company: "acme",
			title: 'Engineer, "AI"',
			location: "Austin, TX",
			ats: "greenhouse",
			jobId: "greenhouse:acme:1",
			url: "https://example.com",
			status: "submitted" as const,
			notes: "line one\nline two",
		};
		appendRecord(record, path);
		appendRecord({ ...record, jobId: "greenhouse:acme:2", status: "skipped" }, path);
		const records = readRecords(path);
		assert.deepEqual(records[0], record);
		assert.equal(submittedToday(records), 1);
		assert.deepEqual([...handledJobIds(records)], ["greenhouse:acme:1", "greenhouse:acme:2"]);
		assert.deepEqual(parseCsv('a,"b,c"\n'), [["a", "b,c"]]);
	});
});

describe("sanitizeProfile", () => {
	it("keeps known keys with the right types only", () => {
		const next = sanitizeProfile(
			{ firstName: "Sam", dailyLimit: "lots", resumeFile: "../../etc/passwd", unknown: 1 },
			profile(),
		);
		assert.equal(next.firstName, "Sam");
		assert.equal(next.dailyLimit, 50);
		assert.equal(next.resumeFile, "resume.pdf");
		assert.equal("unknown" in next, false);
	});
});
