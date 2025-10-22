import pytest

from nextcloud.utils import valid_url


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://example.com/path",
        "https://example.com:8080/",
    ],
)
def test_valid_url_accepts_http_urls(url):
    assert valid_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "",
        "not a url",
        "ftp://example.com",
        "javascript:alert('xss')",
        "//missing-scheme.com",
        "https://",
        None,
    ],
)
def test_valid_url_rejects_invalid_urls(url):
    assert valid_url(url) is False
