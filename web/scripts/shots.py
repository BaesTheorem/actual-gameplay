"""Drive the built site in headless Chromium and save screenshots.

  python3 web/scripts/shots.py            # serves web/dist under /actual-gameplay/ and walks the screens

Screenshots land in build/webtest/. It is a look at the real pages under the same path prefix
GitHub Pages uses, with page errors and failed requests printed.
"""
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "build/webtest"
SITE = OUT / "site"
PORT = 5098


def serve():
    SITE.mkdir(parents=True, exist_ok=True)
    link = SITE / "actual-gameplay"
    if not link.exists():
        link.symlink_to(ROOT / "web/dist")
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(SITE))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main(steps):
    server = serve()
    base = f"http://127.0.0.1:{PORT}/actual-gameplay/"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"])
        # The worker is blocked so every run loads the files that were just built.
        page = browser.new_context(viewport={"width": 402, "height": 874}, device_scale_factor=2, service_workers="block").new_page()
        page.on("pageerror", lambda e: print("PAGE ERROR", e))
        page.on("console", lambda m: m.type in ("error", "warning") and print("CONSOLE", m.type, m.text[:300]))
        page.on("response", lambda r: r.status >= 400 and print("HTTP", r.status, r.url))
        for step in steps:
            kind, _, arg = step.partition("=")
            if kind == "go":
                page.goto(base + arg)
                page.wait_for_timeout(1500)
            elif kind == "size":  # the window, as WxH; taps still take canvas points only at 402x874
                w, h = (int(v) for v in arg.split("x"))
                page.set_viewport_size({"width": w, "height": h})
            elif kind == "wait":
                page.wait_for_timeout(int(float(arg) * 1000))
            elif kind == "tap":  # canvas points, y up, as the levels are written
                x, y = (float(v) for v in arg.split(","))
                page.mouse.click(x, 874 - y)
            elif kind == "drag":  # x1,y1,x2,y2 in canvas points, y up; the finger lifts at the end
                x1, y1, x2, y2 = (float(v) for v in arg.split(","))
                page.mouse.move(x1, 874 - y1)
                page.mouse.down()
                page.mouse.move(x2, 874 - y2, steps=8)
                page.mouse.up()
            elif kind == "stroke":  # x1,y1;x2,y2;... in canvas points, y up: one finger through every point
                pts = [tuple(float(v) for v in pair.split(",")) for pair in arg.split(";")]
                page.mouse.move(pts[0][0], 874 - pts[0][1])
                page.mouse.down()
                for x, y in pts[1:]:
                    page.mouse.move(x, 874 - y, steps=6)
                page.mouse.up()
            elif kind == "until":  # wait until a JavaScript expression is true
                page.wait_for_function(arg, timeout=30000)
            elif kind == "click":
                page.click(arg)
            elif kind == "shot":
                page.screenshot(path=str(OUT / f"{arg}.png"))
                print("shot", arg)
            elif kind == "eval":
                print(page.evaluate(arg))
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main(sys.argv[1:])
