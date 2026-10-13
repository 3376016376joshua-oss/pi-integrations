import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { extname, join } from "node:path";
import { dataDir, defaultProfile, loadProfile, type Profile, saveProfile } from "./profile.ts";
import { PROFILE_PAGE } from "./profile-page.ts";
import { pdfToText } from "./resume-text.ts";

const MAX_BODY = 15 * 1024 * 1024;

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(new Error("file too large"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}

/** Keeps only known profile keys with the expected value types. */
export function sanitizeProfile(input: Record<string, unknown>, current: Profile): Profile {
	const next = { ...current };
	const defaults = defaultProfile();
	for (const key of Object.keys(defaults) as (keyof Profile)[]) {
		if (!(key in input) || key === "resumeFile") continue;
		const value = input[key];
		const expected = defaults[key];
		if (typeof expected === "string" && typeof value === "string") (next[key] as string) = value;
		else if (typeof expected === "boolean" && typeof value === "boolean") (next[key] as boolean) = value;
		else if (typeof expected === "number" && typeof value === "number" && Number.isFinite(value))
			(next[key] as number) = value;
		else if (Array.isArray(expected) && Array.isArray(value)) (next[key] as unknown[]) = value;
	}
	return next;
}

export interface ProfileServer {
	url: string;
	close(): Promise<void>;
}

/** Serves the profile page on localhost so the resume and answers can be edited in a browser. */
export function startProfileServer(port: number): Promise<ProfileServer> {
	const server: Server = createServer(async (request, response) => {
		const send = (status: number, body: string, type = "application/json") => {
			response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
			response.end(body);
		};
		try {
			const url = new URL(request.url ?? "/", "http://localhost");
			// Block other websites from talking to this server: reject foreign Host headers (DNS rebinding) and
			// require a custom header on writes, which browsers only send cross-origin after a CORS preflight we never allow.
			if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) return send(403, "{}");
			if (request.method !== "GET" && request.headers["x-job-apply"] !== "1") return send(403, "{}");
			if (request.method === "GET" && url.pathname === "/")
				return send(200, PROFILE_PAGE, "text/html; charset=utf-8");
			if (request.method === "GET" && url.pathname === "/api/profile")
				return send(200, JSON.stringify(loadProfile()));
			if (request.method === "PUT" && url.pathname === "/api/profile") {
				const input = JSON.parse((await readBody(request)).toString("utf8")) as Record<string, unknown>;
				const profile = sanitizeProfile(input, loadProfile());
				saveProfile(profile);
				return send(200, JSON.stringify(profile));
			}
			if (request.method === "POST" && url.pathname === "/api/resume") {
				const original = url.searchParams.get("name") ?? "resume.pdf";
				const extension = extname(original).toLowerCase();
				if (![".pdf", ".doc", ".docx"].includes(extension))
					return send(400, JSON.stringify({ error: "Upload a PDF or Word file." }));
				const fileName = `resume${extension}`;
				const data = await readBody(request);
				writeFileSync(join(dataDir(), fileName), data);
				const profile = loadProfile();
				profile.resumeFile = fileName;
				let textExtracted = false;
				if (extension === ".pdf") {
					const text = await pdfToText(new Uint8Array(data)).catch(() => "");
					if (text.trim()) {
						profile.resumeText = text;
						textExtracted = true;
					}
				}
				saveProfile(profile);
				return send(
					200,
					JSON.stringify({ resumeFile: profile.resumeFile, resumeText: profile.resumeText, textExtracted }),
				);
			}
			send(404, JSON.stringify({ error: "not found" }));
		} catch (error) {
			send(500, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			const actualPort = typeof address === "object" && address ? address.port : port;
			resolve({
				url: `http://127.0.0.1:${actualPort}/`,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
}
