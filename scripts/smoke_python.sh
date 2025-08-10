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

GEN_RESP=$(curl -sS -H 'Accept: application/json' -X POST "$HOST/api/minigames/generate" \
  -H 'Content-Type: application/json' \
  -d "$JSON")
printf '%s' "$GEN_RESP" | tee /tmp/minigen.json >/dev/null

USED=$(jq -r '.usedName // (.file|split("/")[-1])' /tmp/minigen.json)
if [[ "$USED" == "null" || -z "$USED" ]]; then
  echo "Generation failed or no filename returned" >&2
  exit 1
fi

case "$USED" in
  *.py) : ;; 
  *) echo "Expected a .py file, got: $USED (server may be running old build or template ignored)" >&2; exit 4;;
esac

echo "Generated: $USED"

# Run QA endpoint for the generated file
QA_RESP=$(curl -sS -H 'Accept: application/json' "$HOST/api/minigames/qa?file=$USED")
FIRST_CHAR=$(printf '%s' "$QA_RESP" | head -c 1 || true)
if [[ "$FIRST_CHAR" != '{' ]]; then
  echo "QA endpoint did not return JSON. Is the server restarted?" >&2
  echo "$QA_RESP" >&2
  exit 5
fi
printf '%s' "$QA_RESP" | tee /tmp/minigen_qa.json >/dev/null
OK=$(jq -r '.ok' /tmp/minigen_qa.json)
if [[ "$OK" != "true" ]]; then
  echo "QA failed" >&2
  exit 2
fi

echo "Smoke test OK for $USED"
