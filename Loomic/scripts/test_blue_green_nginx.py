"""Exercise real Nginx reloads against two independent HTTP server processes."""
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

from scripts.test_blue_green_release import FakeHost, load_release


SERVER = r'''
import http.server,json,sys
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        checks={name:{'ok':True} for name in ('database','storage','accepting')}
        self.wfile.write(json.dumps({'ok':True,'version':sys.argv[1],'checks':checks}).encode())
    def log_message(self,*args): pass
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[2])),Handler).serve_forever()
'''


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


@unittest.skipUnless(sys.platform.startswith("linux") and shutil.which("nginx"), "requires an isolated Linux Nginx executable")
class NginxReleaseTests(unittest.TestCase):
    def test_actual_reload_success_and_failed_public_verification_recovery(self):
        release = load_release()
        for failure in (None, "verify_public"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(prefix="helstera-nginx-") as folder:
                directory = pathlib.Path(folder)
                old_port, new_port, public_port = free_port(), free_port(), free_port()
                old_web, new_web = directory / "old", directory / "new"
                old_web.mkdir()
                new_web.mkdir()
                config = directory / "nginx.conf"
                before = (f"pid {directory}/nginx.pid;\nerror_log {directory}/error.log;\n"
                    "events { worker_connections 128; }\nhttp { access_log off;\nserver {\n"
                    f"    listen 127.0.0.1:{public_port};\n    root {old_web};\n"
                    f"    location /api/ {{ proxy_pass http://127.0.0.1:{old_port}; }}\n"
                    "    location / { try_files $uri $uri/ =404; }\n}\n}\n").encode()
                config.write_bytes(before)
                url = f"http://127.0.0.1:{public_port}/api/health"
                children = []
                observer_stop = threading.Event()
                samples = []
                master = None

                def launch(version, port):
                    children.append(subprocess.Popen([sys.executable, "-c", SERVER, version, str(port)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                    deadline = time.monotonic() + 5
                    while True:
                        try:
                            release.load_script("switch-server-upstream").ready(port, version)
                            return
                        except OSError:
                            if time.monotonic() >= deadline:
                                raise RuntimeError("Fixture API did not start")
                            time.sleep(0.02)

                def nginx(arguments):
                    return subprocess.run(["nginx", "-p", folder + "/", "-c", str(config), *arguments],
                                          capture_output=True, text=True, check=True, timeout=10)

                adapter = release.LocalHost.__new__(release.LocalHost)
                adapter.state_path = directory / ".active-release.json"
                adapter.previous_state = None
                adapter.config = config
                adapter.before = before
                adapter.after = release.prepare_routes(before, old_port, new_port, old_web, new_web,
                                                        release.load_script("validate-studio-nginx"))
                adapter.previous = {"port": old_port}
                adapter.old_version = "old"
                adapter.port = new_port
                adapter.version = "new"
                adapter.public_url = url
                adapter.switcher = release.load_script("switch-server-upstream")
                adapter.verify_worker = lambda: None
                adapter.run = lambda arguments: nginx(arguments[1:])

                class Host(FakeHost):
                    def step(self, name):
                        time.sleep(0.02)
                        super().step(name)

                    def start_api(self):
                        launch("new", new_port)
                        super().start_api()

                    def verify_api(self):
                        adapter.verify_api()
                        super().verify_api()

                    def switch_routes(self):
                        adapter.switch_routes()
                        super().switch_routes()

                    def verify_public(self):
                        adapter.switcher.wait_public(url, "new")
                        super().verify_public()

                    def restore_routes(self):
                        adapter.restore_routes()
                        super().restore_routes()

                def observe():
                    while not observer_stop.is_set():
                        try:
                            with urllib.request.urlopen(url, timeout=1) as response:
                                samples.append(response.status)
                        except OSError:
                            samples.append(502)
                        observer_stop.wait(0.005)

                try:
                    launch("old", old_port)
                    nginx(["-t"])
                    master = subprocess.Popen(["nginx", "-p", folder + "/", "-c", str(config), "-g", "daemon off;"],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    deadline = time.monotonic() + 5
                    while True:
                        try:
                            adapter.switcher.public_ready(url, "old")
                            break
                        except OSError:
                            if time.monotonic() >= deadline:
                                raise RuntimeError("Fixture Nginx did not start")
                            time.sleep(0.02)
                    observer = threading.Thread(target=observe, daemon=True)
                    observer.start()
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, failure):
                            release.rollout(Host(failure), directory / "transaction.json")
                        self.assertEqual(config.read_bytes(), before)
                    else:
                        release.rollout(Host(), directory / "transaction.json")
                    adapter.switcher.public_ready(url, "old" if failure else "new")
                    observer_stop.set()
                    observer.join(timeout=5)
                    self.assertGreaterEqual(len(samples), 10)
                    self.assertEqual(set(samples), {200})
                finally:
                    observer_stop.set()
                    if master is not None:
                        nginx(["-s", "quit"])
                        master.wait(timeout=10)
                    for child in children:
                        child.terminate()
                        child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
