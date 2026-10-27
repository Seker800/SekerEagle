import argparse

from .app import create_app
from .backend import CudaEngine
from .config import private_bind, read_token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11438)
    parser.add_argument("--capacity", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()
    address = private_bind(args.bind)
    if not 1024 <= args.port <= 65535:
        raise ValueError("unprivileged port required")
    token = read_token(args.token_file)
    if len(token) < 16 or not 1 <= args.capacity <= 8:
        raise ValueError("invalid runtime capacity or token")
    engine = CudaEngine(args.model_dir)
    import uvicorn
    uvicorn.run(create_app(engine, token, args.capacity, args.batch_size), host=str(address), port=args.port,
                access_log=False, timeout_keep_alive=5, limit_concurrency=16)


if __name__ == "__main__":
    main()
