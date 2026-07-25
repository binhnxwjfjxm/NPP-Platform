# R2 Storage Adapter Foundation

## Purpose

This document describes the Cloudflare R2 storage adapter foundation implemented for `npp-core/api`.
The adapter is designed as a backend-only, private-by-default storage layer that can generate presigned upload URLs and support basic object operations with an S3-compatible API.

## Configuration

The R2 adapter is enabled only when `R2_STORAGE_ENABLED` is set to `true` and all required Cloudflare R2 environment variables are provided.

Required environment variables:

- `R2_STORAGE_ENABLED` - must be `true` to activate the adapter.
- `R2_BUCKET_NAME` - the R2 bucket name.
- `R2_REGION` - the region string used by the AWS SDK client.
- `R2_ENDPOINT_URL` - the Cloudflare R2 endpoint URL.
- `R2_ACCESS_KEY_ID` - R2 access key id.
- `R2_SECRET_ACCESS_KEY` - R2 secret access key.
- `R2_FORCE_PATH_STYLE` - optional boolean flag to use path-style bucket addressing.

By default, the adapter is disabled to keep backend storage configuration private and avoid accidental provider connections.

## Adapter interface

The adapter is implemented in `npp-core/api/src/storage/r2-adapter.js` and exposes the following operations:

- `uploadObject({ key, body, contentType })`
- `headObject({ key })`
- `getObject({ key })`
- `deleteObject({ key })`
- `getPresignedPutUrl({ key, contentType, expiresIn })`
- `getPresignedGetUrl({ key, expiresIn })`

The adapter maps provider errors into consistent storage errors and uses the AWS SDK v3 `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` packages.

## Object key construction

The helper `buildR2ObjectKey` is implemented in `npp-core/api/src/storage/object-key.js`.
It securely encodes segment values and prevents path traversal.

Example key components:

```js
buildR2ObjectKey({
  installationId: 'install-123',
  namespace: 'uploads',
  objectName: 'report.pdf',
  version: '1',
  suffix: 'final',
});
```

## Protected contract route

A new protected route is available in `npp-core/api/src/server.js`:

- `POST /api/storage/r2/presign-put`

Request requirements:

- `Authorization: Bearer <BACKEND_API_TOKEN>` header
- JSON body containing either `objectKey` or `keyComponents`
- Optional `contentType`
- Optional `expiresIn`

The route is protected by the `core.r2_storage.presign.write` permission and supports idempotent handling via `Idempotency-Key`.

## Audit and idempotency

The contract route uses the existing idempotency foundation in `npp-core/api/src/idempotency.js` and records an audit/outbox transaction around the presign operation.

This ensures consistent behavior for retry-safe requests and provides a durable audit trail for storage presign operations.

## Testing

Unit tests have been added under `npp-core/api/test/` for:

- object key construction
- adapter error normalization
- protected route behavior and audit/outbox transaction integration

Run tests with:

```bash
npm --workspace npp-core-api run test
```
