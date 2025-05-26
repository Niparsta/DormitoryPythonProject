import configparser
import os
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from sqlalchemy.orm import Session
from app import crud, schemas, models
from app.database import get_db_sqlite, get_db_postgres
from typing import List
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "app", "config.txt")

staff_api_config = configparser.ConfigParser()
staff_api_config.read(CONFIG_PATH)

try:
    STAFF_API_ALLOWED_IPS = {ip.strip() for ip in staff_api_config.get("security", "allowed_ips").split(",")}
except (configparser.NoSectionError, configparser.NoOptionError):
    STAFF_API_ALLOWED_IPS = set()

def verify_ip(request: Request):
    client_host = request.client.host.split(":")[0]
    if len(STAFF_API_ALLOWED_IPS) > 0 and client_host not in STAFF_API_ALLOWED_IPS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access forbidden: your IP {client_host} is not allowed"
        )

router = APIRouter(
    prefix="/staff",
    tags=["staff"],
    dependencies=[Depends(verify_ip)]
)

@router.post("/dormitories/", response_model=schemas.DormitoryResponse, status_code=status.HTTP_201_CREATED)
def add_new_dormitory(dormitory_in: schemas.DormitoryCreate, db_sqlite: Session = Depends(get_db_sqlite)):
    db_dormitory = crud.get_dormitory_by_name(db_sqlite, name=dormitory_in.name)
    if db_dormitory:
        raise HTTPException(status_code=400, detail="Общежитие с таким названием уже существует.")
    created_dorm = crud.create_dormitory(db_sqlite=db_sqlite, dormitory=dormitory_in)
    return schemas.DormitoryResponse.from_orm(created_dorm)

