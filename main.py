from fastapi import FastAPI, Request, HTTPException, status, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from app.database import Base_sqlite, engine_sqlite
from app.routers import student_api, staff_api
import os
import configparser

Base_sqlite.metadata.create_all(bind=engine_sqlite)

app = FastAPI(
    title="Dormitory Management API",
    description="API для управления модулем заселения в общежитие",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_FILES_DIR = os.path.join(CURRENT_DIR, "static")
TEMPLATES_DIR = os.path.join(CURRENT_DIR, "templates")

if not os.path.exists(STATIC_FILES_DIR):
    raise RuntimeError(f"Static directory not found at: {STATIC_FILES_DIR}. Please ensure 'static' folder exists.")

if not os.path.exists(TEMPLATES_DIR):
    raise RuntimeError(f"Templates directory not found at: {TEMPLATES_DIR}. Please ensure 'templates' folder exists.")

app.mount("/static", StaticFiles(directory=STATIC_FILES_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

app.include_router(student_api.router)
app.include_router(staff_api.router)

CONFIG_PATH = os.path.join(CURRENT_DIR, "config.txt")
config = configparser.ConfigParser()
config.read(CONFIG_PATH)

try:
    ALLOWED_IPS = {ip.strip() for ip in config.get("security", "allowed_ips").split(",")}
except (configparser.NoSectionError, configparser.NoOptionError):
    ALLOWED_IPS = set()
    print("[WARNING] Section or option not found in config.txt. ALLOWED_IPS is empty.")

print(f"[INFO] Allowed IPs: {ALLOWED_IPS}")

def verify_ip(request: Request):
    client_host = request.client.host.split(":")[0]
    print(f"[DEBUG] Incoming IP (cleaned): {client_host}")

    if len(ALLOWED_IPS) > 0 and client_host not in ALLOWED_IPS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access forbidden: your IP {client_host} is not allowed"
        )

@app.get("/", include_in_schema=False)
async def student_portal_root(request: Request):
    return templates.TemplateResponse("student_portal.html", {"request": request})

@app.get("/staff", include_in_schema=False, dependencies=[Depends(verify_ip)])
async def staff_portal(request: Request):
    return templates.TemplateResponse("staff_portal.html", {"request": request})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)