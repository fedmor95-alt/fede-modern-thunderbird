#!/usr/bin/env python3
"""Build the existing theme add-on with the lightweight calendar integration."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parent
CALENDAR = ROOT / 'calendar-assist'
THEME = ROOT / 'day-night-addon'


def build(destination):
    parser = (CALENDAR / 'parse-title.mjs').read_text()
    marker = 'export function parseTitle'
    if parser.count(marker) != 1:
        raise ValueError('Esportazione del parser non valida')
    experiment = parser.replace(marker, 'function parseTitle') + '\n' + (CALENDAR / 'experiment.js').read_text()
    manifest = json.loads((THEME / 'manifest.json').read_text())
    json.loads((CALENDAR / 'schema.json').read_text())
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        def add(name, data):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)

        for path in sorted(p for p in THEME.rglob('*') if p.is_file()):
            add(path.relative_to(THEME).as_posix(), path.read_bytes())
        add('calendar-assist/schema.json', (CALENDAR / 'schema.json').read_bytes())
        add('calendar-assist/experiment.js', experiment)
    return manifest['version']


if __name__ == '__main__':
    print(build(ROOT / 'payload/extensions/fede-day-night@local.xpi'))
