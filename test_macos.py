"""Linux-run contract checks; not a substitute for native macOS UI testing."""
import json
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import setup
import updater


class MacContractTests(unittest.TestCase):
    def test_locations_and_launch_agent(self):
        with patch('setup.sys.platform', 'darwin'), patch('setup.Path.home', return_value=Path('/Users/test')):
            config, runtime, units = setup.locations()
            self.assertEqual(config, runtime)
            self.assertEqual(units, Path('/Users/test/Library/LaunchAgents'))
            agent = plistlib.loads(setup.launch_agent(runtime, config / 'config.json'))
            self.assertEqual(agent['StartInterval'], 900)
            self.assertEqual(agent['ProgramArguments'], [sys.executable, str(runtime / 'updater.py'), 'sync', '--config', str(config / 'config.json')])
            self.assertNotIn('sh', agent['ProgramArguments'])

    def test_process_guard_is_case_insensitive(self):
        with patch('updater.subprocess.run') as run:
            run.return_value.returncode = 0
            self.assertTrue(updater.running())
            self.assertEqual(run.call_args.args[0], ['pgrep', '-ix', 'thunderbird'])

    def test_mac_profile_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / 'Library/Thunderbird'
            base.mkdir(parents=True)
            (base / 'profiles.ini').write_text('[Profile0]\nPath=Profiles/demo.default\nIsRelative=1\n')
            with patch('updater.Path.home', return_value=Path(directory)), patch('sys.argv', ['updater.py', 'profiles']), patch('builtins.print') as output:
                self.assertEqual(updater.main(), 0)
                self.assertEqual(json.loads(output.call_args.args[0]), [str(base / 'Profiles/demo.default')])


if __name__ == '__main__':
    unittest.main()
