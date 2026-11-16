import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('switcher', pathlib.Path(__file__).with_name('switch-server-upstream.py'))
switcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(switcher)

class UpstreamTests(unittest.TestCase):
    def test_waits_for_reload_to_expose_the_new_version(self):
        with patch.object(switcher, 'public_ready', side_effect=[RuntimeError('old version'), {'ok': True, 'version': 'new'}]) as probe, \
             patch.object(switcher.time, 'sleep'):
            self.assertEqual(switcher.wait_public('https://studio.test/api/health', 'new', stable_for=0)['version'], 'new')
            self.assertEqual(probe.call_count, 2)
        with patch.object(switcher, 'public_ready', side_effect=RuntimeError('old version')):
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                switcher.wait_public('https://studio.test/api/health', 'new', timeout=0)

    def test_transient_matching_worker_does_not_complete_reload(self):
        elapsed = [0.0]
        health = {'ok': True, 'version': 'new'}
        probes = [health, RuntimeError('old worker'), health, health, health, health]
        with patch.object(switcher, 'public_ready', side_effect=probes) as probe, \
             patch.object(switcher.time, 'monotonic', side_effect=lambda: elapsed[0]), \
             patch.object(switcher.time, 'sleep', side_effect=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds)):
            self.assertEqual(switcher.wait_public('https://studio.test/api/health', 'new', stable_for=0.25), health)
        self.assertEqual(probe.call_count, 6)

    def test_public_health_requires_candidate_version_and_avoids_cached_response(self):
        class Response:
            status = 200

            def __init__(self, payload):
                self.payload = json.dumps(payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return self.payload

        seen = []

        def open_url(request, timeout):
            seen.append((request, timeout))
            return Response({'ok': True, 'version': 'candidate'})

        health = switcher.public_ready('https://studio.test/api/health', 'candidate', open_url)
        self.assertEqual(health['version'], 'candidate')
        self.assertEqual(seen[0][0].get_header('Cache-control'), 'no-cache')
        self.assertEqual(seen[0][1], 15)

        with self.assertRaisesRegex(RuntimeError, 'candidate version'):
            switcher.public_ready(
                'https://studio.test/api/health',
                'candidate',
                lambda *_args, **_kwargs: Response({'ok': True, 'version': 'previous'}),
            )
        with self.assertRaisesRegex(ValueError, 'without embedded credentials'):
            switcher.public_ready('https://user:secret@studio.test/api/health', 'candidate', open_url)

    def test_failed_public_health_after_reload_restores_exact_original_config(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)/'site.conf'
            original = b'location /api { proxy_pass http://127.0.0.1:3000; }\n'
            path.write_bytes(original)
            calls = []
            def execute(command, **kwargs):
                calls.append(command)
            with patch.object(switcher, 'ready', return_value={'ok': True}), \
                 patch.object(switcher, 'wait_public', side_effect=RuntimeError('public route still serves old version')):
                with self.assertRaisesRegex(RuntimeError, 'public route still serves old version'):
                    switcher.switch(path, 3000, 3002, 'candidate', True, execute,
                                    public_url='https://studio.test/api/health')
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(calls, [['nginx', '-t'], ['nginx', '-s', 'reload'],
                                     ['nginx', '-t'], ['nginx', '-s', 'reload']])

    def test_failed_nginx_validation_restores_exact_original_config(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)/'site.conf'
            original = b'location /api { proxy_pass http://127.0.0.1:3000; }\n'
            path.write_bytes(original)
            calls = []
            def execute(command, **kwargs):
                calls.append(command)
                if len(calls) == 1: raise subprocess.CalledProcessError(1, command)
            with patch.object(switcher, 'ready', return_value={'ok':True}):
                with self.assertRaises(subprocess.CalledProcessError):
                    switcher.switch(path,3000,3002,'candidate',True,execute)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(calls[-1], ['nginx','-s','reload'])

    def test_failed_readiness_never_changes_live_config(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)/'site.conf'
            path.write_bytes(b'proxy_pass http://127.0.0.1:3000;')
            with patch.object(switcher, 'ready', side_effect=RuntimeError('database unavailable')):
                with self.assertRaises(RuntimeError): switcher.switch(path,3000,3002,'candidate',True)
            self.assertEqual(path.read_bytes(), b'proxy_pass http://127.0.0.1:3000;')

if __name__ == '__main__': unittest.main()
