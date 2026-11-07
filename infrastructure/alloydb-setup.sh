#!/bin/bash
# AlloyDB Setup Script for Lit-Scout
# This script sets up an AlloyDB cluster and database for the lit-scout application

set -e

# Configuration
PROJECT_ID=${1:-your-gcp-project-id}
REGION=${2:-us-central1}
CLUSTER_ID="lit-scout-db"
INSTANCE_ID="lit-scout-primary"
DB_NAME="lit_scout"
DB_USER="lit_scout_user"

echo "Setting up AlloyDB for lit-scout"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Cluster: $CLUSTER_ID"

# Enable required APIs
echo "Enabling required Google Cloud APIs..."
gcloud services enable alloydb.googleapis.com --project=$PROJECT_ID
gcloud services enable compute.googleapis.com --project=$PROJECT_ID
gcloud services enable servicenetworking.googleapis.com --project=$PROJECT_ID

# Create VPC and Private Service Connection (if not exists)
echo "Setting up VPC for private database connection..."
VPC_NETWORK="lit-scout-network"

if ! gcloud compute networks describe $VPC_NETWORK --project=$PROJECT_ID &>/dev/null; then
  gcloud compute networks create $VPC_NETWORK \
    --subnet-mode=custom \
    --project=$PROJECT_ID
fi

# Create subnet
SUBNET_NAME="lit-scout-subnet"
if ! gcloud compute networks subnets describe $SUBNET_NAME --region=$REGION --project=$PROJECT_ID &>/dev/null; then
  gcloud compute networks subnets create $SUBNET_NAME \
    --network=$VPC_NETWORK \
    --region=$REGION \
    --range=10.0.0.0/24 \
    --project=$PROJECT_ID
fi

# Reserve IP range for service networking
echo "Reserving IP range for service networking..."
gcloud compute address create google-managed-services-$VPC_NETWORK \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --network=$VPC_NETWORK \
  --project=$PROJECT_ID || echo "IP range already exists"

# Create private service connection
echo "Creating private service connection..."
gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-$VPC_NETWORK \
  --network=$VPC_NETWORK \
  --project=$PROJECT_ID || echo "Private connection already exists"

# Create AlloyDB Cluster
echo "Creating AlloyDB cluster..."
gcloud alloydb clusters create $CLUSTER_ID \
  --region=$REGION \
  --network=$VPC_NETWORK \
  --project=$PROJECT_ID \
  --quiet || echo "Cluster already exists"

# Create Primary Instance
echo "Creating primary instance..."
gcloud alloydb instances create $INSTANCE_ID \
  --cluster=$CLUSTER_ID \
  --region=$REGION \
  --instance-type=PRIMARY \
  --machine-type=db-f1-micro \
  --project=$PROJECT_ID \
  --quiet || echo "Instance already exists"

# Wait for instance to be ready
echo "Waiting for instance to be ready..."
gcloud alloydb instances describe $INSTANCE_ID \
  --cluster=$CLUSTER_ID \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format='value(state)' > /dev/null

# Get the instance connection name
INSTANCE_CONNECTION_NAME=$(gcloud alloydb instances describe $INSTANCE_ID \
  --cluster=$CLUSTER_ID \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format='value(name)')

echo "Instance connection name: $INSTANCE_CONNECTION_NAME"

# Create database
echo "Creating database: $DB_NAME"
gcloud alloydb databases create $DB_NAME \
  --cluster=$CLUSTER_ID \
  --region=$REGION \
  --project=$PROJECT_ID || echo "Database already exists"

# Create database user (with random password)
echo "Creating database user: $DB_USER"
DB_PASSWORD=$(openssl rand -base64 32)
gcloud alloydb users create $DB_USER \
  --cluster=$CLUSTER_ID \
  --password=$DB_PASSWORD \
  --region=$REGION \
  --project=$PROJECT_ID \
  --quiet || echo "User may already exist - use Cloud Console to update password"

# Output connection information
echo ""
echo "✅ AlloyDB Setup Complete!"
echo ""
echo "Database Connection Information:"
echo "================================"
echo "Connection Name (Cloud SQL Proxy): $PROJECT_ID:$REGION:$INSTANCE_ID"
echo "Database Name: $DB_NAME"
echo "Database User: $DB_USER"
echo "Database Password: $DB_PASSWORD (save this securely in Secret Manager)"
echo ""
echo "Connection String Examples:"
echo "For Cloud Run (via Cloud SQL Proxy):"
echo "  postgresql://$DB_USER:PASSWORD@/lit_scout?host=/cloudsql/$PROJECT_ID:$REGION:$INSTANCE_ID"
echo ""
echo "For Local Development (via Cloud SQL Proxy):"
echo "  1. Start Cloud SQL Proxy: cloud-sql-proxy '$PROJECT_ID:$REGION:$INSTANCE_ID' --port 5432"
echo "  2. Connection string: postgresql://$DB_USER:PASSWORD@localhost:5432/$DB_NAME"
echo ""
echo "Next Steps:"
echo "==========="
echo "1. Save the database password to Google Secret Manager:"
echo "   gcloud secrets create lit-scout-db-password --data-file=- <<< '$DB_PASSWORD' --project=$PROJECT_ID"
echo ""
echo "2. Update Cloud Run environment variables:"
echo "   gcloud run services update lit-scout-backend --update-env-vars DATABASE_URL='postgresql://$DB_USER:PASSWORD@/lit_scout?host=/cloudsql/$PROJECT_ID:$REGION:$INSTANCE_ID' --region=$REGION --project=$PROJECT_ID"
echo ""
echo "3. Set up Cloud SQL Proxy in Cloud Run"
echo "   (Add to Cloud Run yaml: '--add-cloudsql-instances=$PROJECT_ID:$REGION:$INSTANCE_ID')"
echo ""
