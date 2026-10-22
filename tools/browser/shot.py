#!/usr/bin/env python3
"""Render a page in headless Chrome and write a PNG, for visual inspection.

`chrome --screenshot` captures through a path that does not wait for the WebGL
compositor, so a canvas often lands in the file as black. This drives the DevTools
Protocol instead: attach first, navigate, let real time pass, then ask the
compositor for the frame. It also prints the console output.

    shot.py http://localhost:5173/ -o shot.png -s 1300x850
    shot.py URL -o out.png --wait 'window.ready === true'

For console output or endpoint checks without the screenshot, use probe.py.
"""

import argparse
import base64
import re
import sys

from browser import NOISE, console_messages, launch, wait_loaded, wait_until


def main() -> int:
    parser = argparse.ArgumentParser(description="Screenshot a page, WebGL included.")
    parser.add_argument("url")
    parser.add_argument("-o", "--out", default="shot.png")
    parser.add_argument("-s", "--size", default="1280x800", help="WIDTHxHEIGHT")
    parser.add_argument("--settle", type=float, default=2.5, help="seconds to let the render loop run")
    parser.add_argument("--wait", help="poll this JS until it is true, then settle")
    parser.add_argument("--eval", dest="script", help="run this JS once before settling")
    parser.add_argument("--scale", type=float, default=1.0, help="device pixel ratio")
    parser.add_argument("--quiet", action="store_true", help="do not print the console")
    args = parser.parse_args()

    width, _, height = args.size.partition("x")
    width, height = int(width), int(height)

    with launch(args.url, (width, height), args.scale) as cdp:
        wait_loaded(cdp)
        if args.wait and not wait_until(cdp, args.wait):
            print("shot: --wait never became true", file=sys.stderr)
        if args.script:
            result = cdp.call(
                "Runtime.evaluate",
                {"expression": args.script, "returnByValue": True, "awaitPromise": True},
            )
            if "exceptionDetails" in result:
                print(f"shot: --eval threw: {result['exceptionDetails']}", file=sys.stderr)
        cdp.drain(args.settle)

        data = base64.b64decode(
            cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"]
        )
        with open(args.out, "wb") as handle:
            handle.write(data)

        if not args.quiet:
            noise = re.compile("|".join(NOISE))
            for m in console_messages(cdp.events):
                if not noise.search(m["text"]):
                    print(f"[{m['level']}] {m['text']}")
    print(f"shot: {args.out} {len(data)} bytes {width}x{height} @{args.scale}x")
    return 0


if __name__ == "__main__":
    sys.exit(main())
