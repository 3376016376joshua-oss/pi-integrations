import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./profile.ts";

export type ApplicationStatus = "submitted" | "failed" | "skipped" | "needs_review";

export interface ApplicationRecord {
	appliedAt: string;
	company: string;
	title: string;
	location: string;
	ats: string;
	jobId: string;
	url: string;
	status: ApplicationStatus;
	notes: string;
}

const COLUMNS: { key: keyof ApplicationRecord; header: string }[] = [
	{ key: "appliedAt", header: "applied_at" },
	{ key: "company", header: "company" },
	{ key: "title", header: "title" },
	{ key: "location", header: "location" },
	{ key: "ats", header: "ats" },
	{ key: "jobId", header: "job_id" },
	{ key: "url", header: "url" },
	{ key: "status", header: "status" },
	{ key: "notes", header: "notes" },
];

export function logPath(): string {
	return join(dataDir(), "applications.csv");
}

function escapeCsv(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

export function appendRecord(record: ApplicationRecord, path = logPath()): void {
	if (!existsSync(path)) writeFileSync(path, `${COLUMNS.map((c) => c.header).join(",")}\n`);
	appendFileSync(path, `${COLUMNS.map((c) => escapeCsv(record[c.key])).join(",")}\n`);
}

export function readRecords(path = logPath()): ApplicationRecord[] {
	if (!existsSync(path)) return [];
	const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
	if (!header) return [];
	return rows.map((row) => {
		const record = {} as Record<keyof ApplicationRecord, string>;
		for (const column of COLUMNS) record[column.key] = row[header.indexOf(column.header)] ?? "";
		return record as ApplicationRecord;
	});
}

/** Job ids that already have a row in the log, whatever the outcome, so they are not retried. */
export function handledJobIds(records: ApplicationRecord[]): Set<string> {
	return new Set(records.map((r) => r.jobId));
}

function localDay(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function submittedToday(records: ApplicationRecord[], now = new Date()): number {
	const today = localDay(now);
	return records.filter((r) => r.status === "submitted" && localDay(new Date(r.appliedAt)) === today).length;
}
