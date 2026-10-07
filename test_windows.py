"""Windows contracts plus native process/lock checks when run on Windows."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import build
import setup
import updater


class WindowsTests(unittest.TestCase):
    def test_process_detection_and_failure(self):
        with patch('updater.sys.platform', 'win32'), patch('updater.subprocess.run') as run:
            run.return_value.stdout = '"THUNDERBIRD.EXE","42","Console","1","123 K"\r\n'
            self.assertTrue(updater.running())
            run.return_value.stdout = 'INFO: No tasks are running which match the specified criteria.\r\n'
            self.assertFalse(updater.running())
            run.side_effect = subprocess.CalledProcessError(1, ['tasklist'])
            with self.assertRaises(subprocess.CalledProcessError):
                updater.running()

    def test_appdata_profiles_and_local_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = root / 'Roaming/Thunderbird'
            base.mkdir(parents=True)
            (base / 'profiles.ini').write_text(
                '[Profile0]\nPath=Profiles/example.default\nIsRelative=1\n', encoding='utf-8-sig')
            with patch('updater.sys.platform', 'win32'), patch.dict(os.environ, {
                    'APPDATA': str(root / 'Roaming'), 'LOCALAPPDATA': str(root / 'Local')}):
                self.assertEqual(updater.discover_profiles(), [base / 'Profiles/example.default'])
                self.assertEqual(setup.locations(), (root / 'Local/Fede Modern',) * 3)

    def test_task_handles_spaces_ampersands_and_uses_current_user(self):
        runtime = Path('C:/Users/Fede & Test/AppData/Local/Fede Modern')
        config = runtime / 'config.json'
        task = ET.fromstring(setup.windows_task(runtime, config, 'ZENBOOK\\fede'))
        ns = {'t': 'http://schemas.microsoft.com/windows/2004/02/mit/task'}
        self.assertEqual(task.findtext('.//t:Interval', namespaces=ns), 'PT15M')
        self.assertEqual(task.findtext('.//t:UserId', namespaces=ns), 'ZENBOOK\\fede')
        self.assertEqual(task.findtext('.//t:LogonType', namespaces=ns), 'InteractiveToken')
        self.assertEqual(task.findtext('.//t:RunLevel', namespaces=ns), 'LeastPrivilege')
        self.assertEqual(task.findtext('.//t:Arguments', namespaces=ns), subprocess.list2cmdline(
            [str(runtime / 'updater.py'), 'sync', '--config', str(config)]))
        self.assertNotIn('Password', ET.tostring(task, encoding='unicode'))

    def test_binary_preferences_preserved_and_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = root / 'profile'
            profile.mkdir()
            (profile / 'prefs.js').write_bytes(b'// personal\r\n')
            (profile / 'compatibility.ini').write_text('[Compatibility]\nLastVersion=157.0\n')
            original = '// Preferenze citta: Udine\r\nuser_pref("local.path", "C:\\\\Utenti");\r\n'.encode()
            (profile / 'user.js').write_bytes(original)
            archive = build.build('1.0.12', root / 'releases')
            with patch('updater.running', return_value=False):
                result = updater.install(archive, profile)
                self.assertTrue((profile / 'user.js').read_bytes().startswith(original))
                updater.rollback(profile, result['backup'])
            self.assertEqual((profile / 'user.js').read_bytes(), original)

    def test_lock_excludes_second_writer_and_releases_on_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'update.lock'
            with updater.profile_lock(path):
                with self.assertRaises(OSError):
                    with updater.profile_lock(path):
                        self.fail('Second writer acquired the lock')
            with updater.profile_lock(path):
                pass

    @unittest.skipUnless(sys.platform == 'win32', 'Native Windows check')
    def test_native_tasklist(self):
        self.assertIsInstance(updater.running(), bool)

    @unittest.skipUnless(sys.platform == 'win32', 'Native Windows check')
    def test_native_local_download_accepts_drive_letter(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'channel.json'
            source.write_bytes(b'{"version":"1.0.11"}')
            self.assertEqual(updater.fetch(str(source)), source.read_bytes())


if __name__ == '__main__':
    unittest.main()
