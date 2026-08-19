# SekerEagle MLX embedding host

This host-only service loads `Qwen/Qwen3-VL-Embedding-2B` with MLX-Embeddings on
Apple Silicon. Docker workers send bounded preview bytes over authenticated HTTP;
the service never accepts an image URL. The model's 2048-dimensional MRL output is
truncated to the configured 1024-dimensional prefix and L2-normalized.

```bash
./scripts/mlx-embedding-host.sh setup
./scripts/mlx-embedding-host.sh run
```

`MLX_EMBEDDING_TOKEN` must match the private Docker `.env`. The revision is pinned
to a Hugging Face commit so vectors cannot silently drift.

PyTorch/Torchvision are installed only because the upstream Transformers image
processor requires them; model inference remains on MLX/Metal.

The authenticated surface is intentionally narrow: `/health/live`,
`/health/ready` (plus the worker-compatible `/healthz` alias), `/v1/model`, and
bounded image/text embedding endpoints. Image bodies are streamed into a fixed
20 MiB ceiling and URLs or host file paths are never accepted.

## License

This component directly imports the GPLv3 `mlx-embeddings` package and is
therefore distributed under `GPL-3.0-only`; see `LICENSE`. The rest of the
SekerEagle repository is licensed separately under Apache-2.0. The default Qwen
model is downloaded at runtime and is not redistributed in this repository.
