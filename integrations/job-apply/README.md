# pi-job-apply

A pi package that finds software jobs on Greenhouse, Lever and Ashby, fills in the application forms with Playwright, submits them, and logs every application to a CSV file.

It adds to pi:

| Piece | What it does |
|-------|--------------|
| `/job-profile` | Opens a local page for uploading your resume and editing your profile, standard answers and search settings. |
| `/apply [n]` | Runs the `job-apply` skill: find jobs, then open, fill and submit up to `n` applications (default 10). |
| `/job-log` | Shows today's count against the daily limit and where the log is. |
| `job_profile`, `job_search`, `job_open_application`, `job_fill_form`, `job_submit`, `job_log` | Tools the agent calls. |
| `skills/job-apply` | The instructions the agent follows when applying. |

## How a run works

1. `job_search` reads the public job APIs of every board in your profile (`greenhouse:stripe`, `lever:palantir`, `ashby:openai`, ...). With `ANTHROPIC_API_KEY` set, it first runs a Claude web search to find more boards and saves them to the profile.
2. Jobs are kept when the title contains a target phrase, contains no excluded word (senior, staff, intern, ...), at least one location is in the US, the job is not already in the log, and the description does not rule out visa sponsorship ("unable to sponsor", "must be a U.S. citizen", clearance required, ...).
3. `job_open_application` opens the form in a visible Chromium window and lists each field. Standard questions (name, email, sponsorship, work authorization, EEO, school, ...) get answers from your profile. The agent writes the rest from your resume and the job description.
4. `job_fill_form` fills text fields, dropdowns, radio buttons, checkboxes, searchable dropdowns and Yes/No button groups, and uploads the resume.
5. `job_submit` clicks submit and waits for a confirmation page. If a CAPTCHA appears, pi shows a notice and waits up to 10 minutes for you to solve it in the browser window. Validation errors go back to the agent, which fixes the fields and retries.
6. Each submitted, skipped or failed job becomes a row in `applications.csv`, with a screenshot of the confirmation page. `job_submit` refuses to go past the daily limit.

## Setup

```bash
cd integrations/job-apply
npm install
npx playwright install chromium
pi install ./integrations/job-apply   # from the repo root; or run pi with -e ./integrations/job-apply
```

Set the model keys and start pi with DeepSeek:

```bash
export DEEPSEEK_API_KEY=...
export ANTHROPIC_API_KEY=...   # optional, only for web search discovery
pi --model deepseek/deepseek-v4-pro
```

Then in pi:

```
/job-profile     # upload your resume, fill in the profile, press Save
/apply 20
```

## Files

Everything is stored in `~/.pi/job-apply/` (override with `JOB_APPLY_HOME`):

| File | Contents |
|------|----------|
| `profile.json` | Profile, saved answers, title filters, boards |
| `resume.pdf` | Uploaded resume |
| `applications.csv` | `applied_at, company, title, location, ats, job_id, url, status, notes` |
| `screenshots/` | Confirmation page per submitted job |
| `browser-profile/` | Chromium profile, so cookies persist between runs |

## Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `JOB_APPLY_HOME` | `~/.pi/job-apply` | Data directory |
| `JOB_APPLY_PORT` | `4729` | Port for the profile page |
| `JOB_APPLY_HEADLESS` | unset | Set to `1` to hide the browser (CAPTCHAs then cannot be solved) |
| `JOB_APPLY_CAPTCHA_TIMEOUT_MS` | `600000` | How long to wait for a CAPTCHA to be solved |
| `JOB_APPLY_SEARCH_MODEL` | `claude-opus-5-5` | Claude model used for web search discovery |
| `JOB_APPLY_CHROMIUM` | unset | Path to a Chromium binary instead of the Playwright one |

## Limits

- Only Greenhouse, Lever and Ashby forms are supported. Forms that need an account or login are logged as `needs_review`.
- The starter board list in the profile is a guess at company board names; boards that return 404 are reported and skipped. Edit the list on the profile page.
- The log is a CSV file. Google Sheets sync is not built yet.

## Development

```bash
npm test            # unit tests plus a Playwright run against test/fixtures/application.html
```
