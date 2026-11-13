---
name: job-apply
description: Find matching software jobs on Greenhouse, Lever and Ashby and submit applications with the job_* tools, using the applicant's saved profile and resume. Use when the user asks to apply to jobs.
---

# Job apply

Apply to the number of jobs the user asked for (default 10) with the `job_*` tools. Work through jobs one at a time until that many are submitted, the daily limit is reached, or no matching jobs remain.

## Steps

1. Call `job_profile` once. If it says the profile is missing something, stop and tell the user to run `/job-profile`.
2. Call `job_search`. Ask for a few more jobs than you need, since some forms fail.
3. For each job id, in order:
   1. `job_open_application` with the job id.
   2. Decide every field's value:
      - Accept a suggested value unless it clearly does not fit the question.
      - For fields marked NONE, answer from the profile and resume. Free-text answers ("Why do you want to work here?", "Tell us about a project") get two to four specific sentences that connect the resume to the job description.
      - Upload the resume in resume or CV file fields by passing `resume`. Leave cover letter fields empty.
      - Leave optional fields empty when the profile and resume have no answer.
   3. `job_fill_form` with all answers in one call. If required fields are still empty, fill them in a second call.
   4. `job_submit`. If it returns validation errors, fix those fields and submit again, at most twice.
   5. If the job cannot be completed, call `job_log` with `failed`, `needs_review` or `skipped` and a short reason, then continue with the next job.
4. When done, report how many were submitted, list the companies and titles, and name any jobs logged as `needs_review`.

## Rules

- Never invent facts: employers, degrees, dates, skills, certifications, publications or references must come from the profile or resume.
- Work authorization: the applicant is authorized to work in the US now and will need visa sponsorship. Answer sponsorship questions truthfully with the profile values.
- Skip (log as `skipped`) a job whose form requires US citizenship, a security clearance, or confirming that sponsorship will never be needed.
- Skip a job that requires answers you cannot give honestly, such as years of experience the resume does not show.
- Do not answer salary questions unless the profile has a salary expectation; if required, write "Open to discussion" in text fields.
- Do not create accounts or sign in anywhere. If a form needs a login, log it as `needs_review`.
- If `job_submit` reports the daily limit, stop.
