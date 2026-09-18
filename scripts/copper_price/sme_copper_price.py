"""Read the public SME Information Network copper average price."""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup


SOURCE_URL = "https://info.smechina.com.cn/"
HEADERS = {
    "Accept": "text/html",
    "User-Agent": "SME-Copper-Price-Client/1.0 (+https://info.smechina.com.cn/)",
}
TIMEOUT_SECONDS = (5, 15)


class SourceChangedError(Exception):
    """Raised when the expected public quotation structure is unavailable."""


class HttpStatusError(Exception):
    """Raised when the source responds with a non-successful HTTP status."""


def parse_copper_price(html: str) -> int:
    """Return the copper row's average price from SME homepage HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for row in soup.select("ul#n_1 > li"):
        product = next(
            (link for link in row.select("a") if link.get_text(strip=True) == "铜"),
            None,
        )
        if product is None:
            continue

        values = row.select("span.s2")
        if len(values) < 3:
            raise SourceChangedError("copper average price field is missing")

        normalized = values[2].get_text(strip=True).replace(",", "")
        if not normalized.isdigit() or int(normalized) <= 0:
            raise SourceChangedError("copper average price is invalid")
        return int(normalized)

    raise SourceChangedError("copper quotation row was not found")


def fetch_html(session: requests.Session) -> str:
    """Fetch the source HTML with one retry for transient source failures."""
    for attempt in range(2):
        response = session.get(SOURCE_URL, headers=HEADERS, timeout=TIMEOUT_SECONDS)
        if response.status_code >= 500 and attempt == 0:
            time.sleep(0.5)
            continue
        if not 200 <= response.status_code < 300:
            raise HttpStatusError(f"source returned HTTP {response.status_code}")
        return response.text
    raise HttpStatusError("source returned HTTP 5xx after retry")


def shanghai_now() -> datetime:
    """Return the current time in the source's operating timezone."""
    return datetime.now(ZoneInfo("Asia/Shanghai"))


def build_success_response(price: int, now: datetime) -> dict[str, object]:
    """Create the stable JSON-compatible response contract."""
    return {
        "price": price,
        "unit": "元/吨",
        "product": "铜",
        "price_date": now.date().isoformat(),
        "source": "SME信息网",
        "fetched_at": now.isoformat(timespec="seconds"),
    }


def emit_error(code: str, message: str) -> int:
    """Write a single machine-readable error object and return the failure code."""
    payload = {"error": {"code": code, "message": message}}
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
    return 2


def main() -> int:
    """Run the command-line workflow."""
    try:
        html = fetch_html(requests.Session())
        price = parse_copper_price(html)
        print(json.dumps(build_success_response(price, shanghai_now()), ensure_ascii=False))
        return 0
    except SourceChangedError as error:
        return emit_error("SOURCE_CHANGED", str(error))
    except HttpStatusError as error:
        return emit_error("HTTP_ERROR", str(error))
    except requests.RequestException as error:
        return emit_error("NETWORK_ERROR", str(error))
    except Exception:
        return emit_error("UNEXPECTED_ERROR", "unexpected failure while reading copper price")


if __name__ == "__main__":
    raise SystemExit(main())