@router.delete("/dormitories/{dormitory_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_dormitory_by_id(dormitory_id: int, db_sqlite: Session = Depends(get_db_sqlite)):
    try:
        deleted = crud.delete_dormitory(db_sqlite=db_sqlite, dormitory_id=dormitory_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Общежитие не найдено.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return

@router.post("/dormitories/{dormitory_id}/structure/", response_model=schemas.DormitoryResponse)
def define_dorm_structure(dormitory_id: int, rooms_data: List[schemas.RoomCreate], db_sqlite: Session = Depends(get_db_sqlite)):
    dormitory_orm = crud.define_dormitory_structure(db_sqlite=db_sqlite, dormitory_id=dormitory_id, rooms_data=rooms_data)
    if not dormitory_orm:
        raise HTTPException(status_code=404, detail="Общежитие не найдено.")
    rooms = [schemas.RoomResponse.from_orm(r) for r in dormitory_orm.rooms] if dormitory_orm.rooms else []
    return schemas.DormitoryResponse(id=dormitory_orm.id, name=dormitory_orm.name, address=dormitory_orm.address, rooms=rooms)

@router.get("/dormitories/structure/export/", response_model=schemas.DormitoryStructureExport)
def export_dormitories_structure(db_sqlite: Session = Depends(get_db_sqlite)):
    dormitories_orm = crud.get_dormitories_structure(db_sqlite=db_sqlite)
    dorms = []
    for dorm in dormitories_orm:
        rooms = [schemas.RoomCreate(floor_number=r.floor_number, room_number=r.room_number, capacity=r.capacity) for r in dorm.rooms] if dorm.rooms else []
        dorms.append(schemas.DormitoryStructure(id=dorm.id, name=dorm.name, address=dorm.address, rooms=rooms))
    return schemas.DormitoryStructureExport(dormitories=dorms)

@router.post("/dormitories/structure/import/", status_code=status.HTTP_201_CREATED)
async def import_dormitories_structure_file(file: UploadFile = File(...), db_sqlite: Session = Depends(get_db_sqlite)):
    if file.content_type != "application/json":
        raise HTTPException(status_code=400, detail="Неверный тип файла. Принимаются только файлы формата JSON.")
    contents = await file.read()
    try:
        data = json.loads(contents)
        structure_data = schemas.DormitoryStructureExport(**data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Неверный формат JSON.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Неверная структура данных: {e}")
    crud.import_dormitories_structure(db_sqlite=db_sqlite, structure_data=structure_data)
    return {"message": "Структура общежитий успешно импортирована."}

@router.get("/dormitories/{dormitory_id}/details/", response_model=schemas.DormitoryDetailsResponse)
def get_dormitory_details_endpoint(dormitory_id: int, db_sqlite: Session = Depends(get_db_sqlite), db_pg: Session = Depends(get_db_postgres)):
    details = crud.get_dormitory_details(db_sqlite, db_pg, dormitory_id)
    if not details:
        raise HTTPException(status_code=404, detail="Общежитие не найдено.")
    return details

@router.get("/applications/", response_model=List[schemas.StaffApplicationResponse])
def view_all_applications(skip: int = 0, limit: int = 100, db_sqlite: Session = Depends(get_db_sqlite), db_pg: Session = Depends(get_db_postgres)):
    applications = crud.get_all_applications(db_sqlite=db_sqlite, skip=skip, limit=limit)
    response = []
    for app in applications:
        student_info = crud.get_student_by_id_pg(db_pg, student_id=app.student_id) if app.student_id else None
        student_data = schemas.StudentInDB.from_orm(student_info) if student_info else None

        app_dict = {
            "id": app.id,
            "student_id": app.student_id,
            "application_date": app.application_date,
            "status": app.status,
            "rejection_reason": app.rejection_reason,
            "allocated_room_id": app.allocated_room_id,
            "student_info": student_data
        }

        if app.status == models.ApplicationStatus.ALLOCATED and app.allocated_room_detail and app.allocated_room_detail.dormitory:
            room = app.allocated_room_detail
            dorm = room.dormitory
            app_dict.update({
                "allocated_dorm_name": dorm.name,
                "allocated_dorm_address": dorm.address,
                "allocated_room_number": room.room_number,
                "allocated_floor_number": room.floor_number
            })

        response.append(schemas.StaffApplicationResponse(**app_dict))
    return response

@router.put("/applications/{application_id}/status/", response_model=schemas.StaffApplicationResponse)
def update_application_status_manual(application_id: int, status_update: schemas.ApplicationStatusUpdate, db_sqlite: Session = Depends(get_db_sqlite), db_pg: Session = Depends(get_db_postgres)):
    application = crud.update_application_status(db_sqlite=db_sqlite, db_pg=db_pg, application_id=application_id, status_update=status_update)
    if not application:
        raise HTTPException(status_code=404, detail="Заявление не найдено.")

    student_info = crud.get_student_by_id_pg(db_pg, student_id=application.student_id) if application.student_id else None
    student_data = schemas.StudentInDB.from_orm(student_info) if student_info else None

    app_dict = {
        "id": application.id,
        "student_id": application.student_id,
        "application_date": application.application_date,
        "status": application.status,
        "rejection_reason": application.rejection_reason,
        "allocated_room_id": application.allocated_room_id,
        "student_info": student_data
    }

    if application.status == models.ApplicationStatus.ALLOCATED and application.allocated_room_detail and application.allocated_room_detail.dormitory:
        room = application.allocated_room_detail
        dorm = room.dormitory
        app_dict.update({
            "allocated_dorm_name": dorm.name,
            "allocated_dorm_address": dorm.address,
            "allocated_room_number": room.room_number,
            "allocated_floor_number": room.floor_number
        })

    return schemas.StaffApplicationResponse(**app_dict)

@router.put("/applications/{application_id}/allocate/", response_model=schemas.StaffApplicationResponse)
def update_application_allocation(application_id: int, allocation_update: schemas.ApplicationAllocationUpdate, db_sqlite: Session = Depends(get_db_sqlite), db_pg: Session = Depends(get_db_postgres)):
    try:
        application = crud.allocate_student_to_room(db_sqlite=db_sqlite, application_id=application_id, room_id=allocation_update.room_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not application:
        raise HTTPException(status_code=404, detail="Заявление или комната не найдены, или студент уже не в статусе «Заселен».")

    student_info = crud.get_student_by_id_pg(db_pg, student_id=application.student_id) if application.student_id else None
    student_data = schemas.StudentInDB.from_orm(student_info) if student_info else None

    app_dict = {
        "id": application.id,
        "student_id": application.student_id,
        "application_date": application.application_date,
        "status": application.status,
        "rejection_reason": application.rejection_reason,
        "allocated_room_id": application.allocated_room_id,
        "student_info": student_data
    }

    if application.status == models.ApplicationStatus.ALLOCATED and application.allocated_room_detail and application.allocated_room_detail.dormitory:
        room = application.allocated_room_detail
        dorm = room.dormitory
        app_dict.update({
            "allocated_dorm_name": dorm.name,
            "allocated_dorm_address": dorm.address,
            "allocated_room_number": room.room_number,
            "allocated_floor_number": room.floor_number
        })

    return schemas.StaffApplicationResponse(**app_dict)

@router.get("/applications/available_rooms/", response_model=List[schemas.RoomResponseWithDormitory])
def get_available_rooms_for_allocation(db_sqlite: Session = Depends(get_db_sqlite)):
    return crud.get_available_rooms(db_sqlite)

@router.post("/applications/process_auto/")
def trigger_automatic_application_processing(db_sqlite: Session = Depends(get_db_sqlite), db_pg: Session = Depends(get_db_postgres)):
    return crud.process_applications_auto(db_sqlite=db_sqlite, db_pg=db_pg)

@router.get("/dormitories/", response_model=List[schemas.DormitoryResponse])
def get_all_dormitories(db_sqlite: Session = Depends(get_db_sqlite)):
    dormitories_orm = crud.get_dormitories_structure(db_sqlite=db_sqlite)
    response = []
    for dorm in dormitories_orm:
        rooms = [schemas.RoomResponse.from_orm(r) for r in dorm.rooms] if dorm.rooms else []
        response.append(schemas.DormitoryResponse(id=dorm.id, name=dorm.name, address=dorm.address, rooms=rooms))
    return response