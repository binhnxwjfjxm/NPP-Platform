#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/vps-production-cutover-preflight-958.sh"
source "$SCRIPT_DIR/vps-production-cutover-db-958.sh"
source "$SCRIPT_DIR/vps-production-cutover-runtime-958.sh"
source "$SCRIPT_DIR/vps-production-cutover-deploy-958.sh"
source "$SCRIPT_DIR/vps-production-cutover-wiring-958.sh"
