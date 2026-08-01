# PR summary — MCP Field manual Vercel deploy boundary

This branch adds a separate MCP Field Vercel production workflow without changing the existing Core workflow.

Key invariants:

- Issue #5 remains the shared operator surface only.
- Core command: `/deploy-vercel-production`.
- MCP command: `/deploy-vercel-mcp-production`.
- MCP workflow rejects the Core project ID.
- Both workflows deploy exact `main` only.
- MCP workflow operates from root directory `mcp`.
- No Heroku deploy is included.
- No provider or production deployment is executed by this branch.
