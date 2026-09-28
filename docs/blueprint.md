# Repo Sanitizer — Gmail extraction — Bot specification

**Archetype:** workflow

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that accepts a GitHub repo URL or ZIP upload, removes Wolt-specific code and configuration using heuristic static analysis, refactors and consolidates the project's Gmail-account-generation logic into a standalone module, and returns a downloadable ZIP plus a short change report. Ambiguous changes are flagged and included with original/modified snippets for manual review. Temporary inputs/results are retained for 24 hours and a short audit record is kept for 30 days.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- developers
- maintainers
- security engineers

## Success criteria

- User uploads ZIP or sends a public GitHub HTTPS URL and receives an acknowledgment within 10s.
- Bot produces and returns a modified ZIP containing the cleaned project with Gmail logic refactored into src/gmail_autogen/ in >95% of non-error cases.
- Bot returns a plaintext change report listing removed files/sections and any flagged ambiguous snippets for manual review.
- Temporary repo and result artifacts are deleted after 24 hours and an audit record (timestamp, repo URL/name, summary) is retained for 30 days.
- When automatic removal is ambiguous, the report contains both original and modified code snippets and an explicit 'manual review required' flag.

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and usage help
- **Upload ZIP** (button, actor: user, callback: repo:upload_zip) — Upload a repository archive (.zip) for processing
  - inputs: file: application/zip
  - outputs: acknowledgement message, processing status updates, result ZIP and change report
- **/submit_url** (command, actor: user, command: /submit_url) — Provide a public GitHub HTTPS URL (typed input) to clone and process
  - inputs: text: git_https_url
  - outputs: acknowledgement message, processing status updates, result ZIP and change report
- **My recent jobs** (button, actor: user, callback: jobs:list_recent) — Show recent jobs and their status (within retention window)
  - outputs: list of recent jobs (id, status, timestamp, brief summary)
- **Help** (button, actor: user, callback: help:usage) — Show short usage tips and privacy summary
  - outputs: help text

## Flows

### Ingest via GitHub URL
_Trigger:_ /submit_url

1. Receive public HTTPS GitHub URL from user (slash command text).
2. Validate URL format and check it is reachable by attempting a shallow git clone (no credential attempt).
3. Acknowledge: send 'Received — processing'.
4. Store cloned repo temporarily in isolated workspace.
5. Enqueue transformation job and run static analysis.

_Data touched:_ incoming_repo, transformation_job, audit_log

### Ingest via ZIP upload
_Trigger:_ callback repo:upload_zip -> file upload

1. Receive ZIP file from user and validate archive format and size limit.
2. Acknowledge: send 'Received — processing'.
3. Unpack into temporary workspace.
4. Enqueue transformation job and run static analysis.

_Data touched:_ incoming_repo, transformation_job, audit_log

### Static analysis & transformation
_Trigger:_ transformation_job start

1. Run language-agnostic keyword scan (filenames, paths, config keys, tokens) for 'wolt' variants and known Wolt indicators.
2. Build dependency graph and call graph heuristics to identify code tied to Wolt-specific imports, clients, or config.
3. Remove files, imports, config entries, and code blocks clearly tied to Wolt.
4. Identify functions/files referencing 'gmail', 'create_gmail', 'gmail_account', OAuth/SMTP setup, or similar and copy/refactor them into src/gmail_autogen/ as a single self-contained module with adaptors for removed dependencies.
5. For ambiguous code blocks or uncertain dependency removals, produce a flagged diff and keep both original and modified snippets for the report.
6. Run lightweight static build checks where feasible (syntactic/parsing checks) but do not execute third-party account-creation logic.
7. Package modified repository into a ZIP and generate a plaintext change report (removed items, refactor summary, manual review flags).

_Data touched:_ incoming_repo, result_package, audit_log

### Manual review required path
_Trigger:_ transformation_job produces flags

1. Attach flagged snippets (original and modified) to the change report with filenames and line ranges.
2. Mark job status as 'manual_review_required'.
3. Deliver ZIP and report to user; include a clear label where manual attention is required.

_Data touched:_ result_package, audit_log

### Deliver results & cleanup
_Trigger:_ transformation_job complete

1. Send result ZIP and change report to the user's Telegram chat.
2. Log audit record (timestamp, repo name/URL, brief summary, job id) retained 30 days.
3. Schedule deletion of temporary workspace and result ZIP after 24 hours.
4. Update job list for user (visible via 'My recent jobs').

_Data touched:_ result_package, audit_log

### Failure handling
_Trigger:_ errors during clone, unpack, or transform

