"""Ensure private submissions actually contain the current training fixes."""
import ast
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'training' / 'kaggle'))
import launch


class SnapshotLaunch(unittest.TestCase):
    def test_snapshot_contains_only_training_source_and_compiles(self):
        pushed = []

        def run(cmd, **kwargs):
            if cmd[0] == 'git':
                self.assertEqual(cmd[1:], ['rev-parse', 'HEAD'])
                return SimpleNamespace(stdout='abc123\n')
            root = Path(cmd[cmd.index('-p') + 1])
            source = (root / 'run.py').read_text(encoding='utf-8')
            compile(source, 'run.py', 'exec')
            tree = ast.parse(source)
            snapshot = next(ast.literal_eval(n.value) for n in tree.body
                            if isinstance(n, ast.Assign) and any(
                                isinstance(t, ast.Name) and t.id == 'SNAPSHOT' for t in n.targets))
            self.assertIn('training/kaggle/runner.py', snapshot)
            self.assertIn('training/loop.py', snapshot)
            self.assertTrue(all(p.startswith('training/') and p.endswith('.py') for p in snapshot))
            for name, content in snapshot.items():
                self.assertEqual(content, (launch.HERE.resolve().parents[1] / name).read_text(encoding='utf-8'))
                compile(content, name, 'exec')
            self.assertEqual(json.loads((root / 'kernel-metadata.json').read_text())['is_private'], 'true')
            pushed.append(True)

        with patch.object(sys, 'argv', ['launch.py', '--local-snapshot', 'voice:test:--arch wavlm']), \
                patch.object(launch.subprocess, 'run', side_effect=run):
            launch.main()
        self.assertEqual(pushed, [True])
