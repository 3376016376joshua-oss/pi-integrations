import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, chromium, type Locator, type Page } from "playwright";
import { type FormField, matchOption } from "./answers.ts";
import { dataDir } from "./profile.ts";

// Kept as plain JavaScript source so the TypeScript loader cannot inject helpers that do not exist in the page.
const SCAN_FORM_SCRIPT = `(() => {
	const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		const s = getComputedStyle(el);
		return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
	};
	const controlSelector = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]):not([type=search]), textarea, select, [role=combobox]';
	const forms = [...document.querySelectorAll("form")];
	let root = document.body;
	let best = 1;
	for (const form of forms) {
		const count = form.querySelectorAll(controlSelector).length;
		if (count > best) { best = count; root = form; }
	}
	document.querySelectorAll("[data-pi-field]").forEach((el) => { el.removeAttribute("data-pi-field"); el.removeAttribute("data-pi-option"); });

	const questionText = (el, exclude) => {
		const fieldset = el.closest("fieldset");
		if (fieldset) {
			const legend = fieldset.querySelector("legend");
			if (legend && clean(legend.innerText)) return clean(legend.innerText);
		}
		let node = el.parentElement;
		for (let depth = 0; node && node !== root.parentElement && depth < 7; depth++, node = node.parentElement) {
			const candidates = node.querySelectorAll('label, legend, [class*="label" i], [class*="question" i], h3, h4, p');
			for (const c of candidates) {
				if (exclude.some((x) => c.contains(x) || x.contains(c))) continue;
				const text = clean(c.innerText);
				if (text) return text;
			}
		}
		return "";
	};
	const ownLabel = (el) => {
		const labelledby = el.getAttribute("aria-labelledby");
		if (labelledby) {
			const t = clean(labelledby.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" "));
			if (t) return t;
		}
		if (el.id) {
			const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
			if (l && clean(l.innerText)) return clean(l.innerText);
		}
		const wrap = el.closest("label");
		if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
		const aria = el.getAttribute("aria-label");
		if (aria) return clean(aria);
		return "";
	};
	const kindOf = (el) => {
		const tag = el.tagName.toLowerCase();
		const type = (el.getAttribute("type") || "").toLowerCase();
		if (tag === "select") return "select";
		if (tag === "textarea") return "textarea";
		if (type === "file") return "file";
		if (type === "radio") return "radio";
		if (type === "checkbox") return "checkbox";
		if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")) return "combobox";
		if (type === "date") return "date";
		if (type === "number") return "number";
		return "text";
	};
	const isRequired = (el, label) =>
		el.required || el.getAttribute("aria-required") === "true" || /\\*\\s*$/.test(label) || /\\(required\\)/i.test(label);

	const fields = [];
	const seenGroups = new Set();
	const seen = new Set();
	let n = 0;
	for (const el of root.querySelectorAll(controlSelector)) {
		if (seen.has(el)) continue;
		const kind = kindOf(el);
		if (kind !== "file" && kind !== "radio" && kind !== "checkbox" && !visible(el)) continue;
		if (kind === "radio" || kind === "checkbox") {
			const name = el.getAttribute("name");
			const members = name
				? [...root.querySelectorAll('input[name="' + CSS.escape(name) + '"]')]
				: [el];
			const key = kind + ":" + (name || "#" + n);
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			members.forEach((m) => seen.add(m));
			const id = "f" + n++;
			const options = members.map((m, i) => {
				m.setAttribute("data-pi-field", id);
				m.setAttribute("data-pi-option", String(i));
				return ownLabel(m) || m.value;
			});
			const single = members.length === 1;
			const label = single ? questionText(el, []) || options[0] : questionText(el, members.map((m) => m.closest("label") || m));
			fields.push({
				id, kind, label: label || options[0] || name || "", required: members.some((m) => isRequired(m, label)),
				options, value: members.filter((m) => m.checked).map((m, i) => options[members.indexOf(m)]).join("; "),
			});
			continue;
		}
		seen.add(el);
		const id = "f" + n++;
		el.setAttribute("data-pi-field", id);
		const label = ownLabel(el) || questionText(el, [el]) || el.getAttribute("placeholder") || el.getAttribute("name") || "";
		const options = kind === "select" ? [...el.options].map((o) => clean(o.text)).filter(Boolean) : [];
		const value = kind === "file" ? (el.files && el.files.length ? el.files[0].name : "") : kind === "select" ? clean(el.selectedOptions[0]?.text || "") : el.value || "";
		fields.push({ id, kind, label, required: isRequired(el, label), options, value });
	}

	// Yes/No button groups (Ashby renders boolean questions as buttons).
	const groups = new Map();
	for (const button of root.querySelectorAll("button")) {
		if ((button.getAttribute("type") || "").toLowerCase() === "submit" || !visible(button)) continue;
		if (!/^(yes|no)$/i.test(clean(button.innerText))) continue;
		const parent = button.parentElement;
		if (!groups.has(parent)) groups.set(parent, []);
		groups.get(parent).push(button);
	}
	for (const [parent, buttons] of groups) {
		if (buttons.length < 2) continue;
		const id = "f" + n++;
		const options = buttons.map((b, i) => {
			b.setAttribute("data-pi-field", id);
			b.setAttribute("data-pi-option", String(i));
			return clean(b.innerText);
		});
		const label = questionText(parent, buttons);
		const pressed = buttons.find((b) => b.getAttribute("aria-pressed") === "true" || /active|selected/i.test(b.className));
		fields.push({ id, kind: "buttons", label, required: /\\*\\s*$/.test(label), options, value: pressed ? clean(pressed.innerText) : "" });
	}
	return fields;
})()`;

