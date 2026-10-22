# web-view

Static web app (GitHub Pages) for viewing and inspecting AutoTerm Greenland glacier terminus data, with the data served from a Cloudflare R2 bucket. The full plan is in `docs/implementation-plan.md`.

**Start here:** check the milestones table (plan §10) for what's done and what's next, and §11 for open questions (build with the stated defaults). Read §3–6 before touching data prep and §5 + §8 before touching the app. Update the milestone Status column when a milestone is merged.

## Where things are

| What | Where |
|---|---|
| Raw AutoTerm archive (zips + CSVs, 1.8 GB) | `/home/oxygen/Downloads/autoterm_data/` (read-only, never copy into the repo) |
| Manuscript (Zhang et al., 2023, *The Cryosphere*) | `references/manuscript.md` (git-ignored) |
| Implementation plan, bucket layout, file schemas | `docs/implementation-plan.md` |
| Data prep pipeline | `prep/` (planned) |
| Built data, ready for upload | `dist-data/` (git-ignored) |
| Upload script (rclone → R2) | `prep/upload.sh` (run by the developer, not in the sandbox: R2 is firewalled and the credentials stay on their machine) |
| Web app | `app/` (planned) |
| Browser tool for visual checks | `tools/browser/` |
| Published data | `https://pub-f0be383784914488861cad529a904412.r2.dev/autoterm` (R2 via `r2.dev`; `v1` is live). Set as `VITE_DATA_BASE_URL`; the app fetches `<base>/latest.json`, then `<base>/<version>/glaciers.json`. A custom domain is planned later |
| GitHub repo / Pages | `AutoTermLab/web-view` → `https://autotermlab.github.io/web-view/` |

## Rules

### Review and git
- **Never commit automatically.** Pause and show the change for review; commit only after approval.
- Each new feature gets its own branch (`feature/<name>`; milestone branch names are in plan §10). Commit there once approved, then merge into `main` with `git merge --no-ff` after a final review.
- Pause for review before every merge.
- Don't push unless asked.

### When unsure
- When confidence is low or a change is complex, say so. Suggest review by an Opus subagent or by the developer before going further.

### Code
- Write simple, concise code. Don't build for edge cases that haven't come up.
- Reuse before writing new code, in this order:
  1. code already in this repo,
  2. the standard library,
  3. a new dependency, as a last resort and only after proposing it and getting approval.
- Match the style of the code around the change.

### Tests (test-driven)
1. Write a failing test and run it to show that it fails.
2. Implement.
3. Run the test again to show that it passes.

- While working, run only the tests related to the change.
- Run the full suite, including the visual browser checks, only before the final merge.

## Environment

- Python: use `uv` (e.g., `uv run`, `uv add`). The host Python is 3.14 and `python -m venv` doesn't work here.
- Node 22 / npm 9 are on the login shell: `bash -l -c "npm …"` if `node` isn't on PATH.
- Docker is available. Chrome is not installed on the host, so use the browser tool below.
- Outbound network goes through a firewall: npm, PyPI, GitHub, Debian and Google downloads are allowed. A blocked request returns HTTP 403 with the reason in the body.

## Visual inspection tool (`tools/browser/`)

Headless Chrome driven over the DevTools Protocol, standard-library Python only. It runs in Docker, since there is no Chrome on the host.

```bash
# build once (passes the sandbox proxy through)
docker build -t web-view-browser tools/browser \
  --build-arg HTTP_PROXY="$HTTP_PROXY" --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg NO_PROXY="$NO_PROXY"

# screenshot (WebGL included), with console output printed
docker run --rm --network host -v "$PWD/shots:/out" web-view-browser \
  shot.py http://localhost:5173/ -o /out/home.png --wait 'window.ready === true'

# console errors + failed requests as JSON (exit 1 if any)
docker run --rm --network host web-view-browser probe.py console http://localhost:5173/

# check data URLs (status, content type, parsed JSON)
docker run --rm web-view-browser probe.py http https://pub-f0be383784914488861cad529a904412.r2.dev/autoterm/latest.json
```

- Screenshots go to `shots/` (git-ignored).
- `--network host` lets the container reach dev servers running in this sandbox (verified).
- Behind the sandbox proxy, put the proxy's CA in `tools/browser/certs/*.crt` before building (git-ignored). In this sandbox: `cp /usr/local/share/ca-certificates/proxy-ca.crt tools/browser/certs/`. A stale CA shows up as `CERTIFICATE_VERIFY_FAILED` in `probe.py http`.
- The image `web-view-browser` is already built in this sandbox. Rebuild only after changing `tools/browser/`.
