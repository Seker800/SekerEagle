#!/bin/sh
set -eu
[ "$S3_ACCESS_KEY_ID" != "$MINIO_ROOT_USER" ]
[ "$S3_SECRET_ACCESS_KEY" != "$MINIO_ROOT_PASSWORD" ]
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing local/sekereagle-assets
mc anonymous set none local/sekereagle-assets
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc admin policy create local sekereagle-app /policies/app.json
mc admin policy attach local sekereagle-app --user "$S3_ACCESS_KEY_ID"
