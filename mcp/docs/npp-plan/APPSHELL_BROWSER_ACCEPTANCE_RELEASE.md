# AppShell Browser Acceptance Release

Date: 2026-07-18

## Release

```text
PR:                         #51 — MERGED
Final head:                 3c26e09b912aa1b4e1d5395ba9d5df272fd0ada1
Merge SHA:                  cf121d7c2a501e7334006c88f50d049ed53f6ced
Foundation F0.2:            #425 PASS
F05 UI Browser Smoke:       #58 PASS
Session Actions UI Smoke:   #25 PASS
Vercel production:          SUCCESS
Backend/schema change:      NONE
VPS pullmcp:                NOT REQUIRED
```

## AppShell contract

```text
AppShell
├─ one non-scrolling top-bar row
├─ one main scroll region
├─ exactly one shared ☰ trigger
├─ bottom navigation capped at five shortcuts
├─ bottom safe-area clearance
└─ desktop sidebar separated from app content
```

The top bar no longer depends on page scrolling. On mobile, AppShell owns a `100dvh` viewport and only the main content region scrolls. The top bar and bottom navigation remain in their own shell regions.

## Browser acceptance result

```json
{
  "APP_SHELL_BROWSER_ACCEPTANCE": "PASS",
  "mobile": {
    "bottomItems": 5,
    "contrast": {
      "header": 10.167378045637014,
      "primary": 5.027093591423864,
      "body": 15.717536772960152,
      "muted": 4.971630725694246
    }
  },
  "desktop": {
    "contrast": {
      "header": 10.167378045637014,
      "primary": 5.027093591423864,
      "body": 15.717536772960152,
      "muted": 4.971630725694246
    }
  },
  "singleMenuTrigger": "PASS",
  "bottomNavigationLimit": "PASS",
  "noOverlap": "PASS",
  "fixedTopBar": "PASS",
  "contrast": "PASS",
  "pressedState": "PASS"
}
```

Artifact:

```text
name:    f05-ui-browser-smoke-evidence
id:      8431479572
digest:  sha256:64ca0e8d1429152653af86bf94d64b495b1e6ca188200084eadf1908ccb75f0d
```

## Interaction states

The browser gate now locks:

- pressed state through a real pointer down/up interaction;
- loading state through a delayed product-search request with disabled controls;
- error state through a canonical API failure envelope;
- existing order/test/report/follow-up success and idempotency behavior.

During the error-state gate, the UI exposed a real bug: canonical `{ error: { message } }` payloads were coerced to `[object Object]`. The product search, variant search and session mutation paths now share canonical error-message extraction and render the actual message.

## Non-regression rules

Do not reintroduce:

- a second menu trigger;
- more than five bottom shortcuts;
- page-owned fixed controls outside AppShell;
- top-bar positioning that depends on the body scroll container;
- content without bottom-navigation safe-area clearance;
- object coercion for canonical API errors.
