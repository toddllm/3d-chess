#!/usr/bin/env bash
set -euo pipefail
# Smoke test for Python mini-game generation via local Ollama
# Prereqs: ollama serve + gpt-oss:120b pulled; server running: node server.js; jq installed

HOST=${HOST:-http://localhost:5174}
NAME=${1:-hello-python}

command -v jq >/dev/null 2>&1 || { echo "jq is required for this script" >&2; exit 3; }

# Generate a trivial python game that selftests
SPEC=$(cat << 'EOS'
Create a Python script that implements a tiny number guessing game API,
but only implement --selftest mode:
- When run normally, it should print a short help line and exit(0)
- When run with --selftest, it should run internal tests and print "OK" then exit(0)
- Use only standard library. Keep it < 150 lines.
EOS
)

JSON=$(jq -nc --arg name "$NAME" --arg spec "$SPEC" '{name:$name, template:"python", spec:$spec}')

curl -sS -X POST "$HOST/api/minigames/generate" \
  -H 'Content-Type: application/json' \
  -d "$JSON" | tee /tmp/minigen.json

USED=$(jq -r '.usedName // (.file|split("/")[-1])' /tmp/minigen.json)
if [[ "$USED" == "null" || -z "$USED" ]]; then
  echo "Generation failed or no filename returned" >&2
  exit 1
fi

echo "Generated: $USED"

# Run QA endpoint for the generated file
curl -sS "$HOST/api/minigames/qa?file=$USED" | tee /tmp/minigen_qa.json
OK=$(jq -r '.ok' /tmp/minigen_qa.json)
if [[ "$OK" != "true" ]]; then
  echo "QA failed" >&2
  exit 2
fi

echo "Smoke test OK for $USED"
