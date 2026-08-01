# MCP/Core deployment target matrix

| Changed area | Deploy target | Manual command or operation |
| --- | --- | --- |
| `npp-core/web/**` only | Core Vercel project | `/deploy-vercel-production` on Issue #5 |
| `npp-core/**` backend only | Heroku app `hung-phat` | separate manual Heroku release |
| `mcp/**` frontend only | MCP Field Vercel project | `/deploy-vercel-mcp-production` on Issue #5 |
| `mcp/**` backend only | Heroku app `hung-phat-mcp` | separate manual Heroku release |
| MCP frontend and backend | both MCP targets | two separate releases and two smoke runs |
| Core and MCP changes | only affected targets | independent releases; never one combined deploy |

A merge to `main` does not deploy any target automatically.
