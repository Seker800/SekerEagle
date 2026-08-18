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
