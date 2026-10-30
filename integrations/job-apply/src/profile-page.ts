// Single-page profile editor served by profile-server.ts. Plain HTML and JS, no build step.
export const PROFILE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Apply Profile</title>
<style>
	:root { --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --border: #dddcd6; --accent: #2f5bd3; --ok: #1f7a4d; --err: #b3261e; }
	@media (prefers-color-scheme: dark) {
		:root { --bg: #161615; --panel: #20201e; --text: #ecebe6; --muted: #a3a29b; --border: #3a3a36; --accent: #7d9cf0; --ok: #5cc493; --err: #f2867f; }
	}
	* { box-sizing: border-box; }
	body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
	main { max-width: 860px; margin: 0 auto; padding: 24px 16px 96px; }
	h1 { font-size: 22px; margin: 0 0 4px; }
	p.lead { color: var(--muted); margin: 0 0 24px; }
	section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
	h2 { font-size: 16px; margin: 0 0 12px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
	label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--text); font-size: 14px; }
	input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], textarea {
		width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit;
	}
	textarea { min-height: 120px; resize: vertical; }
	textarea.tall { min-height: 280px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.hint { color: var(--muted); font-size: 13px; margin: 4px 0 8px; }
	.bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--panel); border-top: 1px solid var(--border); padding: 12px 16px; }
	.bar div { max-width: 860px; margin: 0 auto; display: flex; gap: 12px; align-items: center; }
	button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 9px 18px; font: inherit; font-weight: 600; cursor: pointer; }
	#status { font-size: 14px; }
	#status.ok { color: var(--ok); } #status.err { color: var(--err); }
</style>
</head>
<body>
<main>
	<h1>Job apply profile</h1>
	<p class="lead">The agent answers application questions from this page. Changes are saved to your computer only.</p>

	<section>
		<h2>Resume</h2>
		<p class="hint" id="resume-current">No resume uploaded yet.</p>
		<input type="file" id="resume-file" accept=".pdf,.doc,.docx">
		<p class="hint">Uploading a PDF also fills in the text below. Check it, since the agent answers questions from this text.</p>
		<label>Resume text<textarea class="tall" data-key="resumeText"></textarea></label>
	</section>

	<section>
		<h2>Personal</h2>
		<div class="grid">
			<label>First name<input type="text" data-key="firstName"></label>
			<label>Last name<input type="text" data-key="lastName"></label>
			<label>Preferred name<input type="text" data-key="preferredName"></label>
			<label>Email<input type="email" data-key="email"></label>
			<label>Phone<input type="tel" data-key="phone"></label>
			<label>City<input type="text" data-key="city"></label>
			<label>State<input type="text" data-key="state"></label>
			<label>Country<input type="text" data-key="country"></label>
			<label>LinkedIn URL<input type="url" data-key="linkedin"></label>
			<label>GitHub URL<input type="url" data-key="github"></label>
			<label>Website<input type="url" data-key="website"></label>
		</div>
	</section>

	<section>
		<h2>Education</h2>
		<div class="grid">
			<label>School<input type="text" data-key="school"></label>
			<label>Degree<input type="text" data-key="degree" placeholder="Master of Science"></label>
			<label>Major<input type="text" data-key="major"></label>
			<label>Graduation date<input type="text" data-key="graduationDate" placeholder="May 2026"></label>
			<label>GPA<input type="text" data-key="gpa"></label>
		</div>
	</section>

	<section>
		<h2>Work authorization</h2>
		<div class="grid">
			<label class="check"><input type="checkbox" data-key="authorizedToWorkInUS"> Authorized to work in the US now</label>
			<label class="check"><input type="checkbox" data-key="requiresSponsorship"> Will need visa sponsorship</label>
			<label>Visa status<input type="text" data-key="visaStatus"></label>
			<label>Earliest start date<input type="text" data-key="earliestStartDate"></label>
			<label>Salary expectation<input type="text" data-key="salaryExpectation" placeholder="Leave empty to let the agent skip it"></label>
			<label class="check"><input type="checkbox" data-key="willingToRelocate"> Willing to relocate</label>
			<label>How did you hear about us<input type="text" data-key="howDidYouHear"></label>
		</div>
	</section>

	<section>
		<h2>Voluntary self-identification</h2>
		<div class="grid">
			<label>Gender<input type="text" data-key="gender"></label>
			<label>Race or ethnicity<input type="text" data-key="race"></label>
			<label>Hispanic or Latino<input type="text" data-key="hispanicOrLatino"></label>
			<label>Veteran status<input type="text" data-key="veteranStatus"></label>
			<label>Disability status<input type="text" data-key="disabilityStatus"></label>
		</div>
	</section>

	<section>
		<h2>Job search</h2>
		<div class="grid">
			<label>Applications per day<input type="number" min="1" data-key="dailyLimit"></label>
			<label class="check"><input type="checkbox" data-key="autoSubmit"> Submit without asking me</label>
			<label class="check"><input type="checkbox" data-key="skipNoSponsorship"> Skip jobs that say they don't sponsor visas</label>
		</div>
		<p class="hint">One entry per line. A job title must contain a target phrase and none of the excluded words.</p>
		<div class="grid">
			<label>Target title phrases<textarea data-list="roleKeywords"></textarea></label>
			<label>Excluded title words<textarea data-list="excludeKeywords"></textarea></label>
		</div>
		<p class="hint">Company boards to check, one per line as <code>greenhouse:stripe</code>, <code>lever:palantir</code> or <code>ashby:openai</code>. Web search adds more.</p>
		<label>Boards<textarea data-boards></textarea></label>
	</section>

	<section>
		<h2>Saved answers</h2>
		<p class="hint">Answers to questions that come up often. Write each as a "Q:" line followed by an "A:" line, with a blank line between pairs.</p>
		<textarea class="tall" data-answers></textarea>
	</section>
