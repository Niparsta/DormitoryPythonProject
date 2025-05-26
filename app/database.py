import configparser
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

config_path = os.path.join(os.path.dirname(__file__), 'config.txt')

if not os.path.exists(config_path):
    raise FileNotFoundError(f"Config file not found at path: {config_path}")

config = configparser.ConfigParser()
config.read(config_path)

if 'sqlite' not in config:
    raise KeyError("Section 'sqlite' not found in config file")
if 'postgres' not in config:
    raise KeyError("Section 'postgres' not found in config file")

sqlite_db_name = config['sqlite']['database_name']
SQLALCHEMY_DATABASE_URL = f"sqlite:///{sqlite_db_name}"

POSTGRES_DATABASE_URL = (
    f"postgresql://{config['postgres']['username']}:"
    f"{config['postgres']['password']}@"
    f"{config['postgres']['host']}:"
    f"{config['postgres']['port']}/"
    f"{config['postgres']['database']}"
)

engine_sqlite = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal_sqlite = sessionmaker(autocommit=False, autoflush=False, bind=engine_sqlite)
Base_sqlite = declarative_base()

engine_postgres = create_engine(POSTGRES_DATABASE_URL)
SessionLocal_postgres = sessionmaker(autocommit=False, autoflush=False, bind=engine_postgres)
Base_postgres = declarative_base()

def get_db_sqlite():
    db = SessionLocal_sqlite()
    try:
        yield db
    finally:
        db.close()

def get_db_postgres():
    db = SessionLocal_postgres()
    try:
        yield db
    finally:
        db.close()
