#!/usr/bin/env python3
"""Serve the built site on a local port. Nothing here touches the network."""

import argparse
import functools
import http.server
import os
import socketserver

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--port", type=int, default=8000)
    args = parser.parse_args()

    if not os.path.isdir(os.path.join(ROOT, "data")):
        raise SystemExit("site/data is missing — run: python3 build.py")

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=ROOT)
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print("tty.man serving on http://localhost:%d  (ctrl-c to stop)" % args.port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()


if __name__ == "__main__":
    main()
