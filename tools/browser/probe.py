#!/usr/bin/env python3
"""Check a page's console, or hit endpoints, and print the result as compact JSON.

No screenshot and no fixed wait: `console` returns as soon as the page has loaded, no
requests are in flight and nothing new has been logged for --quiet seconds.

    probe.py console http://localhost:5173/
    probe.py http https://<bucket>.r2.dev/latest.json URL2 ...

Exit status is 0 when everything is ok, 1 otherwise.

console -> {url, loaded, ok, elapsed_s, errors, warnings, [logs], failed_requests}
           errors/warnings/logs are [{text, count}]; failed_requests are {status|error, url}.
           The favicon and software-GL noise are ignored; add more with --ignore REGEX.
http    -> {ok, results: [{url, status, content_type, bytes, elapsed_ms, json|body}]}
           JSON is detected by content, not the Content-Type header, since static servers
           often label it octet-stream. A large JSON body is shortened (json_truncated).
           A real server is a good check that Content-Type is what the client expects
           (e.g. text/html where JSON was expected).
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

from browser import NOISE, console_messages, launch, wait_loaded, wait_until


def emit(result: dict) -> int:
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result["ok"] else 1


# --- console ----------------------------------------------------------------


def failed_requests(events: list[dict]) -> list[dict]:
    urls, out = {}, []
    for e in events:
        method, p = e.get("method"), e.get("params", {})
        if method == "Network.requestWillBeSent":
            urls[p["requestId"]] = p["request"]["url"]
        elif method == "Network.responseReceived" and p["response"]["status"] >= 400:
            out.append({"status": p["response"]["status"], "url": p["response"]["url"]})
        elif method == "Network.loadingFailed" and not p.get("canceled"):
            out.append({"error": p["errorText"], "url": urls.get(p["requestId"], "?")})
    return out


def in_flight(events: list[dict]) -> int:
    pending = set()  # a set, since a cache hit can end a request without loadingFinished
    for e in events:
        method, p = e.get("method"), e.get("params", {})
        if method == "Network.requestWillBeSent":
            # A worker's own script load (empty loaderId) finishes in the worker's session, so
            # this session never sees it end.
            if p.get("loaderId"):
                pending.add(p["requestId"])
        elif method in ("Network.loadingFinished", "Network.loadingFailed", "Network.requestServedFromCache"):
            pending.discard(p["requestId"])
    return len(pending)


def grouped(messages: list[dict], level: str) -> list[dict]:
    counts: dict[str, int] = {}
    for m in messages:
        if m["level"] == level:
            counts[m["text"]] = counts.get(m["text"], 0) + 1
    return [{"text": t, "count": c} for t, c in counts.items()]


def console(args) -> int:
    ignore = re.compile("|".join(NOISE + args.ignore))
    start = time.time()
    with launch(args.url, domains=("Runtime", "Log", "Page", "Network")) as cdp:
        loaded = wait_loaded(cdp, args.timeout)
        if args.wait and not wait_until(cdp, args.wait, args.timeout):
            print("probe: --wait never became true", file=sys.stderr)
        seen, quiet_since = len(cdp.events), time.time()
        while time.time() - start < args.timeout:
            cdp.drain(0.2)
            if len(cdp.events) != seen:
                seen, quiet_since = len(cdp.events), time.time()
            elif in_flight(cdp.events) <= 0 and time.time() - quiet_since >= args.quiet:
                break
        # Failed loads are reported (with URL) in failed_requests, so drop Chrome's duplicate.
        messages = [
            m
            for m in console_messages(cdp.events)
            if not ignore.search(m["text"]) and not m["text"].startswith("Failed to load resource")
        ]
        failed = [f for f in failed_requests(cdp.events) if not ignore.search(f["url"])]

    result = {
        "url": args.url,
        "loaded": loaded,
        "elapsed_s": round(time.time() - start, 1),
        "errors": grouped(messages, "error"),
        "warnings": grouped(messages, "warning"),
        "failed_requests": failed,
    }
    if args.all:
        result["logs"] = [
            {"level": m["level"], "text": m["text"]}
            for m in messages
            if m["level"] not in ("error", "warning")
        ]
    result["ok"] = loaded and not result["errors"] and not failed
    return emit(result)


# --- http -------------------------------------------------------------------


def shrink(o, depth=3, width=8):
    """Keep the shape of a large JSON value: first few keys/items, shortened strings."""
    if isinstance(o, dict):
        d = {k: (shrink(v, depth - 1, width) if depth else "…") for k, v in list(o.items())[:width]}
        if len(o) > width:
            d["…"] = f"{len(o) - width} more keys"
        return d
    if isinstance(o, list):
        items = [shrink(v, depth - 1, width) if depth else "…" for v in o[:3]]
        return items + [f"…{len(o) - 3} more"] if len(o) > 3 else items
    if isinstance(o, str) and len(o) > 200:
        return o[:200] + "…"
    return o


def fetch(url: str, max_chars: int, timeout: float) -> dict:
    # In-network container names (no dot) and localhost must not go through the proxy.
    host = urlparse(url).hostname or ""
    direct = "." not in host or host == "localhost"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({} if direct else None))
    opener.addheaders = [("User-Agent", "Mozilla/5.0 (probe.py)")]  # Cloudflare rejects urllib's default with error 1010
    start = time.time()
    try:
        with opener.open(url, timeout=timeout) as r:
            status, ctype, raw = r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        status, ctype, raw = e.code, e.headers.get("Content-Type"), e.read()
    except (urllib.error.URLError, OSError) as e:
        return {"url": url, "status": None, "error": str(getattr(e, "reason", e))}

    result = {
        "url": url,
        "status": status,
        "content_type": ctype,
        "bytes": len(raw),
        "elapsed_ms": round((time.time() - start) * 1000),
    }
    text = raw.decode("utf-8", "replace")
    try:
        if not text.lstrip().startswith(("{", "[")):
            raise ValueError
        data = json.loads(text)
    except ValueError:
        result["body"] = text[:max_chars] + ("…" if len(text) > max_chars else "")
        return result
    if len(json.dumps(data)) > max_chars:
        data, result["json_truncated"] = shrink(data), True
    result["json"] = data
    return result


def http(args) -> int:
    results = [fetch(u, args.max_chars, args.timeout) for u in args.urls]
    return emit({"ok": all(r["status"] and r["status"] < 400 for r in results), "results": results})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    c = sub.add_parser("console", help="load a page in headless Chrome and report its console")
    c.add_argument("url")
    c.add_argument("--quiet", type=float, default=1.5, help="seconds of silence (and no requests in flight) before returning")
    c.add_argument("--timeout", type=float, default=30.0, help="hard limit in seconds")
    c.add_argument("--wait", help="poll this JS until it is true before settling")
    c.add_argument("--ignore", action="append", default=[], metavar="REGEX", help="drop messages/URLs matching this")
    c.add_argument("--all", action="store_true", help="also include plain console.log/info/debug output")
    c.set_defaults(run=console)

    h = sub.add_parser("http", help="GET endpoints and report status, headers and parsed JSON")
    h.add_argument("urls", nargs="+")
    h.add_argument("--max-chars", type=int, default=1500, help="longest body/JSON to return in full")
    h.add_argument("--timeout", type=float, default=30.0)
    h.set_defaults(run=http)

    args = parser.parse_args()
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
