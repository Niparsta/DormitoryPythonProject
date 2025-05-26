from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app import crud, schemas
from app.database import get_db_sqlite, get_db_postgres

router = APIRouter(
    prefix="/student",
    tags=["student"],
)

@router.post("/applications/", response_model=schemas.ApplicationResponse, status_code=status.HTTP_201_CREATED)
def create_student_application(
    application_in: schemas.ApplicationCreate,
    db_sqlite: Session = Depends(get_db_sqlite),
    db_pg: Session = Depends(get_db_postgres)
):
    try:
        application = crud.create_application(db_sqlite=db_sqlite, db_pg=db_pg, application_in=application_in)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return application


@router.post("/applications/status_by_details/", response_model=schemas.ApplicationStatusResponse)
def check_application_status_by_details(
    status_request: schemas.ApplicationStatusCheckByTicketRequest,
    db_sqlite: Session = Depends(get_db_sqlite),
    db_pg: Session = Depends(get_db_postgres)
):
    application_status = crud.get_application_status_by_student_details(
        db_sqlite=db_sqlite,
        db_pg=db_pg,
        student_ticket_number=status_request.student_ticket_number,
        last_name=status_request.last_name
    )
    if not application_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Заявление для указанных данных студента не найдено."
        )
    return application_status