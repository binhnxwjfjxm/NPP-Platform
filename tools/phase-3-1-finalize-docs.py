from pathlib import Path

PLAN = Path("NPP_PLATFORM_MASTER_PLAN.md")
WORKFLOW = Path(".github/workflows/phase-3-1-finalize-docs-once.yml")
SCRIPT = Path("tools/phase-3-1-finalize-docs.py")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


text = PLAN.read_text(encoding="utf-8")

text = replace_once(
    text,
    "**Status:** Phase 3.1 merged into `main` by PR #26 at commit `a8038bfcdead3c6dc2b51b97a690974c30b5475c`; production rollout not started.",
    "**Status:** **CLOSED on `2026-07-26`.** Phase 3.1 code, database migration, Core API runtime, Core web UI, canonical organization routing, authentication gate and production smoke have all completed.",
    "phase status",
)

text = replace_once(
    text,
    "- [x] Full PR CI verification: Foundation F0.2, Core Foundation, and Core UI/Browser E2E",
    "- [x] Full PR CI verification: Foundation F0.2, Core Foundation, and Core UI/Browser E2E\n"
    "- [x] Vietnamese AppShell, dashboard and dedicated branch/warehouse/location administration routes merged by PR #28\n"
    "- [x] Production migrations `002_core_idempotency` through `006_org_locations` applied and verified after backup + restore rehearsal\n"
    "- [x] Vercel canonical `/api/organization/*` routing and Basic Auth middleware verified in production\n"
    "- [x] Vercel project root set to `npp-core/web`; nested `/npp-core/web/*` paths return `404`\n"
    "- [x] Production deployment `dpl_BugXwqsXxFGma3obV3QSAPP2YFu7` is `READY` on `https://npp-platform.vercel.app`\n"
    "- [x] Root and Core web Auto Deploy gates are re-locked with `deploymentEnabled=false`",
    "completed checklist",
)

text = replace_once(
    text,
    "**Gate status:** Closed in PR #26 after API, migration rehearsal, security hardening, and browser E2E passed. Production deployment remains a separate explicit operation.\n\n"
    "**Closeout record:** Documentation finalized by PR #27; no production deployment, production migration, or provider change was performed.",
    "**Gate status:** **CLOSED.** PRs #26, #28, #29 and #30 passed their required CI gates. Production PostgreSQL migrations were verified, Core API live/ready returned `200`, the Core web production deployment reached `READY`, canonical organization API routing stopped returning Vercel `404`, nested build paths were removed, and browser authentication remained active.\n\n"
    "**Closeout record:** See `docs/operations/phase-3-org-warehouse-closeout.md` and `docs/operations/LATEST_HANDOFF.md`. Backups `b1` and `b002` remain the recorded pre/post migration snapshots; provider state must still be audited before any later migration or deploy.\n\n"
    "**Product checkpoint:** Do not open another Phase 3 slice yet. The product owner requested a small UI-adjustment pass on the deployed shell/dashboard/organization screens before selecting the next master-data slice.",
    "gate closeout",
)

text = replace_once(
    text,
    "## 22. Việc tiếp theo theo đúng thứ tự\n\n```text",
    "## 22. Việc tiếp theo theo đúng thứ tự\n\n"
    "**Execution checkpoint `2026-07-26`:** Phase 3.1 is closed in production. Pause the roadmap here for the product-owner UI adjustment request. Do not start users, customers, suppliers, products, inventory, sales, purchasing or MCP cutover until that UI pass is specified and completed.\n\n"
    "```text",
    "execution checkpoint",
)

PLAN.write_text(text, encoding="utf-8")

for path in (WORKFLOW, SCRIPT):
    if path.exists():
        path.unlink()
