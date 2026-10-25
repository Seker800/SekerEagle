"""Restore the owned, persistent native preview using normal Android UI actions."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / '.local/android-lab'
SDK = Path.home() / '.local/android-sdk'
PACKAGE = 'com.sekereagle.android.debug'


def command(args):
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Native preview command failed')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path)
    args = parser.parse_args()
    login = json.loads((DIRECTORY / 'login.json').read_text())
    assert login['origin'] == 'http://localhost:49813'
    assert login['email'] == 'tester@sekereagle.local'
    assert re.fullmatch(r'[a-f0-9]{48}', login['password'])
    with urllib.request.urlopen(login['origin'] + '/__lab/status', timeout=5) as response:
        assert json.load(response)['kind'] == 'sekereagle-android-lab-v1'
    adb = str(SDK / 'platform-tools/adb')
    devices = command([adb, 'devices']).decode().strip().splitlines()[1:]
    assert len(devices) == 1 and re.fullmatch(r'emulator-\d+\s+device', devices[0].strip())
    base = [adb, '-s', devices[0].split()[0]]
    built_apk = ROOT / 'apps/android/app/build/outputs/apk/debug/app-debug.apk'
    cached_apk = DIRECTORY / 'preview.apk'
    apk = args.apk or (built_apk if built_apk.exists() else cached_apk)
    aapt = sorted((SDK / 'build-tools').glob('*/aapt'))[-1]
    badging = command([str(aapt), 'dump', 'badging', str(apk)]).decode().splitlines()[0]
    assert f"name='{PACKAGE}'" in badging
    command(base + ['reverse', 'tcp:49813', 'tcp:49813'])
    command(base + ['install', '-r', str(apk)])
    if apk.resolve() != cached_apk.resolve():
        shutil.copyfile(apk, cached_apk)
        cached_apk.chmod(0o600)
    command(base + ['shell', 'am', 'force-stop', PACKAGE])
    command(base + ['shell', 'am', 'start', '-n', PACKAGE + '/com.sekereagle.android.NativeActivity'])

    def ui():
        command(base + ['shell', 'uiautomator', 'dump', '/sdcard/android-lab-ui.xml'])
        try:
            return ET.fromstring(command(base + ['exec-out', 'cat', '/sdcard/android-lab-ui.xml']))
        finally:
            command(base + ['shell', 'rm', '-f', '/sdcard/android-lab-ui.xml'])

    def tap(node):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        command(base + ['shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2)])

    def find(tree, text, desc=False):
        return next(n for n in tree.iter('node') if n.get('content-desc' if desc else 'text') == text)

    for _ in range(12):
        tree = ui()
        fields = [n for n in tree.iter('node') if n.get('class') == 'android.widget.EditText']
        if len(fields) == 3:
            break
        more = next((n for n in tree.iter('node') if n.get('content-desc') == '更多操作'), None)
        if more is not None:
            tap(more)
            tap(find(ui(), '账号与连接'))
            account = ui()
            texts = {n.get('text') for n in account.iter('node')}
            if login['origin'] in texts and login['email'] in texts:
                command(base + ['shell', 'input', 'keyevent', '4'])
                print('Persistent test account and library retained in the emulator.')
                return
            tap(find(account, '退出登录'))
        time.sleep(.3)
    else:
        raise RuntimeError('Native preview did not reach the normal login flow')
    for index, key in enumerate(['origin', 'email', 'password']):
        field = [n for n in ui().iter('node') if n.get('class') == 'android.widget.EditText'][index]
        tap(field)
        command(base + ['shell', 'input', 'keyevent', '123'])
        if field.get('text'):
            command(base + ['shell', 'input', 'keyevent'] + ['67'] * len(field.get('text')))
        assert re.fullmatch(r'[A-Za-z0-9@.:/_+\-]+', login[key])
        command(base + ['shell', 'input', 'text', login[key]])
        command(base + ['shell', 'input', 'keyevent', '4'])
    tap(find(ui(), '登录'))
    for _ in range(12):
        tree = ui()
        if any(n.get('content-desc') == '更多操作' for n in tree.iter('node')):
            print('Emulator connected to the fixed persistent test library.')
            return
        time.sleep(.3)
    raise RuntimeError('Native preview login did not finish')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, RuntimeError, OSError, ValueError, StopIteration, ET.ParseError):
        print('Could not restore the persistent emulator preview. Check the lab service and connect exactly one emulator.', file=sys.stderr)
        sys.exit(1)
