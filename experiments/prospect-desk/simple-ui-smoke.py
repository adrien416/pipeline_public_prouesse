"""Compatibility entry point: the per-message UI has been replaced by batch review.
Run the current campaign UI checks instead of asserting obsolete button labels.
"""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('batch-ui-smoke.py')), run_name='__main__')