const ERRORS_SCRIPT = `(() => {
	const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
	const out = new Set();
	for (const el of document.querySelectorAll('[role=alert], [class*="error" i], [aria-invalid=true]')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue;
		const text = clean(el.innerText || el.getAttribute("aria-label") || "");
		if (text && text.length < 300) out.add(text);
		if (el.getAttribute("aria-invalid") === "true") {
			const label = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
			out.add("Invalid field: " + clean(label ? label.innerText : el.getAttribute("name") || el.id));
		}
	}
	// Native constraint validation blocks the submit without rendering any error element.
	for (const el of document.querySelectorAll("input, select, textarea")) {
		if (!el.validity || el.validity.valid || el.type === "hidden") continue;
		const label = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
		const name = clean(label ? label.innerText : el.closest("label")?.innerText || el.getAttribute("aria-label") || el.name || el.id);
		out.add("Invalid field: " + name + " (" + el.validationMessage + ")");
	}
	return [...out].slice(0, 20);
})()`;

const SUCCESS_TEXT =
	/thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied)/i;
const SUCCESS_URL = /confirmation|thank|success|submitted|applied/i;
const CAPTCHA_SELECTOR =
	'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[src*="challenges.cloudflare.com"]';

export interface FillResult {
	fieldId: string;
	ok: boolean;
	note: string;
}

export type SubmitStatus = "submitted" | "validation_errors" | "captcha_timeout" | "unknown";

export interface SubmitResult {
	status: SubmitStatus;
	errors: string[];
	url: string;
	screenshot?: string;
}

export interface BrowserOptions {
	headless: boolean;
	/** How long to wait for a person to solve a CAPTCHA. */
	captchaTimeoutMs: number;
	onCaptcha?: () => void;
}

export class ApplicationBrowser {
	private context: BrowserContext | undefined;
	private page: Page | undefined;
	private readonly options: BrowserOptions;

	constructor(options: BrowserOptions) {
		this.options = options;
	}

	private async getPage(): Promise<Page> {
		if (!this.context) {
			// A persistent profile keeps cookies, which makes CAPTCHAs rarer on later applications.
			this.context = await chromium.launchPersistentContext(join(dataDir(), "browser-profile"), {
				headless: this.options.headless,
				executablePath: process.env.JOB_APPLY_CHROMIUM || undefined,
				viewport: { width: 1280, height: 900 },
			});
			this.context.on("close", () => {
				this.context = undefined;
				this.page = undefined;
			});
		}
		if (!this.page || this.page.isClosed()) this.page = this.context.pages()[0] ?? (await this.context.newPage());
		return this.page;
	}

	async open(url: string): Promise<FormField[]> {
		const page = await this.getPage();
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
		await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
		let fields = await this.scan();
		if (fields.filter((f) => f.kind !== "file").length < 2) {
			// Some boards show the job description first and reveal the form behind an Apply button.
			const apply = page
				.getByRole("button", { name: /^apply( now| for this job)?$/i })
				.or(page.getByRole("link", { name: /^apply( now| for this job)?$/i }));
			if ((await apply.count()) > 0) {
				await apply.first().click();
				await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
				fields = await this.scan();
			}
		}
		return fields;
	}

	async scan(): Promise<FormField[]> {
		const page = await this.getPage();
		const fields = (await page.evaluate(SCAN_FORM_SCRIPT)) as FormField[];
		for (const field of fields) {
			if (field.kind === "combobox" && field.options.length === 0)
				field.options = await this.peekComboboxOptions(field.id);
		}
		return fields;
	}

	private field(id: string): Locator {
		return this.page!.locator(`[data-pi-field="${id}"]`);
	}

	/** Opens a custom dropdown just long enough to read its options. */
	private async peekComboboxOptions(id: string): Promise<string[]> {
		const page = this.page!;
		try {
			await this.field(id).first().click({ timeout: 3000 });
			await page.waitForTimeout(300);
			const options = await page.locator('[role="option"]:visible').allInnerTexts();
			await page.keyboard.press("Escape");
			return options
				.map((o) => o.trim())
				.filter(Boolean)
				.slice(0, 60);
		} catch {
			return [];
		}
	}

	async fill(
		answers: { fieldId: string; value: string }[],
		fields: FormField[],
		resumeFile?: string,
	): Promise<FillResult[]> {
		const results: FillResult[] = [];
		for (const answer of answers) {
			const field = fields.find((f) => f.id === answer.fieldId);
			if (!field) {
				results.push({ fieldId: answer.fieldId, ok: false, note: "unknown field id" });
				continue;
			}
			try {
				results.push({ fieldId: field.id, ok: true, note: await this.fillField(field, answer.value, resumeFile) });
			} catch (error) {
				results.push({
					fieldId: field.id,
					ok: false,
					note: error instanceof Error ? error.message.split("\n")[0] : String(error),
				});
			}
		}
		return results;
	}

