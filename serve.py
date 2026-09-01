#!/usr/bin/env python3
"""
serve.py — static server for ORCA that never lets the browser cache anything.

WHY THIS EXISTS
  Python's plain http.server sends Last-Modified but no Cache-Control. Chrome
  then caches heuristically, so a soft refresh can reuse an OLD parser.js while
  revalidating index.html. When the two disagree the ES module import fails, the
  script never runs, and the app renders as a header over a blank page with no
  error anywhere — which is very hard to diagnose and looks like a crash.

  Sending no-store makes the app impossible to half-reload.

Usage: python3 serve.py [port]   (default 8042)
Stdlib only. Compatible with the system Python 3.9.
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        pass  # the terminal stays readable; errors still raise


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8042
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCacheHandler, directory=root)
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    print('ORCA  ->  http://localhost:%d' % port)
    print('Serving %s with caching disabled (Ctrl-C to stop)' % root)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    main()
