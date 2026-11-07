# Deployment Guide: Lit-Scout to Google Cloud + Vercel

This guide covers deploying the Lit-Scout application to production on Google Cloud Run (backend + AlloyDB) and Vercel (frontend).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup: AlloyDB Database](#setup-alloydb-database)
3. [Deploy Backend to Cloud Run](#deploy-backend-to-cloud-run)
4. [Deploy Frontend to Vercel](#deploy-frontend-to-vercel)
5. [Post-Deployment Configuration](#post-deployment-configuration)
6. [Testing & Verification](#testing--verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools
- `gcloud` CLI (Google Cloud SDK) - [Install](https://cloud.google.com/sdk/docs/install)
- `git` - For pushing code to repositories
- Active Google Cloud Project with billing enabled
- Vercel account - [Sign up](https://vercel.com/signup)
- GitHub repository (optional but recommended for CI/CD)

### GCP Permissions Required
- **Project Editor** or specific roles:
  - `alloydb.admin` (AlloyDB management)
  - `run.admin` (Cloud Run management)
  - `compute.networkAdmin` (VPC and networking)
  - `servicenetworking.admin` (Service networking)

### Environment Variables
Prepare the following:
- `GCP_PROJECT_ID` - Your Google Cloud project ID
- `GCP_REGION` - Region for deployment (e.g., `us-central1`)
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - OpenAI API key (optional)
- `GROQ_API_KEY` - Groq API key (optional)

---

## Setup: AlloyDB Database

### Step 1: Run the AlloyDB Setup Script

```bash
# From the project root
chmod +x infrastructure/alloydb-setup.sh
./infrastructure/alloydb-setup.sh YOUR_GCP_PROJECT_ID us-central1
```

This script will:
- Enable required Google Cloud APIs
- Create a VPC network for secure connections
- Create an AlloyDB cluster and primary instance
- Create the `lit_scout` database
- Create a database user and generate a secure password

**Output:** The script will display:
- Connection name (e.g., `my-project:us-central1:lit-scout-primary`)
- Database credentials
- Connection string examples

### Step 2: Save Database Password to Secret Manager

```bash
# Save the database password from the script output
gcloud secrets create lit-scout-db-password \
  --replication-policy="automatic" \
  --data-file=- <<< "YOUR_DATABASE_PASSWORD" \
  --project=YOUR_GCP_PROJECT_ID
```

### Step 3: Test Local Connection (Optional)

```bash
# Start Cloud SQL Proxy in one terminal
cloud-sql-proxy YOUR_GCP_PROJECT_ID:us-central1:lit-scout-primary --port 5432

# In another terminal, test the connection
psql -h localhost -U lit_scout_user -d lit_scout
```

---

## Deploy Backend to Cloud Run

### Step 1: Configure Backend Environment

1. Update `backend/.env` with production values:
   ```bash
   cp backend/.env.example backend/.env
   
   # Edit backend/.env:
   ENVIRONMENT=production
   DEBUG=False
   LOG_LEVEL=INFO
   # DATABASE_URL will be set via Cloud Run env var
   ANTHROPIC_API_KEY=your_actual_key
   OPENAI_API_KEY=your_actual_key
   GROQ_API_KEY=your_actual_key
   JWT_SECRET=generate_a_secure_random_string
   CORS_ORIGINS=https://YOUR_VERCEL_DOMAIN.vercel.app
   ```

2. **Never commit `.env` file** - use Secret Manager instead for production

### Step 2: Push Code to Repository

```bash
# Initialize git if not already done
git add .
git commit -m "Prepare for production deployment"
git push origin main
```

### Step 3: Enable Cloud Build API

```bash
gcloud services enable cloudbuild.googleapis.com \
  --project=YOUR_GCP_PROJECT_ID
```

### Step 4: Deploy Using Cloud Build

```bash
# Deploy from repository
gcloud builds submit \
  --config=backend/cloudbuild.yaml \
  --project=YOUR_GCP_PROJECT_ID
```

Or **manually deploy a single service**:

```bash
# Build and push Docker image
cd backend

gcloud builds submit \
  --tag=gcr.io/YOUR_GCP_PROJECT_ID/lit-scout-backend:latest \
  --project=YOUR_GCP_PROJECT_ID

# Deploy to Cloud Run
gcloud run deploy lit-scout-backend \
  --image=gcr.io/YOUR_GCP_PROJECT_ID/lit-scout-backend:latest \
  --platform=managed \
  --region=us-central1 \
  --allow-unauthenticated \
  --cpu=2 \
  --memory=2Gi \
  --timeout=900 \
  --set-cloudsql-instances=YOUR_GCP_PROJECT_ID:us-central1:lit-scout-primary \
  --set-env-vars="ENVIRONMENT=production,DEBUG=False" \
  --update-secrets="DATABASE_URL=lit-scout-db-url:latest,ANTHROPIC_API_KEY=lit-scout-anthropic-key:latest,GROQ_API_KEY=lit-scout-groq-key:latest" \
  --project=YOUR_GCP_PROJECT_ID
```

### Step 5: Configure Cloud Run Environment Variables

```bash
# Set using Google Secret Manager
gcloud secrets create lit-scout-db-url \
  --replication-policy="automatic" \
  --data-file=- <<< "postgresql://lit_scout_user:PASSWORD@/lit_scout?host=/cloudsql/YOUR_GCP_PROJECT_ID:us-central1:lit-scout-primary" \
  --project=YOUR_GCP_PROJECT_ID

gcloud secrets create lit-scout-anthropic-key \
  --replication-policy="automatic" \
  --data-file=- <<< "YOUR_ANTHROPIC_API_KEY" \
  --project=YOUR_GCP_PROJECT_ID
```

### Step 6: Get the Backend URL

```bash
gcloud run services describe lit-scout-backend \
  --region=us-central1 \
  --format='value(status.url)' \
  --project=YOUR_GCP_PROJECT_ID
```

Save this URL - you'll need it for the frontend configuration.

---

## Deploy Frontend to Vercel

### Step 1: Connect Repository to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New..." → "Project"
3. Select your GitHub repository with the lit-scout code
4. Click "Import"

### Step 2: Configure Environment Variables in Vercel

1. In Vercel project settings → "Environment Variables"
2. Add the backend URL:
   ```
   VITE_API_URL=https://YOUR_CLOUD_RUN_URL.run.app
   ```
   (Replace with the URL from Step 6 above)

### Step 3: Configure Build Settings

In Vercel project settings:

- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Step 4: Deploy

Vercel will automatically deploy when you push to the main branch. Alternatively, deploy manually:

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd frontend
vercel --prod
```

### Step 5: Get Frontend URL

After deployment, Vercel will provide your frontend URL (e.g., `https://lit-scout.vercel.app`)

---

## Post-Deployment Configuration

### Update Backend CORS

Now that you have the Vercel URL, update the backend CORS settings:

```bash
gcloud run services update lit-scout-backend \
  --update-env-vars="CORS_ORIGINS=https://YOUR_VERCEL_DOMAIN.vercel.app,http://localhost:5173" \
  --region=us-central1 \
  --project=YOUR_GCP_PROJECT_ID
```

### Update Backend Code with Frontend URL

In `backend/app/main.py`, if hardcoded, update CORS origins:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://YOUR_VERCEL_DOMAIN.vercel.app",
        "http://localhost:5173",  # for local dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Then redeploy:

```bash
cd backend
gcloud builds submit \
  --tag=gcr.io/YOUR_GCP_PROJECT_ID/lit-scout-backend:latest \
  --project=YOUR_GCP_PROJECT_ID
```

---

## Testing & Verification

### Backend Health Checks

```bash
# Get the backend URL
BACKEND_URL=$(gcloud run services describe lit-scout-backend \
  --region=us-central1 \
  --format='value(status.url)' \
  --project=YOUR_GCP_PROJECT_ID)

# Test health endpoint
curl $BACKEND_URL/health

# View API documentation
curl $BACKEND_URL/docs
```

### Frontend Access

1. Visit your Vercel URL in a browser
2. Verify the app loads without errors
3. Test the following flows:
   - Ask a research question
   - View the research pipeline
   - Check workspace settings
   - View beliefs and dead ends

### Database Connectivity

```bash
# Check Cloud Run logs for database connection issues
gcloud run logs read lit-scout-backend \
  --region=us-central1 \
  --limit=50 \
  --project=YOUR_GCP_PROJECT_ID
```

### Full Integration Test

1. Open the frontend (https://YOUR_VERCEL_DOMAIN.vercel.app)
2. Create a new research question
3. Run the research pipeline
4. Verify the question appears in the database
5. Check the backend logs for no errors

---

## Troubleshooting

### Backend Won't Connect to Database

**Error:** `could not translate host name "cloudsql/..."`

**Solution:**
- Ensure Cloud SQL Proxy is configured in Cloud Run
- Check `--set-cloudsql-instances` parameter is set correctly
- Verify database user has correct permissions

### Frontend Can't Connect to Backend

**Error:** CORS error in browser console

**Solution:**
- Update `CORS_ORIGINS` environment variable in Cloud Run
- Verify `VITE_API_URL` is set in Vercel environment variables
- Check the actual backend URL is being used

### Cloud Run Deployment Fails

**Solution:**
- Check Cloud Build logs: `gcloud builds log --stream`
- Verify all required APIs are enabled
- Ensure `requirements.txt` can install (psycopg2-binary needs libpq-dev)

### Database Migrations Fail

**Solution:**
- Manually run migrations:
  ```bash
  # Connect to database via Cloud SQL Proxy
  cloud-sql-proxy YOUR_GCP_PROJECT_ID:us-central1:lit-scout-primary --port 5432
  
  # In another terminal
  cd backend
  alembic upgrade head
  ```

### Secret Manager Issues

**Error:** `googleapi: Error 403: Permission denied`

**Solution:**
- Grant Cloud Run service account access to secrets:
  ```bash
  gcloud secrets add-iam-policy-binding lit-scout-db-password \
    --member=serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor \
    --project=YOUR_GCP_PROJECT_ID
  ```

---

## Monitoring & Maintenance

### View Cloud Run Logs

```bash
gcloud run logs read lit-scout-backend \
  --region=us-central1 \
  --follow \
  --project=YOUR_GCP_PROJECT_ID
```

### Set Up Cloud Monitoring Alerts

Use Google Cloud Console to set up alerts for:
- High error rates (5xx responses)
- Slow response times (P95 > 5s)
- Database connection failures

### Database Backups

AlloyDB automatically backs up data. For manual backups:

```bash
gcloud alloydb backups create lit-scout-backup \
  --cluster=lit-scout-db \
  --region=us-central1 \
  --project=YOUR_GCP_PROJECT_ID
```

---

## Rollback Procedure

### Rollback Backend to Previous Version

```bash
# List recent revisions
gcloud run revisions list \
  --service=lit-scout-backend \
  --region=us-central1 \
  --project=YOUR_GCP_PROJECT_ID

# Roll back to a specific revision
gcloud run services update-traffic lit-scout-backend \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1 \
  --project=YOUR_GCP_PROJECT_ID
```

### Rollback Frontend

In Vercel dashboard:
1. Go to "Deployments"
2. Find the previous stable deployment
3. Click "Promote to Production"

---

## Support & Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [AlloyDB Documentation](https://cloud.google.com/alloydb/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [FastAPI Production Deployment](https://fastapi.tiangolo.com/deployment)

---

**Last Updated:** 2026-11-07  
**Maintained by:** Lit-Scout Team