1. Detect cause (invalid URL, private repo, oversized archive, parse error).
2. Send a clear error message to user with actionable next steps.
3. Log error with minimal metadata for debugging; do not retain repo contents.
4. If transient, allow user to retry or submit a support request.

_Data touched:_ audit_log

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **incoming_repo** _(retention: 24h)_ — Cloned Git repository or uploaded ZIP unpacked into a temporary workspace.
  - fields: repo_source: 'git_url' | 'upload', repo_name, workspace_path, size_bytes, received_timestamp
- **transformation_job** _(retention: session)_ — Automated job that runs analysis and transformation on an incoming_repo.
  - fields: job_id, submitter_chat_id, start_timestamp, end_timestamp, status: queued|running|complete|failed|manual_review_required, flags: list of ambiguous file/line ranges
- **result_package** _(retention: 24h)_ — The ZIP archive containing the modified repository and refactored gmail_autogen module.
  - fields: package_path, package_size, generated_timestamp, checksum
- **audit_log** _(retention: 30d)_ — Short record retained for debugging and support (no full repo contents).
  - fields: job_id, repo_name_or_url, submitter_chat_id, summary_of_changes, flags_summary, timestamp

## Integrations

- **Telegram** (required) — Bot API messaging and file transfer with users
- **Git (HTTPS clone)** (required) — Fetch public GitHub repositories by HTTPS cloning (no API key required)
- **Internal ephemeral storage** (required) — Temporary workspace and packaged ZIP storage (24h lifecycle)
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Cancel running or queued jobs (by job id) via admin interface.
- View/delete audit logs within the 30‑day window.
- Adjust per-job maximum allowed repo size (owner-settable, optional UI control).
- Enable/disable returning original snippet attachments for flagged changes (privacy control).

## Notifications

- processing_started: Sent to user when job begins (short acknowledgement).
- processing_progress: Optional periodic updates for long-running jobs.
- processing_complete_success: Sent with ZIP attachment and change report.
- processing_complete_manual_review_required: Sent with ZIP and flagged snippets report.
- processing_failed: Sent with error reason and suggested next actions.

## Permissions & privacy

- Temporary workspace and result ZIP are stored for 24 hours then deleted.
- Audit log (summary only) retained 30 days; it contains no full repo contents or user file attachments.
- Bot will not push changes back to the original GitHub repository or perform any network actions that create real Gmail accounts.
- Uploaded repos are accessed only for transformation; no long-term sharing to third parties by default.
- If owner enables returning original snippet attachments for flagged items, those snippets are attached to the Telegram report; otherwise only summaries are included.

## Edge cases

- Private GitHub repositories (clone fails due to credentials) — bot returns 'private repo' error and lists options.
- Very large repositories exceeding maximum allowed size — reject with size guidance.
- Binary-only repos or non-code archives — report 'no analyzable source code'.
- No Gmail-related logic found — return ZIP with a short note and the original project unchanged except removal attempts.
- Complex cross-cutting Wolt dependencies that cannot be safely removed without broader refactor — flagged for manual review.
- Multiple languages with incompatible idioms — partial refactor may be incomplete and will be flagged.
- Malformed or corrupted ZIPs — processing fails with descriptive error.
- Concurrent submissions exceeding job concurrency limits — queued with ETA message.

## Required tests

- Dialog-level acceptance: upload a well-formed repo ZIP containing Wolt code and Gmail logic -> receive cleaned ZIP and change report.
- Dialog-level acceptance: submit a public GitHub HTTPS URL -> bot clones, transforms, and returns ZIP.
- Ambiguity handling: repo with cross-cutting dependencies -> flagged snippets and both original/modified snippets present in report.
- Privacy/retention: temporary files and packaged ZIP removed after 24 hours; audit log entries expire after 30 days.
- Error handling: private repo and oversized repo produce clear, actionable error messages.
- Static checks: refactored src/gmail_autogen/ module compiles/parses for the repo's primary language (where feasible) or passes syntax checks.
- Concurrency & queueing: multiple simultaneous submissions are queued and processed without data leakage between workspaces.

## Assumptions

- Users provide either a public GitHub HTTPS URL or a ZIP file; private repo handling requires credentials which are out of scope.
- Wolt logic can be detected with heuristics (filenames, keywords, import names) and heuristic removal is acceptable; ambiguous cases will be flagged.
- Gmail-related logic is identifiable by common keywords and will be refactored into src/gmail_autogen/ without needing external API credentials.
- No execution of account-creation flows occurs — only static analysis and refactoring are performed.
- Bot has sufficient ephemeral storage and CPU to run static analysis on typical repo sizes within service limits.
