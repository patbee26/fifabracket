"""Tiny stdlib HTTP layer (urllib) + a simple on-disk cache for big downloads.

No `requests` dependency, so Phase 0 runs clean on a bare Python.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from . import config


def _request(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = None):
    hdrs = {"User-Agent": config.USER_AGENT}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    return urllib.request.urlopen(req, timeout=timeout or config.HTTP_TIMEOUT)


def get_text(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = None) -> str:
    with _request(url, headers, timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def get_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = None) -> Any:
    return json.loads(get_text(url, headers, timeout))


def head_ok(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 10) -> bool:
    """Cheap availability probe — True iff the URL returns 2xx within `timeout`."""
    try:
        with _request(url, headers, timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False


def cached_download(url: str, dest: Path, max_age_hours: float = 12.0, refresh: bool = False) -> Path:
    """Download `url` to `dest`, reusing a fresh-enough local copy when possible.

    martj42's results.csv is ~5 MB; no point pulling it on every run.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not refresh:
        age_hours = (time.time() - dest.stat().st_mtime) / 3600.0
        if age_hours < max_age_hours:
            return dest
    text = get_text(url)
    dest.write_text(text, encoding="utf-8")
    return dest
