#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGES=(
  "@verifrax/originseal"
  "@verifrax/archicustos"
  "@verifrax/kairoclasp"
  "@verifrax/limenward"
  "@verifrax/validexor"
  "@verifrax/attestorium"
  "@verifrax/irrevocull"
  "@verifrax/guillotine"
  "@verifrax/auctoriseal"
  "@verifrax/corpiform"
  "@verifrax/cicullis"
  "@verifrax/verifrax-verify"
  "@verifrax/verifrax-profiles"
  "@verifrax/verifrax-spec"
  "@verifrax/verifrax"
  "@verifrax/sigillarium"
  "@verifrax/verifrax-api"
  "@verifrax/root"
  "@kaaffilm/mk10-pro"
  "@invocorder/recorder"
  "@antimatterium/antimatterium"
)

PINS=()
for pkg in "${PACKAGES[@]}"; do
  PINS+=("${pkg}@latest")
done

pnpm --filter @adjutorix/app add "${PINS[@]}"
bash scripts/power/verify-adjutorix-power-packages.sh
