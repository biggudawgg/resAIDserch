#!/usr/bin/env python
"""Initialize database tables from SQLAlchemy models.

This script creates all tables defined in app/models.py.
Run this on first deployment or after schema changes.

Usage:
    python init_db.py
"""

import sys
import os
from sqlalchemy import create_engine, inspect
from app.core.database import DATABASE_URL
from app.models import Base


def init_database():
    """Create all tables in the database."""
    print(f"Initializing database: {DATABASE_URL}")

    # Create engine
    engine = create_engine(DATABASE_URL, echo=False)

    # Check if tables already exist
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    if existing_tables:
        print(f"Found {len(existing_tables)} existing tables: {', '.join(existing_tables)}")
        print("Skipping table creation (tables already exist)")
        return

    print("Creating tables from models...")
    try:
        Base.metadata.create_all(bind=engine)
        print("✓ Database initialized successfully")
        print(f"Tables created: {', '.join([table.name for table in Base.metadata.tables.values()])}")
    except Exception as e:
        print(f"✗ Error creating tables: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    init_database()
