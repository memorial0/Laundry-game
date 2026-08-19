#!/usr/bin/env python3
"""미리보기용 정적 서버.

`python3 -m http.server` 를 그냥 쓰면 안 되는 이유: 캐시 헤더를 하나도 안 붙여서
브라우저가 제 판단으로 survey.js·preview.html 을 붙잡아 둔다. 문구를 고치고 새로고침해도
옛 화면이 그대로 나와서, 고친 게 반영이 안 된 줄 알고 엉뚱한 데를 뒤지게 된다.

    python3 serve.py            # 8000 번
    python3 serve.py 8080       # 다른 번호로

멈출 때는 Ctrl+C.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 자극·설문 파일을 고치는 중에는 캐시가 도움이 아니라 방해다
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def translate_path(self, path):
        # 배포에서는 build.mjs 가 preview.html 을 dist/index.html 로도 복사해서 '/' 가 러너를
        # 연다. 로컬만 디렉터리 목록이 뜨면 참가자가 볼 화면과 다른 것을 보며 확인하게 되므로
        # 여기서도 '/' 를 러너로 보낸다.
        if path.split('?', 1)[0].split('#', 1)[0] in ('/', '/index.html'):
            path = '/preview.html'
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        # 404 만 남긴다 — 200 까지 찍으면 흐름이 로그에 묻힌다
        if args and str(args[1]) != '200':
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print('http://localhost:%d/  (참가자 화면 — 배포와 같은 주소)' % port)
    print('http://localhost:%d/?dev=1  (연구원 화면)' % port)
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
