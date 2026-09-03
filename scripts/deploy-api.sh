#!/usr/bin/env bash
# Deploy the RightsRadar API to Cloud Run in cloud mode.
# Usage: PROJECT=<gcp-project> REGION=us-central1 BUCKET=<bucket> WEB_ORIGIN=https://hackathon-project-web-five.vercel.app ./scripts/deploy-api.sh
set -euo pipefail

: "${PROJECT:?set PROJECT}"
: "${REGION:=us-central1}"
: "${BUCKET:?set BUCKET}"
: "${WEB_ORIGIN:?set WEB_ORIGIN}"
SERVICE=rightsrader-api
SA="rightsrader-api@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com aiplatform.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com >/dev/null

if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create rightsrader-api --display-name "RightsRadar API"
fi
for role in roles/aiplatform.user roles/datastore.user roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --quiet >/dev/null
done

if ! gcloud secrets describe rightsrader-parallel-api-key >/dev/null 2>&1; then
  echo "Create the secret first:  printf '%s' \"\$RIGHTSRADAR_PARALLEL_API_KEY\" | gcloud secrets create rightsrader-parallel-api-key --data-file=-" >&2
  exit 1
fi

# Cloud Build runs as the default compute service account, which on projects created after
# April 2024 starts with no roles at all and cannot read its own source upload.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$BUILD_SA" --role roles/cloudbuild.builds.builder --quiet >/dev/null

# The Dockerfile lives in services/api but needs the repo root as build context (root uv.lock),
# so build with an explicit Cloud Build config instead of `gcloud run deploy --source`.
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/rightsrader/api:$(git rev-parse --short HEAD)"
gcloud artifacts repositories describe rightsrader --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create rightsrader --repository-format docker --location "$REGION"
# Keep the config on disk with a repo-relative path: the Windows Cloud SDK cannot read
# `--config -` from stdin, and it cannot resolve absolute MSYS paths such as /tmp/build.yaml.
BUILD_CONFIG="cloudbuild.$$.yaml"
trap 'rm -f "$BUILD_CONFIG"' EXIT
cat >"$BUILD_CONFIG" <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ['build', '-f', 'services/api/Dockerfile', '-t', '${IMAGE}', '.']
images: ['${IMAGE}']
EOF
gcloud builds submit --config "$BUILD_CONFIG" .

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --concurrency 8 --memory 1Gi --timeout 300 \
  --set-env-vars "RIGHTSRADAR_MODE=cloud,RIGHTSRADAR_GOOGLE_CLOUD_PROJECT=${PROJECT},RIGHTSRADAR_GOOGLE_CLOUD_LOCATION=global,RIGHTSRADAR_GEMINI_MODEL=gemini-3.7-flash,RIGHTSRADAR_CLOUD_STORAGE_BUCKET=${BUCKET},RIGHTSRADAR_FIRESTORE_COLLECTION=rightsrader_cases,RIGHTSRADAR_ALLOWED_ORIGINS=${WEB_ORIGIN},RIGHTSRADAR_DAILY_ANALYSIS_CAP=25,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global" \
  --set-secrets "RIGHTSRADAR_PARALLEL_API_KEY=rightsrader-parallel-api-key:latest"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
echo "API URL: $URL"
curl -fsS "$URL/health"; echo
