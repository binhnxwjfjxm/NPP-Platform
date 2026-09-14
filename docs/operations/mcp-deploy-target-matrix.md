# MCP/Công Ty deployment target matrix

| Changed area | Deploy target | Manual command or operation |
| --- | --- | --- |
| `npp-core/web/**` only | Công Ty Vercel project | `/deploy-vercel-production` on Issue #5 |
| `npp-core/**` backend only | Công Ty VPS `npp-company-api.service` | separate manual Công Ty VPS release |
| `mcp/**` frontend only | MCP Field Vercel project | `/deploy-vercel-mcp-production` on Issue #5 |
| `mcp/**` backend only | MCP VPS `npp-mcp-api.service` | separate manual MCP VPS release |
| MCP frontend and backend | both MCP targets | two separate releases and two smoke runs |
| Công Ty and MCP changes | only affected targets | independent releases; never one combined deploy |

MCP Field production has two server-side bindings: `CORE_API_INTERNAL_URL` to Công Ty VPS for workforce authentication and `BACKEND_API_BASE_URL` to MCP VPS for MCP business APIs.

A merge to `main` does not deploy any target automatically. Heroku is not a production deploy target after Issue #958 cutover.