	private async fillField(field: FormField, value: string, resumeFile?: string): Promise<string> {
		const page = this.page!;
		const locator = this.field(field.id);
		switch (field.kind) {
			case "file": {
				if (!resumeFile) throw new Error("no resume file in the profile");
				await locator.setInputFiles(resumeFile);
				return "uploaded resume";
			}
			case "select": {
				const option = matchOption(field.options, value);
				if (!option) throw new Error(`no option matches "${value}"`);
				await locator.selectOption({ label: option });
				return `selected "${option}"`;
			}
			case "radio":
			case "buttons": {
				const option = matchOption(field.options, value);
				if (!option) throw new Error(`no option matches "${value}"`);
				const member = page.locator(
					`[data-pi-field="${field.id}"][data-pi-option="${field.options.indexOf(option)}"]`,
				);
				if (field.kind === "radio") await member.check({ force: true });
				else await member.click();
				return `chose "${option}"`;
			}
			case "checkbox": {
				const wanted = value
					.split(";")
					.map((v) => v.trim())
					.filter(Boolean);
				if (field.options.length === 1) {
					const on =
						/^(yes|true|checked|agree|i agree|1)$/i.test(value.trim()) ||
						matchOption(field.options, value) !== undefined;
					await locator.setChecked(on, { force: true });
					return on ? "checked" : "unchecked";
				}
				const chosen: string[] = [];
				for (const want of wanted) {
					const option = matchOption(field.options, want);
					if (!option) continue;
					await page
						.locator(`[data-pi-field="${field.id}"][data-pi-option="${field.options.indexOf(option)}"]`)
						.check({ force: true });
					chosen.push(option);
				}
				if (chosen.length === 0) throw new Error(`no option matches "${value}"`);
				return `checked ${chosen.map((c) => `"${c}"`).join(", ")}`;
			}
			case "combobox": {
				await locator.click();
				const isInput = await locator.evaluate((el) => el.tagName === "INPUT");
				if (isInput) await locator.fill(value);
				else await page.keyboard.type(value);
				await page.waitForTimeout(800);
				const options = await page.locator('[role="option"]:visible').allInnerTexts();
				const option = matchOption(options, value) ?? (options.length === 1 ? options[0] : undefined);
				if (option) {
					await page.locator('[role="option"]:visible', { hasText: option }).first().click();
					return `chose "${option.trim()}"`;
				}
				await page.keyboard.press("Enter");
				return `typed "${value}" (no exact option)`;
			}
			default: {
				await locator.fill(value);
				return "filled";
			}
		}
	}

	async errors(): Promise<string[]> {
		return (await this.page!.evaluate(ERRORS_SCRIPT)) as string[];
	}

	async submit(screenshotName: string): Promise<SubmitResult> {
		const page = await this.getPage();
		const submit = page
			.locator('button[type="submit"]:visible, input[type="submit"]:visible')
			.or(page.getByRole("button", { name: /submit( application)?|^apply$/i }));
		if ((await submit.count()) === 0)
			return { status: "unknown", errors: ["no submit button found"], url: page.url() };
		const startUrl = page.url();
		await submit.last().click();

		let deadline = Date.now() + 20_000;
		let captchaSeen = false;
		while (Date.now() < deadline) {
			await page.waitForTimeout(1000);
			const body = await page
				.locator("body")
				.innerText()
				.catch(() => "");
			if (SUCCESS_TEXT.test(body) || (page.url() !== startUrl && SUCCESS_URL.test(page.url()))) {
				return {
					status: "submitted",
					errors: [],
					url: page.url(),
					screenshot: await this.screenshot(screenshotName),
				};
			}
			const captchaVisible = await page
				.locator(CAPTCHA_SELECTOR)
				.filter({ visible: true })
				.count()
				.catch(() => 0);
			if (captchaVisible > 0 && !captchaSeen) {
				captchaSeen = true;
				deadline = Date.now() + this.options.captchaTimeoutMs;
				this.options.onCaptcha?.();
			}
			if (!captchaSeen) {
				const errors = await this.errors();
				if (errors.length > 0 && Date.now() > deadline - 15_000) {
					return { status: "validation_errors", errors, url: page.url() };
				}
			}
		}
		return {
			status: captchaSeen ? "captcha_timeout" : "unknown",
			errors: await this.errors(),
			url: page.url(),
			screenshot: await this.screenshot(screenshotName),
		};
	}

	private async screenshot(name: string): Promise<string | undefined> {
		const dir = join(dataDir(), "screenshots");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${name.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`);
		try {
			await this.page!.screenshot({ path, fullPage: true });
			return path;
		} catch {
			return undefined;
		}
	}

	async close(): Promise<void> {
		await this.context?.close();
		this.context = undefined;
		this.page = undefined;
	}
}
