#!/usr/bin/env bash
# Publie firestore.rules sur le projet Firebase voyage-interactif (API Firebase Rules).
# Avec la variable FIREBASE_RULES_KEY (clé JSON d'un compte de service qui a le rôle « Administrateur Firebase Rules »),
# sinon avec le compte gcloud connecté.
set -euo pipefail
cd "$(dirname "$0")/.."
unset CLOUDSDK_AUTH_ACCESS_TOKEN
P=voyage-interactif
if [ -n "${FIREBASE_RULES_KEY:-}" ]; then
  export CLOUDSDK_CONFIG=$(mktemp -d); trap 'rm -rf "$CLOUDSDK_CONFIG"' EXIT
  K="$CLOUDSDK_CONFIG/key.json"
  if printf '%s' "$FIREBASE_RULES_KEY" | grep -q '{'; then printf '%s' "$FIREBASE_RULES_KEY" > "$K"; else printf '%s' "$FIREBASE_RULES_KEY" | base64 -d > "$K"; fi
  gcloud config set core/custom_ca_certs_file /root/.ccr/ca-bundle.crt >/dev/null 2>&1 || true
  gcloud auth activate-service-account --key-file "$K" --quiet >/dev/null 2>&1
fi
T=$(gcloud auth print-access-token)
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "content-type: application/json")
BODY=$(python3 -c "import json;print(json.dumps({'source':{'files':[{'name':'firestore.rules','content':open('firestore.rules').read()}]}}))")
NAME=$(curl -sS -X POST "${H[@]}" -d "$BODY" "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['name']) if 'name' in d else sys.exit(json.dumps(d))")
curl -sS -X PATCH "${H[@]}" -d "{\"release\":{\"name\":\"projects/$P/releases/cloud.firestore\",\"rulesetName\":\"$NAME\"}}" \
  "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" >/dev/null
echo "Règles publiées : $NAME"
