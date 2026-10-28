#!/usr/bin/env bash
# Publie firestore.rules sur le projet Firebase voyage-interactif (API Firebase Rules), avec le compte gcloud connecté.
set -euo pipefail
cd "$(dirname "$0")/.."
unset CLOUDSDK_AUTH_ACCESS_TOKEN
P=voyage-interactif
T=$(gcloud auth print-access-token)
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "content-type: application/json")
BODY=$(python3 -c "import json;print(json.dumps({'source':{'files':[{'name':'firestore.rules','content':open('firestore.rules').read()}]}}))")
NAME=$(curl -sS -X POST "${H[@]}" -d "$BODY" "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['name']) if 'name' in d else sys.exit(json.dumps(d))")
curl -sS -X PATCH "${H[@]}" -d "{\"release\":{\"name\":\"projects/$P/releases/cloud.firestore\",\"rulesetName\":\"$NAME\"}}" \
  "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" >/dev/null
echo "Règles publiées : $NAME"
