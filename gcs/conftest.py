"""pytest bootstrap: make ``vtolgcs`` and ``gcs/tools`` importable without installing the package.

Works for ``python -m pytest gcs`` (and ``gcs protocol``) from the repository root.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
for _path in (_HERE, os.path.join(_HERE, "tools")):
    if _path not in sys.path:
        sys.path.insert(0, _path)
