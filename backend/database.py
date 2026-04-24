from sqlalchemy import create_engine, Column, String, JSON, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
import datetime

DATABASE_URL = "sqlite:///./missions.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class MissionRecord(Base):
    __tablename__ = "missions"

    id                 = Column(String,   primary_key=True, index=True)
    name               = Column(String,   nullable=False)
    orbit              = Column(String,   nullable=False)
    objectives         = Column(JSON,     nullable=False)
    constraints        = Column(JSON,     nullable=True)
    payload            = Column(JSON,     nullable=True)
    graph              = Column(JSON,     nullable=True)
    insights           = Column(JSON,     nullable=True)
    suggestions        = Column(JSON,     nullable=True)
    # ECSS-E-10-05A fields
    ecss_validation    = Column(JSON,     nullable=True)
    critical_functions = Column(JSON,     nullable=True)
    functional_matrix  = Column(JSON,     nullable=True)
    interfaces         = Column(JSON,     nullable=True)
    phase_map          = Column(JSON,     nullable=True)
    created_at         = Column(DateTime, default=datetime.datetime.utcnow)


# Create tables on import — new columns added via ADD COLUMN for existing DBs
from sqlalchemy import text, inspect

def _migrate(engine):
    """Add any missing columns to an existing missions table."""
    insp = inspect(engine)
    existing = {col["name"] for col in insp.get_columns("missions")}
    new_cols = {
        "ecss_validation":    "JSON",
        "critical_functions": "JSON",
        "functional_matrix":  "JSON",
        "interfaces":         "JSON",
        "phase_map":          "JSON",
    }
    with engine.connect() as conn:
        for col, col_type in new_cols.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE missions ADD COLUMN {col} {col_type}"))
                print(f"  ↳ migrated: added column '{col}'")
        conn.commit()

Base.metadata.create_all(bind=engine)
try:
    _migrate(engine)
except Exception as e:
    print(f"Migration note: {e}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()