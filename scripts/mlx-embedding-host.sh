#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
service_dir="$repo_root/services/mlx-embedding"
action="${1:-run}"
uv_bin="${UV_BIN:-$HOME/.local/bin/uv}"
if [[ ! -x "$uv_bin" ]]; then
  uv_bin="$(command -v uv || true)"
fi
if [[ -z "$uv_bin" ]]; then
  print -u2 "uv is required; install it or set UV_BIN"
  exit 127
fi

case "$action" in
  setup|run|test) exec python3 "$repo_root/scripts/mlx-process-env.py" "$repo_root" "$uv_bin" "$action" ;;
  *) print -u2 "usage: $0 {setup|run|test}"; exit 2 ;;
esac
