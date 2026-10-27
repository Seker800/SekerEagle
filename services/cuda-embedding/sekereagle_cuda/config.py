import base64
import ipaddress
import json
import os
import stat
import subprocess
from pathlib import Path


def validate_acl(acl):
    if not isinstance(acl, dict) or not isinstance(acl.get("current"), str) or not acl["current"] or acl.get("owner") != acl["current"] or acl.get("protected") is not True:
        raise ValueError("private token ACL required")
    allowed = acl.get("allow")
    if not isinstance(allowed, list) or not allowed or any(sid not in (acl["current"], "S-1-5-18", "S-1-5-32-544") for sid in allowed):
        raise ValueError("private token ACL required")


def private_bind(value):
    address = ipaddress.IPv4Address(value)
    networks = ("127.0.0.0/8", "10.0.0.0/8", "192.168.0.0/16", "172.16.0.0/12")
    if str(address) == "192.168.31.89" or not any(address in ipaddress.IPv4Network(net) for net in networks):
        raise ValueError("private bind address required")
    return str(address)


def read_token(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("private token file required")
    if os.name == "nt":
        script = """[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:EAGLE_TOKEN_PATH;@{owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;protected=$a.AreAccessRulesProtected;allow=@($a.Access|Where-Object {$_.AccessControlType -eq 'Allow'}|ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress"""
        environment = {k: v for k, v in os.environ.items() if k.upper() in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PSMODULEPATH")}
        environment["EAGLE_TOKEN_PATH"] = str(path.resolve())
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.b64encode(script.encode("utf-16le")).decode()], env=environment, capture_output=True, check=True, timeout=10)
        if len(result.stdout) > 16384:
            raise ValueError("invalid ACL response")
        validate_acl(json.loads(result.stdout.decode("utf-8-sig")))
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "r") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 or (os.name != "nt" and (info.st_mode & 0o077 or info.st_uid != os.getuid())):
            raise ValueError("private token file required")
        token = stream.read(1025).strip()
    if len(token) < 16:
        raise ValueError("private token required")
    return token
