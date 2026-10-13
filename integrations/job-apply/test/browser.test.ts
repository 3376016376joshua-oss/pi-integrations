import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { suggestAnswer } from "../src/answers.ts";
import { ApplicationBrowser } from "../src/browser.ts";
import { defaultProfile } from "../src/profile.ts";

// dataDir() reads this lazily, so setting it after the imports still isolates the test.
process.env.JOB_APPLY_HOME = mkdtempSync(join(tmpdir(), "job-apply-browser-"));

const fixture = readFileSync(new URL("./fixtures/application.html", import.meta.url), "utf8");

describe("ApplicationBrowser against a mock application form", () => {
	let server: Server;
	let url = "";
	const browser = new ApplicationBrowser({ headless: true, captchaTimeoutMs: 1000 });
	const resume = join(process.env.JOB_APPLY_HOME!, "resume.pdf");
	writeFileSync(resume, "%PDF-1.4 test");
	const profile = {
		...defaultProfile(),
		firstName: "Alex",
		lastName: "Chen",
		email: "alex@example.com",
		phone: "555-0100",
		school: "University of Washington",
		resumeFile: "resume.pdf",
	};

	before(async () => {
		server = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(fixture);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
	});

	after(async () => {
		await browser.close();
		server.close();
	});

	it("reports validation errors for an empty form", async () => {
		await browser.open(url);
		const result = await browser.submit("empty");
		assert.equal(result.status, "validation_errors");
		assert.ok(
			result.errors.some((e) => /First Name/.test(e)),
			JSON.stringify(result.errors),
		);
	});

	it("scans, fills and submits the form", async () => {
		const fields = await browser.open(url);
		const byLabel = (pattern: RegExp) => {
			const found = fields.find((f) => pattern.test(f.label));
			assert.ok(found, `no field labelled ${pattern}`);
			return found;
		};
		assert.equal(byLabel(/first name/i).kind, "text");
		assert.equal(byLabel(/resume/i).kind, "file");
		assert.deepEqual(byLabel(/sponsorship/i).options, ["Select...", "Yes", "No"]);
		assert.deepEqual(byLabel(/legally authorized/i).options, ["Yes", "No"]);
		assert.equal(byLabel(/^school/i).kind, "combobox");
		assert.ok(byLabel(/^school/i).options.includes("University of Washington"));
		assert.equal(byLabel(/onsite/i).kind, "buttons");
		assert.equal(byLabel(/privacy policy/i).kind, "checkbox");

		const answers = fields.flatMap((f) => {
			const suggestion = suggestAnswer(f, profile);
			return suggestion ? [{ fieldId: f.id, value: suggestion.value }] : [];
		});
		answers.push({ fieldId: byLabel(/onsite/i).id, value: "Yes" });
		answers.push({
			fieldId: byLabel(/why do you want/i).id,
			value: "I build agent tooling and want to ship it at Acme.",
		});
		answers.push({ fieldId: byLabel(/privacy policy/i).id, value: "yes" });

		const results = await browser.fill(answers, fields, resume);
		assert.deepEqual(
			results.filter((r) => !r.ok),
			[],
		);
		const rescanned = await browser.scan();
		assert.deepEqual(
			rescanned.filter((f) => f.required && !f.value).map((f) => f.label),
			[],
		);

		const result = await browser.submit("acme-1");
		assert.equal(result.status, "submitted", JSON.stringify(result));
		assert.ok(result.screenshot);
	});
});
