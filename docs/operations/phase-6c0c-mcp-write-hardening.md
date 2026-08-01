# Phase 6C.0C — MCP backend-owned write hardening

> Status: **SOURCE IMPLEMENTATION — NO PRODUCTION MUTATION**  
> Issue: `#143`  
> Branch: `agent/phase-6c0c-mcp-write-hardening`  
> Baseline: `main@87a3151f8c0897e3418f65fcc76d38abdabbcbf7`  
> Date: `2026-08-02`

## 1. Purpose

Phase 6C.0B moved the active MCP backend startup boundary away from Supabase and established a provider-neutral PostgreSQL adapter. Phase 6C.0C locks the write-side security and transaction contract before any MCP schema, repository tables or production database attachment are introduced.

This phase does not create a generic database mutation route. It defines the only acceptable shape for future backend-owned MCP write handlers.

## 2. Request context and principal

The backend token authenticates the trusted server-to-server transport. Installation identity remains server-owned from runtime configuration.

The immutable request context contains:

```text
requestId
installation.id / installation.nppCode
actor.id / actor.type / actor.authentication
principal.id / principal.type / principal.authentication
principal.employeeId when resolved
principal.roles
principal.permissions
principal.scopes
idempotencyKey
receivedAt
```

Client request headers cannot grant installation identity, employee identity, roles, permissions or scopes. A future identity resolver may supply a principal object to the context builder, but the gateway must treat that resolver as backend-owned code rather than browser input.

The default service principal is configured only by backend environment names:

```text
MCP_SERVICE_ROLES
MCP_SERVICE_PERMISSIONS
MCP_SERVICE_SCOPES
```

All three default to empty lists. Empty policy is an intentional deny-by-default state.

## 3. Authorization

Protected write commands require:

1. authenticated backend transport;
2. an authenticated principal;
3. one explicit `mcp.*` permission;
4. an explicit MCP scope when the command is scoped.

Permission matching is exact. Scope matching is exact except for an explicit domain wildcard such as `mcp:*`. Missing or empty permissions/scopes deny the command. Arbitrary `*` permissions are not supported.

Stable public failures:

```text
authentication_required -> 401
permission_denied       -> 403
scope_denied            -> 403
```

## 4. Backend-owned command boundary

Future MCP business writes must call `executeWriteCommand`. The caller provides a reviewed command name, permission, scope, aggregate descriptor, event type, validated payload and domain mutation callback.

The command executor does not accept a provider, SQL statement, table name, RPC name or arbitrary mutation target from the frontend.

## 5. Idempotency

Every risky write requires `Idempotency-Key`.

The fingerprint is SHA-256 over a canonical representation of:

```text
command name + validated command payload
```

Required claim outcomes:

```text
claimed      -> execute mutation
replay       -> return original response without mutation/audit/outbox duplication
conflict     -> same key with a different fingerprint, HTTP 409
in_progress  -> retryable HTTP 409 with bounded Retry-After detail
```

A failed transaction must not persist a successful replay record.

## 6. Transaction, audit and outbox

The repository adapter introduced in Phase 6C.0D must implement one transaction runner exposing these ports:

```text
tx.idempotency.claim
tx.idempotency.complete
tx.audit.append
tx.outbox.enqueue
```

The domain mutation uses the same transaction object. The transaction commits only after:

```text
domain mutation
-> audit append
-> outbox enqueue
-> idempotency completion
```

Any failure rolls back all four effects.

Audit/outbox metadata includes:

```text
eventId
eventType
aggregateType / aggregateId / aggregateVersion
installationId
actorId / actorType / employeeId
requestId
idempotencyKey
source
occurredAt
payload
```

Public API normalization removes provider, SQL, schema, table, query, stack and credential diagnostics.

## 7. Phase boundary

Completed by this phase:

```text
server-owned principal contract
deny-by-default permission/scope checks
canonical command fingerprint
idempotency claim/replay/conflict/in-progress contract
transactional audit/outbox command envelope
fixture-based rollback and sanitization tests
```

Still deferred:

```text
6C.0D mcp schema, repositories, constraints, indexes, roles and grants
6C.0E backup, restore rehearsal, migration rehearsal and reconciliation
6C.0F provider attachment and cutover preparation
6C.1 customer onboarding bridge
```

No Heroku/Vercel setting, production database, migration, deployment or MCP Vercel secret workflow is changed by this phase.
