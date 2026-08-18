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

if [[ -f "$repo_root/.env" ]]; then
  set -a
  source "$repo_root/.env"
  set +a
fi

case "$action" in
  setup)
    cd "$service_dir"
    "$uv_bin" sync --frozen
    ;;
  run)
    cd "$service_dir"
    exec "$uv_bin" run --frozen uvicorn sekereagle_mlx.app:app --host 0.0.0.0 --port 11435
    ;;
  test)
    cd "$service_dir"
    exec "$uv_bin" run --frozen pytest
    ;;
  *)
    print -u2 "usage: $0 {setup|run|test}"
    exit 2
    ;;
esac
