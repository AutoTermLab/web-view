# web-view

Static web app (GitHub Pages) for viewing and inspecting AutoTerm Greenland glacier terminus data, with the data served from a Cloudflare R2 bucket. The full plan is in `docs/implementation-plan.md`.

## Where things are

| What | Where |
|---|---|
| Raw AutoTerm archive (zips + CSVs, 1.8 GB) | `/home/oxygen/Downloads/autoterm_data/` (read-only, never copy into the repo) |
| Manuscript (Zhang et al., 2023, *The Cryosphere*) | `references/manuscript.md` (git-ignored) |
| Implementation plan, bucket layout, file schemas | `docs/implementation-plan.md` |
| Data prep pipeline | `prep/` (planned) |
| Built data, ready for upload | `dist-data/` (git-ignored) |
| Web app | `app/` (planned) |
| Browser tool for visual checks | `tools/browser/` |
| Published data | R2 bucket via `r2.dev` (URL TBD; set as `VITE_DATA_BASE_URL`) |

## Rules

### Review and git
- **Never commit automatically.** Pause and show the change for review; commit only after approval.
- Each new feature gets its own branch (`feature/<name>`). Commit there once approved, then merge into `main` after a final review.
- Pause for review before every merge.

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
docker run --rm web-view-browser probe.py http https://<bucket>.r2.dev/latest.json
```

- Screenshots go to `shots/` (git-ignored).
- Behind the sandbox proxy, put the proxy's CA in `tools/browser/certs/*.crt` before building (git-ignored).
- The build needs `deb.debian.org` and `dl.google.com` allowed in the network policy.
