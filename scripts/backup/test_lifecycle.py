"""Regression tests: all subprocesses and remote writes are isolated mocks."""
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from test_backup import backup
from test_plain_nas import PlainNasTests, nas


class LifecycleTests(unittest.TestCase):
    def test_ssh_checks_host_keys_and_forbids_proxies(self):
        good = 'hostname 192.168.31.146\nuser seker\nport 22\nstricthostkeychecking true\n'
        backup.assert_ssh_target(good)
        for suffix in ['proxycommand nc elsewhere 22\n', 'proxyjump elsewhere\n']:
            with self.assertRaises(ValueError):
                backup.assert_ssh_target(good + suffix)
        for value in ['no', 'accept-new']:
            with self.assertRaises(ValueError):
                backup.assert_ssh_target(good.replace('true', value))
        with patch.object(backup, 'run', return_value=Mock(stdout=b'ok')) as run:
            backup.ssh('hostname')
            self.assertIn('StrictHostKeyChecking=yes', run.call_args.args[0])

    def test_owned_restore_container_removed_but_foreign_one_untouched(self):
        for owned in [True, False]:
            container = {'Id': 'container-id', 'Config': {'Labels': {
                'com.sekereagle.backup.role': 'restore' if owned else 'foreign'
            }}}
            with patch.object(backup, 'run', return_value=Mock(returncode=0, stdout=json.dumps([container]).encode())) as run:
                if owned:
                    backup.cleanup_restore_container()
                    self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', '-v', 'container-id'])
                else:
                    with self.assertRaises(ValueError):
                        backup.cleanup_restore_container()
                    self.assertEqual(run.call_count, 1)

    def test_docker_run_timeout_still_cleans_restore_container(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'deployment.json').write_text(json.dumps({'images': {'api': {'id': 'api'}, 'postgres': {'id': 'postgres'}}}))
            def run(args, **kwargs):
                if '--name' in args:
                    raise subprocess.TimeoutExpired('docker', 120)
                return Mock(returncode=0)
            with patch.object(backup, 'run', side_effect=run), patch.object(backup, 'cleanup_restore_container') as cleanup:
                with self.assertRaises(subprocess.TimeoutExpired):
                    backup.restore_database_check(root)
                self.assertEqual(cleanup.call_count, 2)
                self.assertFalse((root / 'postgres.env').exists())

    def test_prune_failure_does_not_undo_durably_published_success(self):
        state = {'nextScheduledAt': '2026-10-23T17:00:00Z'}
        persisted = []
        def remote(command, generation=None):
            if command == 'prune':
                self.assertEqual(persisted[-1]['status'], 'succeeded')
                raise RuntimeError('connection lost')
            return b'{"objects":1,"bytes":12}'
        def resume(value):
            value['pausedServices'] = []
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(backup, 'PRIVATE', Path(directory)), \
             patch.object(backup, 'INPUT', Path(directory) / 'input'), \
             patch.object(backup, 'load_state', return_value=state), \
             patch.object(backup, 'save_state', side_effect=lambda s: persisted.append(dict(s))), \
             patch.object(backup, 'preflight', return_value={}), \
             patch.object(backup, 'prepare_input', return_value={'frozenAt': 'now'}), \
             patch.object(backup, 'restore_services', side_effect=resume), \
             patch.object(backup, 'restore_database_check', return_value={'assets': 1}), \
             patch.object(backup, 'cleanup_restore_container'), \
             patch.object(backup, 'transfer_archive'), \
             patch.object(backup, 'remote', side_effect=remote), \
             patch.object(backup, 'run'), \
             patch.object(backup.os, 'getpgrp', return_value=123), \
             patch.object(backup.os, 'getpid', return_value=123):
            backup.backup()
        self.assertEqual(persisted[-1]['status'], 'succeeded')
        self.assertTrue(persisted[-1]['cleanupPending'])
        self.assertIn('lastSuccessAt', persisted[-1])

    def test_recovery_discards_only_recorded_attempt_and_cleans_restore(self):
        state = {'attemptGeneration': 'a' * 32}
        with patch.object(backup, 'run'), patch.object(backup, 'cleanup_restore_container') as cleanup, patch.object(backup, 'remote', return_value=b'{}') as remote, patch.object(backup, 'save_state'):
            backup.recover(state)
        cleanup.assert_called_once()
        remote.assert_called_once_with('discard', 'a' * 32)
        self.assertNotIn('attemptGeneration', state)


class PartialGenerationTests(PlainNasTests):
    def test_receive_failure_removes_new_directory_only(self):
        with self.assertRaises(ValueError):
            nas.receive(self.root, self.generation, self.fixture(damage=True))
        path = self.root / 'generations' / self.generation
        self.assertFalse(path.exists())
        path.mkdir()
        (path / 'precious').write_text('keep')
        with self.assertRaises(FileExistsError):
            nas.receive(self.root, self.generation, self.fixture())
        self.assertEqual((path / 'precious').read_text(), 'keep')

    def test_discard_cleans_interrupted_generation_and_refuses_current_or_unknown(self):
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        with self.assertRaises(ValueError):
            nas.discard(self.root, self.generation)
        other = 'b' * 32
        nas.receive(self.root, other, self.fixture())
        nas.discard(self.root, other)
        nas.discard(self.root, other)
        path = self.root / 'generations' / other
        path.mkdir()
        with self.assertRaises(ValueError):
            nas.discard(self.root, other)
        self.assertTrue(path.exists())

    def test_unknown_entries_quarantined_without_following_links(self):
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        outside = self.root / 'precious'
        outside.mkdir()
        (outside / 'keep').write_text('keep')
        (self.root / 'generations' / 'unknown-link').symlink_to(outside)
        result = nas.prune(self.root)
        self.assertEqual(result['quarantined'], 1)
        self.assertEqual((outside / 'keep').read_text(), 'keep')
        self.assertEqual(len(list((self.root / 'quarantine').iterdir())), 1)
