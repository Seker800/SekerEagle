FROM --platform=$BUILDPLATFORM golang:1.24.2-bookworm AS build
WORKDIR /src
RUN git init && git remote add origin https://github.com/minio/mc.git \
    && git fetch --depth=1 origin b00526b153a31b36767991a4f5ce2cced435ee8e \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = b00526b153a31b36767991a4f5ce2cced435ee8e
ENV GOMAXPROCS=2 GOMEMLIMIT=1500MiB
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 go build -trimpath \
    -ldflags="-s -w -X github.com/minio/mc/cmd.CopyrightYear=2025 -X github.com/minio/mc/cmd.Version=2025-04-16T18:13:26Z -X github.com/minio/mc/cmd.ReleaseTag=RELEASE.2025-04-16T18-13-26Z -X github.com/minio/mc/cmd.CommitID=b00526b153a31b36767991a4f5ce2cced435ee8e" \
    -o /out/mc .

FROM alpine:3.23
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="b00526b153a31b36767991a4f5ce2cced435ee8e" \
      org.opencontainers.image.version="RELEASE.2025-04-16T18-13-26Z" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=build /out/mc /usr/bin/mc
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/LICENSE /licenses/mc-LICENSE
RUN mkdir /home/minio && chown 1000:1000 /home/minio
ENV HOME=/home/minio
USER 1000:1000
ENTRYPOINT ["/usr/bin/mc"]
