"""Rium Download native host. No arbitrary commands, URLs or output paths accepted."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

BASE = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
ROOT = BASE.parent
ORIGIN = 'chrome-extension://djmeafcoodphkgchinlkdindemkdjkof/'
LOCK = threading.Lock()
STOP = threading.Event()
PROCESS = None
WORKER = None
SERVER = None
WORK = None
CREATE_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

def send(message):
    data = json.dumps(message, ensure_ascii=False).encode('utf-8')
    with LOCK:
        sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
        sys.stdout.buffer.flush()

def read_exact(stream, n):
    out = bytearray()
    while len(out) < n:
        part = stream.read(n - len(out))
        if not part:
            if not out:
                return None
            raise ValueError('truncated frame')
        out.extend(part)
    return bytes(out)

def receive(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack('<I', header)[0]
    if not 0 < size <= 16384:
        raise ValueError('message size')
    data = read_exact(stream, size)
    if data is None:
        raise ValueError('missing body')
    msg = json.loads(data)
    if not isinstance(msg, dict):
        raise ValueError('message type')
    return msg

def validate(msg):
    video = msg.get('videoId')
    mode = msg.get('mode')
    if not isinstance(video, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
        raise ValueError('invalid video ID')
    if mode not in ('video', 'audio'):
        raise ValueError('invalid mode')
    return video, mode

def tools_config():
    config = json.loads((BASE / 'config.json').read_text('utf-8-sig'))
    names = ('ffmpeg', 'node') if getattr(sys, 'frozen', False) else ('python', 'ffmpeg', 'node')
    for name in names:
        config[name] = str((BASE / config[name]).resolve())
        if not Path(config[name]).is_file():
            raise ValueError('missing dependency')
    return config

def make_handler(file, token):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def serve(self, body):
            if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}' or self.path != '/' + token:
                self.send_error(404)
                return
            size = file.stat().st_size
            start, end = 0, size - 1
            requested = self.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
                if not match:
                    self.send_error(416)
                    return
                start = int(match[1])
                end = min(int(match[2]) if match[2] else end, end)
                if start > end:
                    self.send_error(416)
                    return
            self.send_response(206 if requested else 200)
            self.send_header('Content-Type', 'audio/mp4' if file.suffix == '.m4a' else 'video/x-matroska')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if requested:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if body:
                try:
                    with file.open('rb') as stream:
                        stream.seek(start)
                        remaining = end - start + 1
                        while remaining and not STOP.is_set():
                            block = stream.read(min(1024 * 1024, remaining))
                            if not block:
                                break
                            self.wfile.write(block)
                            remaining -= len(block)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
    return Handler

def terminate():
    STOP.set()
    proc = PROCESS
    if proc and proc.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=CREATE_FLAGS, timeout=15)
        else:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

def download(msg):
    global PROCESS, SERVER, WORK
    try:
        video, mode = validate(msg)
        cfg = tools_config()
        base = ROOT / 'tmp' / 'native-downloads'
        base.mkdir(parents=True, exist_ok=True)
        if not base.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError('unsafe temporary directory')
        WORK = base / secrets.token_hex(16)
        WORK.mkdir()
        env = os.environ.copy()
        env.update(TEMP=str(WORK), TMP=str(WORK), PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
        # Fixed options and a validated ID only. No cookies, config files or plugins.
        prefix = [sys.executable, '--yt-dlp'] if getattr(sys, 'frozen', False) else [cfg['python'], '-m', 'yt_dlp']
        cmd = prefix + ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir',
               '--no-playlist', '--no-warnings', '--newline', '--progress', '--no-colors',
               '--socket-timeout', '30', '--retries', '3', '--fragment-retries', '3',
               '--js-runtimes', 'node:' + cfg['node'], '--ffmpeg-location', cfg['ffmpeg'],
               '--match-filter', '!is_live & !is_upcoming', '--max-filesize', '20G',
               '--progress-template', 'download:RIUM_PROGRESS:%(progress._percent_str)s',
               '--print', 'after_move:RIUM_FILE:%(filepath)s', '--no-simulate',
               '-o', str(WORK / 'media.%(ext)s')]
        if mode == 'audio':
            cmd += ['-f', 'bestaudio[ext=m4a][acodec^=mp4a]']
        else:
            cmd += ['-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mkv', '--remux-video', 'mkv']
        cmd += ['--', 'https://www.youtube.com/watch?v=' + video]
        if STOP.is_set():
            raise InterruptedError()
        PROCESS = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   text=True, encoding='utf-8', errors='replace', env=env,
                                   creationflags=CREATE_FLAGS, cwd=WORK, start_new_session=os.name != 'nt')
        if STOP.is_set():
            terminate()
        output = None
        last_emit = 0
        for line in PROCESS.stdout:
            if STOP.is_set():
                terminate()
                break
            if line.startswith('RIUM_PROGRESS:') and time.monotonic() - last_emit >= .3:
                match = re.search(r'(\d+(?:\.\d+)?)%', line)
                if match:
                    send({'type': 'progress', 'progress': min(90, float(match[1]) * .9)})
                    last_emit = time.monotonic()
            elif line.startswith('RIUM_FILE:'):
                output = Path(line[len('RIUM_FILE:'):].strip()).resolve()
        code = PROCESS.wait()
        if STOP.is_set():
            send({'type': 'cancelled'})
            return
        if code or not output or not output.is_relative_to(WORK.resolve()) or not output.is_file():
            raise ValueError('download failed')
        if output.suffix not in ('.m4a', '.mkv') or output.stat().st_size == 0:
            raise ValueError('unexpected output')
        token = secrets.token_urlsafe(32)
        SERVER = http.server.ThreadingHTTPServer(('127.0.0.1', 0), make_handler(output, token))
        SERVER.daemon_threads = True
        threading.Thread(target=SERVER.serve_forever, daemon=True).start()
        send({'type': 'ready', 'url': f'http://127.0.0.1:{SERVER.server_port}/{token}',
              'extension': output.suffix[1:], 'bytes': output.stat().st_size})
    except Exception:
        send({'type': 'cancelled' if STOP.is_set() else 'error',
              'error': '유튜브 다운로드에 실패했습니다. 비공개·라이브·로그인 필요 영상은 지원하지 않으며 yt-dlp 업데이트가 필요할 수 있습니다.'})

def main():
    global WORKER
    allowed = tools_config().get('allowed_origins', [ORIGIN])
    if len(sys.argv) < 2 or sys.argv[1] not in allowed:
        return 2
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        while True:
            msg = receive(sys.stdin.buffer)
            if msg is None:
                break
            if msg.get('type') == 'ping':
                tools_config()
                send({'type': 'pong', 'version': 1})
            elif msg.get('type') == 'update' and WORKER is None:
                try:
                    import updater
                    version = updater.update(BASE, sys.argv[1])
                    send({'type': 'updated', 'version': version})
                except Exception as error:
                    message = str(error) if isinstance(error, ValueError) else '업데이트에 실패했습니다. 설치파일로 다시 시도해 주세요.'
                    send({'type': 'error', 'error': message[:250]})
                break
            elif msg.get('type') == 'download' and WORKER is None:
                validate(msg)
                WORKER = threading.Thread(target=download, args=(msg,))
                WORKER.start()
            elif msg.get('type') in ('cancel', 'release'):
                terminate()
                break
            else:
                raise ValueError('unsupported message')
    except Exception:
        send({'type': 'error', 'error': '도우미 요청이 올바르지 않거나 필요한 도구를 찾지 못했습니다.'})
    finally:
        terminate()
        if WORKER:
            WORKER.join(timeout=20)
        if SERVER:
            SERVER.shutdown()
            SERVER.server_close()
        if WORK and WORK.resolve().parent == (ROOT / 'tmp' / 'native-downloads').resolve():
            shutil.rmtree(WORK, ignore_errors=True)
    return 0

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--install', '--register-installed', '--unregister-installed'):
        import installer
        installer.main()
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == '--yt-dlp' and getattr(sys, 'frozen', False):
        import yt_dlp
        yt_dlp.main(sys.argv[2:])
        sys.exit(0)
    sys.exit(main())
