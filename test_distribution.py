import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import build
import build_kit
import setup
import updater


class DistributionTests(unittest.TestCase):
    def test_public_kits_select_shared_https_channel(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            build.build('1.0.8', base / 'releases')
            build_kit.build_kits(base / 'kits', repository='example/fede-modern', release_dir=base / 'releases')
            for platform in ['linux', 'mac-beta']:
                archive = base / 'kits' / f'fede-modern-{platform}-1.0.8.zip'
                with zipfile.ZipFile(archive) as zipped:
                    names = zipped.namelist()
                    self.assertFalse(any(name.endswith(('prefs.js', 'logins.json', 'key4.db', '.otf')) for name in names))
                    kit_channel = zipped.read('fede-modern-1.0.8/update-channel.txt').decode().strip()
                    self.assertEqual(kit_channel, 'https://github.com/example/fede-modern/releases/latest/download/stable.json')
                    extraction = base / platform
                    zipped.extractall(extraction)
                with patch('setup.ROOT', extraction / 'fede-modern-1.0.8'):
                    self.assertEqual(setup.default_channel(), kit_channel)

    def test_https_release_moves_devices_to_new_version_only_after_close(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            profile = base / 'profile'
            profile.mkdir()
            (profile / 'prefs.js').write_text('// personal preferences\n')
            (profile / 'compatibility.ini').write_text('[Compatibility]\nLastVersion=157.0.1\n')
            before = build.build('1.0.7', base / 'old')
            new = build.build('1.0.8', base / 'new')
            source = 'https://github.com/example/fede-modern/releases/latest/download/stable.json'
            config = base / 'config.json'
            config.write_text(json.dumps({'profile':str(profile), 'channel':source}))
            with patch('updater.running', return_value=False):
                updater.install(before, profile)
            responses = {source:(new.parent / 'stable.json').read_bytes(), source.rsplit('/',1)[0] + '/' + new.name:new.read_bytes()}
            with patch('updater.fetch', side_effect=responses.__getitem__), patch('updater.running', return_value=True):
                self.assertEqual(updater.sync(config)['status'], 'deferred')
                self.assertEqual(json.loads((profile / updater.STATE).read_text())['version'], '1.0.7')
            with patch('updater.fetch', side_effect=responses.__getitem__), patch('updater.running', return_value=False):
                result = updater.sync(config)
                self.assertEqual(result['status'], 'installed')
                self.assertEqual(result['version'], '1.0.8')
                self.assertEqual(updater.sync(config)['status'], 'current')
                self.assertEqual((profile / 'prefs.js').read_text(), '// personal preferences\n')


if __name__ == '__main__':
    unittest.main()
