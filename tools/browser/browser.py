"""Chrome + DevTools plumbing shared by shot.py and probe.py. Standard library only.

The WebSocket client below is the small part of RFC 6455 that the protocol needs.
"""

from __future__ import annotations

import base64
import json
import os
import random
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from urllib.parse import urlparse


# --- the smallest WebSocket client that works -----------------------------


class WebSocket:
    def __init__(self, url: str, timeout: float = 30.0):
        rest = url.removeprefix("ws://")
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(bytes(random.getrandbits(8) for _ in range(16))).decode()
        self.sock.sendall(
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n".encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("the browser closed the connection")
            buf += chunk
        status_line = buf.split(b"\r\n")[0]
        if b" 101 " not in status_line:
            raise ConnectionError(f"handshake refused: {status_line!r}")
        self.rest = buf.split(b"\r\n\r\n", 1)[1]

    def _read(self, n: int) -> bytes:
        while len(self.rest) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("the browser closed the connection")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def send(self, text: str) -> None:
        payload = text.encode()
        header = bytearray([0x81])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 1 << 16:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = bytes(random.getrandbits(8) for _ in range(4))
        header += mask
        self.sock.sendall(
            bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        )

    def recv(self) -> str:
        chunks = []
        while True:
            b0, b1 = self._read(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            data = self._read(n) if n else b""
            if opcode == 0x8:  # close
                raise ConnectionError("the browser closed the connection")
            if opcode == 0x9:  # ping
                self.sock.sendall(b"\x8a\x00")
                continue
            chunks.append(data)
            if fin:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# --- DevTools ---------------------------------------------------------------


class Devtools:
    def __init__(self, ws_url: str):
        self.ws = WebSocket(ws_url)
        self.next_id = 0
        self.events: list[dict] = []

    def call(self, method: str, params: dict | None = None, timeout: float = 60.0):
        self.next_id += 1
        wanted = self.next_id
        self.ws.send(json.dumps({"id": wanted, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = json.loads(self.ws.recv())
            if message.get("id") == wanted:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            if "method" in message:
                self.events.append(message)
        raise TimeoutError(f"{method} did not answer")

    def drain(self, seconds: float) -> None:
        """Collect events for a while, so the page can actually run."""
        end = time.time() + seconds
        self.ws.sock.settimeout(0.25)
        while time.time() < end:
            try:
                message = json.loads(self.ws.recv())
            except (TimeoutError, socket.timeout):
                continue
            except ConnectionError:
                break
            if "method" in message:
                self.events.append(message)
        self.ws.sock.settimeout(30.0)


# Headless-Chrome software-GL chatter and the favicon, which the app does not serve.
NOISE = [r"GL Driver Message", r"favicon\.ico"]


def console_messages(events: list[dict]) -> list[dict]:
    """Console output, uncaught exceptions and browser-logged errors, as {level, text}."""
    out = []
    for event in events:
        method, params = event.get("method"), event.get("params", {})
        if method == "Runtime.consoleAPICalled":
            text = " ".join(
                str(a.get("value", a.get("description", ""))) for a in params.get("args", [])
            )
            out.append({"level": params.get("type", "log"), "text": text})
        elif method == "Runtime.exceptionThrown":
            detail = params["exceptionDetails"]
            text = detail.get("exception", {}).get("description") or detail.get("text")
            out.append({"level": "error", "text": text})
        elif method == "Log.entryAdded":
            entry = params["entry"]
            if entry.get("level") in ("error", "warning"):
                text = entry.get("text", "")
                if entry.get("url"):
                    text += f" ({entry['url']})"
                out.append({"level": entry["level"], "text": text})
    return out


def find_browser() -> str:
    for name in ("chromium", "chromium-browser", "google-chrome-stable", "google-chrome"):
        path = shutil.which(name)
        if path:
            return path
    sys.exit("no chromium on PATH")


def proxy_flags(url: str) -> list[str]:
    """Chrome ignores HTTP(S)_PROXY, so pass it explicitly, but go direct to the target
    host (e.g. an in-network container name the proxy cannot route to)."""
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if not proxy:
        return []
    return [
        f"--proxy-server={proxy}",
        f"--proxy-bypass-list={urlparse(url).hostname};localhost;127.0.0.1",
        "--ignore-certificate-errors",  # the proxy re-signs TLS with its own CA
    ]


@contextmanager
def launch(url: str, size=(1280, 800), scale: float = 1.0, domains=("Runtime", "Log", "Page")):
    """Start headless Chrome, attach, enable the given DevTools domains, navigate to url,
    and yield the Devtools session. Chrome and its profile are cleaned up on exit."""
    width, height = size
    port = random.randint(45000, 60000)
    profile = tempfile.mkdtemp(prefix="browser-profile-")
    process = subprocess.Popen(
        [
            find_browser(),
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
            "--hide-scrollbars",
            "--disable-extensions",
            "--no-first-run",
            f"--force-device-scale-factor={scale}",
            f"--window-size={width},{height}",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            *proxy_flags(url),
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        target = None
        deadline = time.time() + 25
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as r:
                    target = next((t for t in json.load(r) if t.get("type") == "page"), None)
                if target and target.get("webSocketDebuggerUrl"):
                    break
            except (urllib.error.URLError, ConnectionError, OSError, json.JSONDecodeError):
                pass
            time.sleep(0.2)
        if not target:
            raise RuntimeError("the browser never offered a page target")

        cdp = Devtools(target["webSocketDebuggerUrl"])
        for domain in domains:
            cdp.call(f"{domain}.enable")
        cdp.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False},
        )
        cdp.call("Page.navigate", {"url": url})
        yield cdp
        cdp.ws.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(profile, ignore_errors=True)


def wait_loaded(cdp: Devtools, timeout: float = 30.0) -> bool:
    """Wait for the load event. Real time passes (no virtual time), so rAF loops run."""
    end = time.time() + timeout
    while time.time() < end:
        if any(e.get("method") == "Page.loadEventFired" for e in cdp.events):
            return True
        cdp.drain(0.2)
    return False


def wait_until(cdp: Devtools, expression: str, timeout: float = 30.0) -> bool:
    """Poll a JS expression until it is truthy."""
    end = time.time() + timeout
    while time.time() < end:
        result = cdp.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if result.get("result", {}).get("value"):
            return True
        cdp.drain(0.25)
    return False
