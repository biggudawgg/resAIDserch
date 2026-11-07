#!/usr/bin/env bash
# Creates the VPC + AlloyDB cluster the backend uses. Usage: ./alloydb-setup.sh PROJECT_ID [REGION]
# NOTE: AlloyDB is billed per hour (free only during Google's trial). Delete the cluster when you're done:
#   gcloud alloydb clusters delete lit-scout-db --region=REGION --force
set -euo pipefail

PROJECT_ID=${1:?usage: $0 PROJECT_ID [REGION]}
REGION=${2:-us-central1}
NETWORK=lit-scout-network
SUBNET=lit-scout-subnet
CLUSTER=lit-scout-db
INSTANCE=lit-scout-primary
DB_PASSWORD=$(openssl rand -hex 16)

gcloud config set project "$PROJECT_ID"
gcloud services enable alloydb.googleapis.com compute.googleapis.com servicenetworking.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com

gcloud compute networks create $NETWORK --subnet-mode=custom || true
gcloud compute networks subnets create $SUBNET --network=$NETWORK --region="$REGION" --range=10.0.0.0/24 || true
gcloud compute addresses create google-managed-services-$NETWORK --global --purpose=VPC_PEERING \
  --prefix-length=16 --network=$NETWORK || true
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-$NETWORK --network=$NETWORK || true

gcloud alloydb clusters create $CLUSTER --region="$REGION" --network=$NETWORK --password="$DB_PASSWORD"
gcloud alloydb instances create $INSTANCE --cluster=$CLUSTER --region="$REGION" \
  --instance-type=PRIMARY --cpu-count=2

IP=$(gcloud alloydb instances describe $INSTANCE --cluster=$CLUSTER --region="$REGION" --format='value(ipAddress)')
URL="postgresql://postgres:${DB_PASSWORD}@${IP}:5432/postgres"

printf '%s' "$URL" | gcloud secrets create lit-scout-db-url --data-file=- \
  || printf '%s' "$URL" | gcloud secrets versions add lit-scout-db-url --data-file=-

echo
echo "Done. DATABASE_URL is stored in Secret Manager as lit-scout-db-url (private IP $IP)."
echo "Next: create the lit-scout-groq-key / lit-scout-openai-key secrets, then deploy with Cloud Build."
echo "Grant the Cloud Run service account access:"
echo "  gcloud secrets add-iam-policy-binding lit-scout-db-url --member=serviceAccount:\$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor"
