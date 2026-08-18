#!/usr/bin/env python3
"""A local stand-in for Google Drive's download endpoints.

Reproduces the behaviours drive_fetch.sh has to cope with, so the script can be
tested without network access or a real shared file.

Modes, selected by file id:
  small      - streams bytes straight back, no confirmation
  large      - HTML form carrying the confirmation token (current Drive)
  legacy     - HTML with no form, token delivered as a download_warning cookie
  private    - HTML both times, as when a file is not link-shared
  truncated  - confirms, then returns a short/corrupt body

Usage: mock_drive.py <port> <payload-file>
"""

import http.server
import sys
import urllib.parse

PAYLOAD = b""
PORT = 0

FORM_PAGE = """<!DOCTYPE html><html><head><title>Google Drive - Virus scan warning</title></head>
<body><form id="download-form" action="http://127.0.0.1:{port}/download" method="get">
<input type="hidden" name="id" value="{fid}">
<input type="hidden" name="export" value="download">
<input type="hidden" name="confirm" value="t">
<input type="hidden" name="uuid" value="9f8c2a11-aaaa-bbbb-cccc-1234567890ab">
<button id="uc-download-link" type="submit">Download anyway</button>
</form></body></html>"""

LEGACY_PAGE = """<!DOCTYPE html><html><body>
<p>Google Drive can't scan this file for viruses.</p>
<a href="/uc?export=download&amp;confirm=ABCD1234&amp;id={fid}">Download anyway</a>
</body></html>"""

SIGNIN_PAGE = """<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head>
<body>You need access. Ask the owner for permission.</body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # keep the test output readable

    def _html(self, body, cookie=None):
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def _bytes(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-zip-compressed")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", 'attachment; filename="export.zip"')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        fid = (qs.get("id") or [""])[0]
        confirm = (qs.get("confirm") or [""])[0]

        # Second request: the caller has a token.
        if parsed.path == "/download" or confirm:
            if fid == "private":
                return self._html(SIGNIN_PAGE)
            if not confirm:
                return self._html(SIGNIN_PAGE)
            if fid == "truncated":
                return self._bytes(PAYLOAD[: len(PAYLOAD) // 3])
            return self._bytes(PAYLOAD)

        # First request.
        if parsed.path == "/uc":
            if fid == "small":
                return self._bytes(PAYLOAD)
            if fid == "legacy":
                return self._html(
                    LEGACY_PAGE.format(fid=fid),
                    cookie="download_warning_12345_legacy=ABCD1234; Path=/",
                )
            if fid == "private":
                return self._html(SIGNIN_PAGE)
            return self._html(FORM_PAGE.format(port=PORT, fid=fid))

        self.send_error(404)


if __name__ == "__main__":
    PORT = int(sys.argv[1])
    PAYLOAD = open(sys.argv[2], "rb").read()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.serve_forever()
