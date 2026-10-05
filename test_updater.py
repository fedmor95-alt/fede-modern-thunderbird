import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import updater
import build


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fede-modern-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.profile = self.base / 'profile'
        self.profile.mkdir()
        (self.profile / 'prefs.js').write_text('// untouched user settings\n')
        (self.profile / 'compatibility.ini').write_text('[Compatibility]\nLastVersion=156.0_123/123\n')
        (self.profile / 'user.js').write_text('user_pref("personal.setting", true);\n')
        (self.profile / 'Mail').mkdir()
        (self.profile / 'Mail' / 'Inbox').write_bytes(b'private messages')
        self.archive = build.build('1.0.6', self.base / 'release')
        self.patcher = patch('updater.running', return_value=False)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_install_repeat_and_rollback(self):
        original = (self.profile / 'user.js').read_bytes()
        result = updater.install(self.archive, self.profile)
        self.assertEqual(result['status'], 'installed')
        self.assertEqual(updater.install(self.archive, self.profile)['status'], 'current')
        self.assertIn('personal.setting', (self.profile / 'user.js').read_text())
        self.assertEqual((self.profile / 'Mail/Inbox').read_bytes(), b'private messages')
        updater.rollback(self.profile, result['backup'])
        self.assertEqual((self.profile / 'user.js').read_bytes(), original)
        self.assertFalse((self.profile / updater.STATE).exists())
        self.assertFalse((self.profile / 'chrome/userChrome.css').exists())

    def test_open_app_defers_without_profile_changes(self):
        before = set(self.profile.rglob('*'))
        with patch('updater.running', return_value=True):
            self.assertEqual(updater.install(self.archive, self.profile)['status'], 'deferred')
        self.assertEqual(set(self.profile.rglob('*')), before)

    def test_unknown_version_fails_closed(self):
        (self.profile / 'compatibility.ini').write_text('[Compatibility]\nLastVersion=140.0\n')
        with self.assertRaisesRegex(ValueError, 'non verificato'):
            updater.install(self.archive, self.profile)

    def test_first_existing_css_requires_explicit_adoption(self):
        (self.profile / 'chrome').mkdir()
        (self.profile / 'chrome/userChrome.css').write_text('/* custom */')
        with self.assertRaisesRegex(ValueError, 'non gestito'):
            updater.install(self.archive, self.profile)
        result = updater.install(self.archive, self.profile, adopt=True)
        updater.rollback(self.profile, result['backup'])
        self.assertEqual((self.profile / 'chrome/userChrome.css').read_text(), '/* custom */')

    def test_modified_managed_file_is_preserved(self):
        updater.install(self.archive, self.profile)
        (self.profile / 'chrome/interface-refinements.css').write_text('/* manual edit */')
        with self.assertRaisesRegex(ValueError, 'modificato'):
            updater.install(self.archive, self.profile)

    def test_rollback_preserves_later_user_changes(self):
        result = updater.install(self.archive, self.profile)
        (self.profile / 'user.js').write_text('new user preference')
        with self.assertRaisesRegex(ValueError, 'successiva'):
            updater.rollback(self.profile, result['backup'])

    def test_directory_symlink_rejected(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (self.profile / 'chrome').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Link simbolico'):
            updater.install(self.archive, self.profile)

    def test_profile_below_system_directory_alias_is_supported(self):
        alias = self.base / 'system-alias'
        alias.symlink_to(self.base, target_is_directory=True)
        target = updater.safe_target(alias / 'profile', 'chrome/userChrome.css')
        self.assertEqual(target, self.profile.resolve() / 'chrome/userChrome.css')

    def test_unknown_archive_entries_rejected(self):
        with zipfile.ZipFile(self.archive, 'a') as z:
            z.writestr('payload/../../prefs.js', 'bad')
        with self.assertRaisesRegex(ValueError, 'non consentito'):
            updater.install(self.archive, self.profile)

    def test_corruption_rejected(self):
        with zipfile.ZipFile(self.archive) as z:
            members = {name: z.read(name) for name in z.namelist()}
        members['payload/chrome/userChrome.css'] += b'corrupt'
        with zipfile.ZipFile(self.archive, 'w') as z:
            for name, data in members.items():
                z.writestr(name, data)
        with self.assertRaisesRegex(ValueError, 'Integrità'):
            updater.install(self.archive, self.profile)

    def test_local_channel(self):
        config = self.base / 'config.json'
        config.write_text(json.dumps({'profile': str(self.profile), 'channel': str(self.archive.parent / 'stable.json')}))
        self.assertEqual(updater.sync(config)['status'], 'installed')
        self.assertEqual(updater.sync(config)['status'], 'current')

    def test_bad_channel_digest_rejected(self):
        channel = self.archive.parent / 'stable.json'
        contents = json.loads(channel.read_text())
        contents['sha256'] = '0' * 64
        channel.write_text(json.dumps(contents))
        config = self.base / 'config.json'
        config.write_text(json.dumps({'profile': str(self.profile), 'channel': str(channel)}))
        with self.assertRaisesRegex(ValueError, 'Checksum'):
            updater.sync(config)

    def test_http_rejected(self):
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            updater.fetch('http://example.invalid/stable.json')

    def test_preview_changes_nothing(self):
        before = set(self.profile.rglob('*'))
        self.assertEqual(updater.install(self.archive, self.profile, dry_run=True)['status'], 'preview')
        self.assertEqual(set(self.profile.rglob('*')), before)

    def test_wrong_profile_rejected(self):
        with self.assertRaisesRegex(ValueError, 'profilo Thunderbird'):
            updater.install(self.archive, self.base)

    def test_initial_baseline_preserves_edits_before_first_install(self):
        config = self.base / 'config.json'
        config.write_text(json.dumps({'profile': str(self.profile),
            'channel': str(self.archive.parent / 'stable.json'),
            'adopt_initial': True, 'initial_files': {rel: None for rel in updater.ALLOWED}}))
        (self.profile / 'chrome').mkdir()
        (self.profile / 'chrome/userChrome.css').write_text('new personal CSS')
        with self.assertRaisesRegex(ValueError, 'dopo la preparazione'):
            updater.sync(config)

    def test_unsigned_unexpected_payload_never_extracted(self):
        with zipfile.ZipFile(self.archive) as z:
            self.assertFalse(any(name.endswith(('.otf', '.woff2')) for name in z.namelist()))
            self.assertEqual(set(z.namelist()), {'release.json'} | {'payload/' + rel for rel in updater.ALLOWED})


if __name__ == '__main__':
    unittest.main()
