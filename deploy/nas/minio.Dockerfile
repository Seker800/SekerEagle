# Same upstream release as the Mac deployment, built from an immutable official commit.
FROM --platform=$BUILDPLATFORM golang:1.24.2-bookworm AS build
WORKDIR /src
RUN git init && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e
ENV GOMAXPROCS=2 GOMEMLIMIT=1500MiB
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 go build -trimpath \
    -ldflags="-s -w -X github.com/minio/minio/cmd.CopyrightYear=2025 -X github.com/minio/minio/cmd.Version=2025-04-22T22:12:26Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-04-22T22-12-26Z -X github.com/minio/minio/cmd.CommitID=0d7408fc9969caf07de6a8c3a84f9fbb10a6739e" \
    -o /out/minio .

FROM alpine:3.23
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="0d7408fc9969caf07de6a8c3a84f9fbb10a6739e" \
      org.opencontainers.image.version="RELEASE.2025-04-22T22-12-26Z" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=build /out/minio /usr/bin/minio
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/LICENSE /licenses/minio-LICENSE
RUN mkdir /data && chown 1000:1000 /data
USER 1000:1000
ENTRYPOINT ["/usr/bin/minio"]
