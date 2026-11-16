"""Verify the one-time ingress barrier without touching a running Nginx."""
import importlib.util
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request


spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).with_name('legacy-maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)

GALLERY = '''    # The public sidecar is independent of the old application.
    location ^~ /api/public-media/fashion-gallery/img/ {
        proxy_pass http://127.0.0.1:3014;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 180s;
    }
    location ^~ /api/public-media/fashion-gallery/thumbs/ {
        proxy_pass http://127.0.0.1:3014;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 180s;
    }
    location ^~ /fashion-gallery/img/ {
        proxy_pass http://127.0.0.1:3014/api/public-media/fashion-gallery/img/;
        proxy_set_header Authorization "";
        proxy_set_header Cookie "";
        proxy_buffering off;
    }
    location ^~ /fashion-gallery/thumbs/ {
        proxy_pass http://127.0.0.1:3014/api/public-media/fashion-gallery/thumbs/;
        proxy_set_header Authorization "";
        proxy_set_header Cookie "";
        proxy_buffering off;
    }
'''
STATIC = '''    root /www/helstera/apps/web/out;
    location ^~ /creative/ {
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        types { text/javascript mjs js; application/wasm wasm; }
        try_files $uri =404;
    }
    location / { try_files $uri $uri/ $uri.html =404; }
'''
INDEPENDENT = '''    location ^~ /api/auth/ { proxy_pass http://127.0.0.1:4010; }
    location ^~ /api/creative/ { proxy_pass http://127.0.0.1:4011; }
'''
OTHER_VHOST = '''server {
    listen 443 ssl;
    server_name payments.example.test;
    location /api/ { proxy_pass http://127.0.0.1:3003; }
    location /webhook/ { proxy_pass https://payments.example.test; }
}
'''


def fixture(extra=''):
    return ('''http {
server {
    listen 443 ssl;
    server_name studio.example.test;
''' + GALLERY + STATIC + INDEPENDENT + '''    location = /api/assets/private-video {
        client_max_body_size 251m;
        proxy_request_buffering off;
        proxy_pass http://127.0.0.1:3003;
    }
    location /api/website-capture/assistant/ws {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location /api/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
    }
''' + extra + '}\n' + OTHER_VHOST + '}\n')


def body(config, selector):
    match = re.search(r'location\s+' + re.escape(selector) + r'\s*\{([^{}]*)\}', config)
    if not match:
        raise AssertionError('Missing location ' + selector)
    return match[1]


class LegacyMaintenanceTests(unittest.TestCase):
    def test_blocks_all_reviewed_main_api_locations_including_bare_api(self):
        config = fixture('    location = /api/jobs { proxy_pass http://127.0.0.1:3003/api/jobs; }\n')
        updated = maintenance.prepare(config, 3003)
        paths = ['= /api', '/api/', '= /api/jobs', '= /api/assets/private-video', '/api/website-capture/assistant/ws']
        for selector in paths:
            with self.subTest(selector=selector):
                blocked = body(updated, selector)
                self.assertIn('return 503;', blocked)
                self.assertIn('add_header Retry-After "30" always;', blocked)
                self.assertIn('add_header Cache-Control "no-store" always;', blocked)
                self.assertNotIn('proxy_pass', blocked)
                self.assertNotIn('Upgrade', blocked)
        self.assertIn(GALLERY, updated)
        self.assertIn(STATIC, updated)
        self.assertIn(INDEPENDENT, updated)
        self.assertIn(OTHER_VHOST, updated)
        report = maintenance.inspect(config, 3003)
        self.assertEqual(report['serverNames'], ['studio.example.test'])
        self.assertEqual(report['blockedLocations'], ['= /api/assets/private-video', '/api/website-capture/assistant/ws', '/api/', '= /api/jobs'])
        self.assertEqual(report['addedLocations'], ['= /api'])
        self.assertEqual(report['preservedGalleryLocations'], sorted(maintenance.GALLERY_PATHS))

    def test_accepts_exact_bare_api_and_caret_prefix_without_adding_a_duplicate(self):
        config = fixture('    location = /api { proxy_pass http://127.0.0.1:3003; }\n')
        config = config.replace('location /api/ {', 'location ^~ /api/ {', 1)
        updated = maintenance.prepare(config, 3003)
        self.assertEqual(updated.count('location = /api {'), 1)
        self.assertIn('return 503;', body(updated, '^~ /api/'))
        self.assertEqual(maintenance.inspect(config, 3003)['addedLocations'], [])

    def test_blocks_the_observed_health_alias_and_dedicated_auth_and_websocket_routes(self):
        extra = ('    location /api/ws { proxy_pass http://127.0.0.1:3003; }\n'
                 '    location /api/local-auth/ { proxy_pass http://127.0.0.1:3003; }\n'
                 '    location /health { proxy_pass http://127.0.0.1:3003; }\n')
        redirect = 'server { listen 80; server_name studio.example.test; return 301 https://$host$request_uri; }\n'
        config = redirect + fixture(extra)
        updated = maintenance.prepare(config, 3003)
        for path in ['/api/ws', '/api/local-auth/', '/health']:
            self.assertIn('return 503;', body(updated, path))
            self.assertIn(path, maintenance.inspect(config, 3003)['blockedLocations'])
        self.assertTrue(updated.startswith(redirect))

    def test_preserves_crlf_comments_and_quoted_braces_outside_changed_bodies(self):
        config = fixture().replace('root /www/helstera/apps/web/out;', 'root /www/helstera/apps/web/out;\n    add_header X-Note "literal { brace }; # inside quote";\n    # proxy_pass http://127.0.0.1:3003; }')
        config = config.replace('\n', '\r\n')
        updated = maintenance.prepare(config, 3003)
        self.assertIn(GALLERY.replace('\n', '\r\n'), updated)
        self.assertIn(STATIC.splitlines()[0] + '\r\n', updated)
        self.assertIn('add_header X-Note "literal { brace }; # inside quote";', updated)
        self.assertIn('# proxy_pass http://127.0.0.1:3003; }', updated)
        self.assertNotRegex(updated, r'(?<!\r)\n')

    def test_refuses_missing_duplicate_or_unreviewed_gallery_routes(self):
        configs = [
            fixture().replace('location ^~ /fashion-gallery/img/', 'location /fashion-gallery/img/'),
            fixture().replace(':3014/api/public-media/fashion-gallery/img/;', ':3014/private/;'),
            fixture().replace('location ^~ /fashion-gallery/img/', 'location ^~ /fashion-gallery/thumbs/'),
            fixture().replace(GALLERY, GALLERY + GALLERY),
            fixture().replace('proxy_set_header Cookie "";', 'if ($arg_probe) { return 404; }'),
            fixture('    location /secret-media/ { proxy_pass http://127.0.0.1:3014; }\n'),
        ]
        for config in configs:
            with self.subTest(config=config):
                with self.assertRaisesRegex(ValueError, 'gallery|sidecar'):
                    maintenance.prepare(config, 3003)

    def test_refuses_unknown_or_nested_main_api_proxies(self):
        extras = [
            '    location /outside-api/ { proxy_pass http://127.0.0.1:3003; }\n',
            '    location ~ ^/api/private/ { proxy_pass http://127.0.0.1:3003; }\n',
            '    location /api/private/ { if ($arg_ok) { proxy_pass http://127.0.0.1:3003; } }\n',
            '    location /api/private/ { proxy_pass http://127.0.0.1:3003; limit_except GET { deny all; } }\n',
            '    location @application { proxy_pass http://127.0.0.1:3003; }\n',
            '    location /api/private/ { proxy_pass http://127.0.0.1:3003; proxy_pass http://127.0.0.1:4010; }\n',
        ]
        for extra in extras:
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(ValueError, 'main API|nested|unreviewed'):
                    maintenance.prepare(fixture(extra), 3003)

    def test_refuses_opaque_api_upstreams_and_hidden_gallery_directives(self):
        extras = [
            '    location /api/private/ { proxy_pass http://application_pool; }\n',
            '    location ~ ^/api/private/ { proxy_pass $application; }\n',
        ]
        for extra in extras:
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, 'upstream|unreviewed'):
                maintenance.prepare(fixture(extra), 3003)
        config = fixture().replace('proxy_set_header Cookie "";', 'include /etc/nginx/snippets/other.conf;')
        with self.assertRaisesRegex(ValueError, 'gallery|sidecar'):
            maintenance.prepare(config, 3003)

    def test_refuses_includes_rewrites_or_error_handlers_that_could_escape_the_barrier(self):
        extras = [
            '    include /etc/nginx/snippets/other-locations.conf;\n',
            '    error_page 503 = @fallback;\n',
            '    rewrite ^/api/(.*)$ /creative/$1 last;\n',
            '    location /api/private/ { include /etc/nginx/snippets/upstream.conf; }\n',
            '    location /api/private/ { rewrite ^ /api/creative/ last; }\n',
        ]
        for extra in extras:
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(ValueError, 'include|rewrite|error_page'):
                    maintenance.prepare(fixture(extra), 3003)

    def test_refuses_a_missing_or_non_main_catchall_and_invalid_ports(self):
        config = fixture().replace('location /api/ {\n        proxy_pass http://127.0.0.1:3003;', 'location /api/ {\n        proxy_pass http://127.0.0.1:4010;', 1)
        with self.assertRaisesRegex(ValueError, 'catchall'):
            maintenance.prepare(config, 3003)
        for port in [0, 80, 3014, 65536, '3003', True]:
            with self.subTest(port=port):
                with self.assertRaises(ValueError):
                    maintenance.prepare(fixture(), port)

    def test_refuses_ambiguous_target_servers_and_malformed_syntax(self):
        for config in [fixture() + fixture(), fixture()[:-2], fixture().replace('proxy_set_header Host $host;', 'proxy_set_header Host "unterminated;', 1)]:
            with self.subTest(config=config):
                with self.assertRaises(ValueError):
                    maintenance.prepare(config, 3003)

    @unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('nginx'), 'requires an isolated Linux Nginx executable')
    def test_real_nginx_returns_503_for_get_post_and_websocket_upgrade(self):
        with tempfile.TemporaryDirectory(prefix='helstera-maintenance-') as folder, socket.socket() as unused_api:
            directory = Path(folder)
            directory.chmod(0o755)
            (directory / 'index.html').write_text('static application')
            (directory / 'index.html').chmod(0o644)
            unused_api.bind(('127.0.0.1', 0))
            api_port = unused_api.getsockname()[1]
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            config = (f'pid {directory}/nginx.pid;\nerror_log {directory}/error.log;\n'
                      'events {}\nhttp {\naccess_log off;\nserver {\n'
                      f'listen 127.0.0.1:{port};\nroot {directory};\n' + GALLERY
                      + f'location = /api/assets/private-video {{ proxy_pass http://127.0.0.1:{api_port}; }}\n'
                      + f'location /api/website-capture/assistant/ws {{ proxy_pass http://127.0.0.1:{api_port}; }}\n'
                      + f'location /api/ {{ proxy_pass http://127.0.0.1:{api_port}; }}\n'
                      + 'location / { try_files $uri $uri/ =404; }\n}\n}\n')
            prepared = maintenance.prepare(config, api_port)
            self.assertIn(GALLERY, prepared)
            path = directory / 'nginx.conf'
            path.write_text(prepared)
            command = ['nginx', '-p', folder + '/', '-c', str(path)]
            subprocess.run(command + ['-t'], check=True, capture_output=True, timeout=10)
            process = subprocess.Popen(command + ['-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                deadline = time.monotonic() + 5
                while True:
                    try:
                        response = opener.open(f'http://127.0.0.1:{port}/index.html', timeout=1)
                        with response:
                            self.assertEqual(response.read(), b'static application')
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            self.fail('Isolated Nginx failed to become ready')
                        time.sleep(0.05)
                for method, target, headers in [
                    ('GET', '/api', {}), ('GET', '/api/jobs', {}),
                    ('POST', '/api/jobs', {}), ('POST', '/api/assets/private-video', {}),
                    ('GET', '/api/ws', {'Connection': 'Upgrade', 'Upgrade': 'websocket'}),
                    ('GET', '/api/website-capture/assistant/ws', {'Connection': 'Upgrade', 'Upgrade': 'websocket'}),
                ]:
                    with self.subTest(method=method, target=target):
                        request = urllib.request.Request(f'http://127.0.0.1:{port}{target}', method=method, headers=headers)
                        with self.assertRaises(urllib.error.HTTPError) as rejected:
                            opener.open(request, timeout=2)
                        with rejected.exception as response:
                            self.assertEqual(response.code, 503)
                            self.assertEqual(response.headers['Retry-After'], '30')
                            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            finally:
                subprocess.run(command + ['-s', 'quit'], check=False, capture_output=True, timeout=5)
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
