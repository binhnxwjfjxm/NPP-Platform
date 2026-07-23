# Production hygiene implementation checklist

```text
[x] Exact production smoke rows inventoried
[x] Real report guard verified
[x] 28 fixture rows deleted atomically
[x] Post-cleanup query returns zero smoke fixtures
[x] Guarded smoke-route cleanup migration added
[x] Smoke runner cleanup moved to mandatory final phase
[x] Production runtime/seed marker CI guard added
[x] Standard mobile-web-app-capable metadata added
[ ] CI green
[ ] Migration applied to production
[ ] VPS deployed
[ ] Production smoke proves zero leftovers
[ ] Vercel production metadata verified
```

A5.4.2 remains paused until every unchecked gate is complete.
