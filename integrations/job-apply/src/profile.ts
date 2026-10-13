import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Ats = "greenhouse" | "lever" | "ashby";

export interface Board {
	ats: Ats;
	token: string;
}

export interface SavedAnswer {
	question: string;
	answer: string;
}

export interface Profile {
	firstName: string;
	lastName: string;
	preferredName: string;
	email: string;
	phone: string;
	city: string;
	state: string;
	country: string;
	linkedin: string;
	github: string;
	website: string;
	school: string;
	degree: string;
	major: string;
	graduationDate: string;
	gpa: string;
	authorizedToWorkInUS: boolean;
	requiresSponsorship: boolean;
	visaStatus: string;
	gender: string;
	race: string;
	hispanicOrLatino: string;
	veteranStatus: string;
	disabilityStatus: string;
	salaryExpectation: string;
	earliestStartDate: string;
	willingToRelocate: boolean;
	howDidYouHear: string;
	/** Title must contain one of these words or phrases (case-insensitive, whole words). */
	roleKeywords: string[];
	/** Title must contain none of these. */
	excludeKeywords: string[];
	/** Skip jobs whose description says the company will not sponsor visas. */
	skipNoSponsorship: boolean;
	dailyLimit: number;
	/** When false, pi asks for confirmation before each submit. */
	autoSubmit: boolean;
	/** File name of the uploaded resume inside the data directory. */
	resumeFile: string;
	/** Plain-text resume the agent reads to answer questions. */
	resumeText: string;
	savedAnswers: SavedAnswer[];
	boards: Board[];
}

export function dataDir(): string {
	const dir = process.env.JOB_APPLY_HOME ?? join(homedir(), ".pi", "job-apply");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function profilePath(): string {
	return join(dataDir(), "profile.json");
}

export function resumePath(profile: Profile): string | undefined {
	if (!profile.resumeFile) return undefined;
	const path = join(dataDir(), profile.resumeFile);
	return existsSync(path) ? path : undefined;
}

export function defaultProfile(): Profile {
	return {
		firstName: "",
		lastName: "",
		preferredName: "",
		email: "",
		phone: "",
		city: "",
		state: "",
		country: "United States",
		linkedin: "",
		github: "",
		website: "",
		school: "",
		degree: "",
		major: "",
		graduationDate: "",
		gpa: "",
		authorizedToWorkInUS: true,
		requiresSponsorship: true,
		visaStatus: "F-1 OPT",
		gender: "Male",
		race: "Decline to self-identify",
		hispanicOrLatino: "No",
		veteranStatus: "I am not a protected veteran",
		disabilityStatus: "No, I do not have a disability",
		salaryExpectation: "",
		earliestStartDate: "Immediately",
		willingToRelocate: true,
		howDidYouHear: "Company job board",
		roleKeywords: [
			"software engineer",
			"software developer",
			"software development engineer",
			"sde",
			"swe",
			"ai engineer",
			"ai agent",
			"agent engineer",
			"applied ai",
			"machine learning engineer",
			"ml engineer",
			"backend engineer",
			"full stack",
			"fullstack",
			"new grad",
		],
		excludeKeywords: [
			"senior",
			"sr",
			"staff",
			"principal",
			"lead",
			"manager",
			"director",
			"head of",
			"architect",
			"distinguished",
			"intern",
			"iii",
			"iv",
		],
		skipNoSponsorship: true,
		dailyLimit: 50,
		autoSubmit: true,
		resumeFile: "",
		resumeText: "",
		savedAnswers: [],
		// Starter boards; edit them on the profile page. Web search adds more.
		boards: [
			{ ats: "greenhouse", token: "anthropic" },
			{ ats: "greenhouse", token: "stripe" },
			{ ats: "greenhouse", token: "databricks" },
			{ ats: "greenhouse", token: "figma" },
			{ ats: "greenhouse", token: "robinhood" },
			{ ats: "greenhouse", token: "discord" },
			{ ats: "greenhouse", token: "cloudflare" },
			{ ats: "greenhouse", token: "datadog" },
			{ ats: "lever", token: "palantir" },
			{ ats: "lever", token: "plaid" },
			{ ats: "ashby", token: "openai" },
			{ ats: "ashby", token: "ramp" },
			{ ats: "ashby", token: "notion" },
			{ ats: "ashby", token: "linear" },
		],
	};
}

export function loadProfile(): Profile {
	const path = profilePath();
	if (!existsSync(path)) return defaultProfile();
	const stored = JSON.parse(readFileSync(path, "utf8")) as Partial<Profile>;
	return { ...defaultProfile(), ...stored };
}

export function saveProfile(profile: Profile): void {
	writeFileSync(profilePath(), `${JSON.stringify(profile, null, "\t")}\n`);
}

/** Returns the names of required fields that are still empty. */
export function missingProfileFields(profile: Profile): string[] {
	const missing: string[] = [];
	if (!profile.firstName) missing.push("first name");
	if (!profile.lastName) missing.push("last name");
	if (!profile.email) missing.push("email");
	if (!profile.phone) missing.push("phone");
	if (!resumePath(profile)) missing.push("resume file");
	if (!profile.resumeText.trim()) missing.push("resume text");
	return missing;
}

export function addBoards(profile: Profile, boards: Board[]): number {
	let added = 0;
	for (const board of boards) {
		const exists = profile.boards.some((b) => b.ats === board.ats && b.token === board.token);
		if (!exists) {
			profile.boards.push(board);
			added++;
		}
	}
	return added;
}
