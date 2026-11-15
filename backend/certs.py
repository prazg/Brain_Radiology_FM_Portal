"""Inject the operating system's TLS certificate store when `truststore` is installed.
Helpful on hospital / university networks that inspect HTTPS traffic to huggingface.co."""
from __future__ import annotations

ACTIVE = False
try:
    import truststore
    truststore.inject_into_ssl()
    ACTIVE = True
except Exception:
    pass
