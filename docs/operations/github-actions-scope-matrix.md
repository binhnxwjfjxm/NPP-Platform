# GitHub Actions scope matrix

## MCP-only change

- Runs only matching MCP workflows whose existing path filters cover the changed MCP file.
- Core workflows, historical phase workflows and deployment workflows do not start.

## NPP Core-only change

- Runs only matching Core workflows whose existing path filters cover the changed Core file.
- MCP workflows, historical phase workflows and deployment workflows do not start.

## Docs-only change

- No automatic CI workflow starts.
- A workflow can still be started manually when an operator intentionally needs historical evidence.

## Deployment workflows

- Vercel and Heroku production workflows accept only workflow_dispatch or the exact approved Issue #5 command.
- They never start from push or pull_request.

## Concurrency

- Automatic CI workflows cancel an older in-progress run for the same branch or pull request.
- Production deployment workflows keep their existing non-cancelling serialized behavior.