</main>
<div class="bar"><div><button id="save">Save</button><span id="status"></span></div></div>

<script>
	const status = document.getElementById("status");
	const show = (text, ok) => { status.textContent = text; status.className = ok ? "ok" : "err"; };
	let profile = null;

	function render() {
		document.querySelectorAll("[data-key]").forEach((el) => {
			const value = profile[el.dataset.key];
			if (el.type === "checkbox") el.checked = Boolean(value);
			else el.value = value == null ? "" : value;
		});
		document.querySelectorAll("[data-list]").forEach((el) => { el.value = (profile[el.dataset.list] || []).join("\\n"); });
		document.querySelector("[data-boards]").value = profile.boards.map((b) => b.ats + ":" + b.token).join("\\n");
		document.querySelector("[data-answers]").value = profile.savedAnswers.map((a) => "Q: " + a.question + "\\nA: " + a.answer).join("\\n\\n");
		document.getElementById("resume-current").textContent = profile.resumeFile ? "Current file: " + profile.resumeFile : "No resume uploaded yet.";
	}

	function collect() {
		const next = {};
		document.querySelectorAll("[data-key]").forEach((el) => {
			if (el.type === "checkbox") next[el.dataset.key] = el.checked;
			else if (el.type === "number") next[el.dataset.key] = Number(el.value) || 1;
			else next[el.dataset.key] = el.value;
		});
		document.querySelectorAll("[data-list]").forEach((el) => {
			next[el.dataset.list] = el.value.split("\\n").map((s) => s.trim()).filter(Boolean);
		});
		next.boards = document.querySelector("[data-boards]").value.split("\\n").map((line) => {
			const [ats, token] = line.trim().split(":");
			return { ats: (ats || "").trim().toLowerCase(), token: (token || "").trim() };
		}).filter((b) => ["greenhouse", "lever", "ashby"].includes(b.ats) && b.token);
		next.savedAnswers = document.querySelector("[data-answers]").value.split(/\\n\\s*\\n/).map((block) => {
			const q = block.match(/^Q:\\s*(.*)$/m);
			const a = block.match(/^A:\\s*([\\s\\S]*)$/m);
			return q && a ? { question: q[1].trim(), answer: a[1].trim() } : null;
		}).filter(Boolean);
		return next;
	}

	async function load() {
		const response = await fetch("/api/profile");
		profile = await response.json();
		render();
	}

	document.getElementById("resume-file").addEventListener("change", async (event) => {
		const file = event.target.files[0];
		if (!file) return;
		show("Uploading...", true);
		const response = await fetch("/api/resume?name=" + encodeURIComponent(file.name), { method: "POST", headers: { "x-job-apply": "1" }, body: file });
		const body = await response.json();
		if (!response.ok) return show(body.error || "Upload failed", false);
		profile.resumeFile = body.resumeFile;
		document.getElementById("resume-current").textContent = "Current file: " + body.resumeFile;
		if (body.textExtracted) {
			document.querySelector('[data-key="resumeText"]').value = body.resumeText;
			show("Resume uploaded and its text read. Check the text below, then press Save.", true);
		} else {
			show("Resume uploaded, but its text could not be read. Paste it below, then press Save.", false);
		}
	});

	document.getElementById("save").addEventListener("click", async () => {
		const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json", "x-job-apply": "1" }, body: JSON.stringify(collect()) });
		if (!response.ok) return show("Save failed", false);
		profile = await response.json();
		render();
		show("Saved " + new Date().toLocaleTimeString(), true);
	});

	load().catch(() => show("Could not load the profile", false));
</script>
</body>
</html>
`;
