# Aurora append verification — 2026-10-17

Conclusion: **FAILED — REQUIRES CORRECTIONS**. This is not an end-to-end certification.

Baseline: `aurora-server` at `8adf85816d4c75dab65aad5a3fee84be8616bccf` (PR #3).
GitHub repository ID 1406017678 now resolves to `CHassapis/Starfall`; the former name redirects.
Correction branch: `fix/append-failure-safety`, isolated checkout `/home/chassapis/starfall-append-verification`.

## Findings and correction

At the baseline, `AuroraImporter.ImportAsync` saves deletions before rebuilding and saving replacements, with no transaction covering both saves. A failure during rebuilding or the second save can leave original elements deleted. `UploadHomebrewEndpoint` overwrites the source XML before importing; deletion removes the file and commits definition removal before refreshing other patches. These are source-level findings, not reproduced SQL failures.

The correction wraps importer saves in an async-flow transaction, joins upload/delete database work into one transaction, and restores the previous file bytes when importing, cancellation or transaction completion fails. Existing homebrew gating, validation, IDs and UI remain unchanged. Added 15 regression cases: six supported target types, six file-operation success/failure cases, cancellation, transaction-completion failure and importer second-save failure. Expanded the existing lifecycle test to cover upstream update/replacement while retaining patches and stable IDs.

**Correction has not been compiled or executed against .NET/SQL Server.** It requires SQL Server enlistment/rollback verification, including failure injection after the deletion save and during final commit. File restoration is exception recovery, not a durable cross-filesystem/database transaction: process termination, disk failure or failure during restoration still require recovery from backup. Do not claim crash-proof atomicity.

## Results

| Area | Result | Evidence / limit |
| --- | --- | --- |
| A. Aurora append compatibility | NOT VERIFIED | Regression source covers append-only, supports/rules and six target types; no executed backend import |
| B. Homebrew upload and validation | NOT VERIFIED | Existing 11 XML validation/listing cases not executed; frontend error tests pass within suite |
| C. Replacement and deletion safety | FAIL at baseline | Two separately committed saves and no file recovery; correction pending backend verification |
| D. Character Builder integration | NOT VERIFIED | No disposable API/database or working browser; no character created/edited |
| E. Frontend tests | PASS | 239 passed, 0 failed, 5 skipped; 28 files passed, 1 skipped; optional lore fixtures omitted |
| E. TypeScript | PASS | Builder `tsc -b --force`, exit 0, no diagnostics |
| E. Frontend build | PASS | Shared api-client and ui-framework bundles/declarations; builder production bundle; existing chunk-size warning |
| E. Installer compatibility | PASS (unit tests only) | 39 passed, 0 failed, 0 skipped; no Docker installer smoke run |
| E. .NET build/tests | NOT VERIFIED | Both commands exit 127: `dotnet: command not found`; 0 backend tests executed |
| E. API integration tests | NOT VERIFIED | No .NET SDK; Docker socket denied; no disposable backend available |
| E. Playwright | NOT VERIFIED | Browser launch exits SIGTRAP: `sandbox_host_linux.cc:41 ... Operation not permitted (1)`; 0 browser tests executed |
| F. Existing data compatibility | NOT VERIFIED | Stable-ID logic retained; no actual character/campaign persistence or rollback test |
| G. GitHub integration | PASS for original fix | Remote `aurora-server` independently read as `8adf85816d4c75dab65aad5a3fee84be8616bccf` |
| H. Production deployment | UNKNOWN independently | Owner supplied successful deployment of `8adf858` with healthy containers; current API, frontend version and logs inaccessible |

## Evidence and remaining checks

Fresh local output is in `/tmp/starfall-final-verification/`: `frontend-tests.log`, `typescript.log`, `frontend-build.log`, `api-package-build.log`, `ui-package-build.log`, `installer-tests.log`, `backend-build.log`, `backend-tests.log`, `playwright.log`.

Production probes were read-only: `docker logs --since 20m --tail 30 starlights-api` and Docker version failed with socket permission denied; `GET http://127.0.0.1:8093/alive` failed to connect. No production writes, deployment, content import or database copy was performed. Owner's previous deployment output identifies backup `starlights-pre-append-20261017-110331.bak` and rollback tag `rollback-20261017-110331`; these were not independently inspected.

Outstanding: run all backend/HTTP integration tests and SQL failure injection; test the supplied append structure against an actual installed fixture; verify Compendium and Builder effects, character save/reopen/edit, mixed files, overlapping patches, repeated uploads, replacement, deletion, upstream updates, malformed XML and unknown IDs; compare unrelated content/characters before and after. The added tests use synthetic `ID_APPEND_FIXTURE` with `AdditionalSupport`, but this fixture has not been imported into a running installation. Mixed-file replacement with removed definitions needs explicit end-to-end coverage as well.

Frontend validation used Node 24.21.0, installed dependencies from the main checkout, and the TypeScript 7 native executable because the shared `.bin/tsc` is stale. Only the isolated worktree was built. No backend/browser success is inferred from passing frontend tests or the owner's deployment output. Do not deploy the correction until its backend and disposable-installation checks pass.
