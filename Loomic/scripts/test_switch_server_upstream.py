import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('switcher', pathlib.Path(__file__).with_name('switch-server-upstream.py'))
switcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(switcher)

class UpstreamTests(unittest.TestCase):
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
