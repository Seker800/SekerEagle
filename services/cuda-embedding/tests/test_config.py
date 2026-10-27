import os

import pytest

from sekereagle_cuda.config import private_bind, read_token, validate_acl


@pytest.mark.parametrize("address", ["0.0.0.0", "8.8.8.8", "169.254.1.2", "192.168.31.89", "::1", "host.example"])
def test_public_unspecified_or_protected_binds_fail(address):
    with pytest.raises(ValueError):
        private_bind(address)


def test_private_bind_and_token_permissions(tmp_path):
    assert private_bind("192.168.31.211") == "192.168.31.211"
    path = tmp_path / "token"
    path.write_text("isolated-test-token")
    path.chmod(0o600)
    assert read_token(path) == "isolated-test-token"
    if os.name != "nt":
        path.chmod(0o644)
        with pytest.raises(ValueError):
            read_token(path)
    link = tmp_path / "link"
    link.symlink_to(path)
    with pytest.raises(ValueError):
        read_token(link)


def test_windows_acl_requires_protected_current_owner():
    acl = dict(owner="current", current="current", protected=True, allow=["current", "S-1-5-18"])
    validate_acl(acl)
    for change in [dict(owner="other"), dict(protected=False), dict(allow=["S-1-1-0"]), dict(allow="current")]:
        with pytest.raises(ValueError):
            validate_acl({**acl, **change})
