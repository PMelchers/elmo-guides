"""Builds index.json for the Elmo tool guide marketplace.

Runs in GitHub Actions after every change in guides/. It reads each guide file and writes a small
summary per guide, so the app only has to download index.json to show the marketplace.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUIDES = os.path.join(ROOT, 'guides')
MAX_BYTES = 15 * 1024 * 1024  # larger files are skipped (they would be slow to download)


def git(*args):
    try:
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ''


def text(value, limit):
    return str(value or '').strip()[:limit]


def main():
    entries, problems = [], []
    for name in sorted(os.listdir(GUIDES)) if os.path.isdir(GUIDES) else []:
        if not name.lower().endswith('.json'):
            continue
        path = os.path.join(GUIDES, name)
        size = os.path.getsize(path)
        if size > MAX_BYTES:
            problems.append(f'{name}: larger than 15 MB, skipped')
            continue
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:  # not valid JSON
            problems.append(f'{name}: {e}')
            continue
        guides = data if isinstance(data, list) else [data]
        for i, g in enumerate(guides):
            if not isinstance(g, dict) or not isinstance(g.get('focus'), list):
                problems.append(f'{name}: entry {i} is not an Elmo tool guide')
                continue
            author = text(g.get('author'), 60) or git('log', '-1', '--format=%an', '--', f'guides/{name}') or 'unknown'
            updated = git('log', '-1', '--format=%cI', '--', f'guides/{name}') or datetime.now(timezone.utc).isoformat()
            entries.append({
                'file': f'guides/{name}',
                'index': i,
                'title': text(g.get('title'), 120) or name,
                'tag': text(g.get('tag'), 8).upper(),
                'summary': text(g.get('summary'), 300),
                'author': text(author, 60),
                'updated': updated,
                'size': size,
                'counts': {
                    'focus': sum(1 for s in g.get('focus', []) if isinstance(s, dict) and s.get('type') == 'focus'),
                    'tanks': len(g.get('tanks') or []),
                    'ships': len(g.get('ships') or []),
                    'templates': len(g.get('templates') or []),
                    'images': len(g.get('images') or []),
                    'text': len(g.get('text') or []),
                },
            })
    entries.sort(key=lambda e: e['updated'], reverse=True)
    out = {'version': 1, 'generated': datetime.now(timezone.utc).isoformat(), 'guides': entries}
    with open(os.path.join(ROOT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'{len(entries)} guides in index.json')
    for p in problems:
        print('warning:', p, file=sys.stderr)


if __name__ == '__main__':
    main()
