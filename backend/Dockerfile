FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import os,requests; requests.get('http://localhost:%s/api/health' % os.getenv('PORT','8000'), timeout=5).raise_for_status()"

# Serves the API the frontend uses; Cloud Run injects PORT. Keep to a single instance (state is held in-process).
CMD ["sh", "-c", "uvicorn demo_server:app --host 0.0.0.0 --port ${PORT:-8000}"]
