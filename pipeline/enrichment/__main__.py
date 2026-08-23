"""`python -m enrichment` — same entry point as the installed `enrichment` script."""

import sys

from .cli import main

sys.exit(main())
