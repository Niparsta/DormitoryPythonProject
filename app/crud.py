from sqlalchemy.orm import Session, selectinload
from app import models, schemas
from typing import List, Optional


def get_student_by_ticket_number_and_lastname(db_pg: Session, student_ticket_number: str, last_name: str) -> Optional[
    models.Student]:
    return db_pg.query(models.Student).filter(
        models.Student.student_ticket_number == student_ticket_number,
        models.Student.last_name.ilike(last_name)
    ).first()


def create_application(db_sqlite: Session, db_pg: Session, application_in: schemas.ApplicationCreate) -> Optional[
    models.Application]:
    student = get_student_by_ticket_number_and_lastname(
        db_pg,
        application_in.student_ticket_number,
        application_in.last_name
    )
    if not student:
        raise ValueError("Студент с указанным номером студенческого билета и фамилией не найден.")

    existing_application = db_sqlite.query(models.Application).filter(
        models.Application.student_id == student.id,
        models.Application.status.in_([
            models.ApplicationStatus.PENDING,
            models.ApplicationStatus.APPROVED,
            models.ApplicationStatus.ALLOCATED
        ])
    ).order_by(models.Application.application_date.desc()).first()
    if existing_application:
        raise ValueError(
            f"У студента уже есть активное заявление (номер заявления: {existing_application.id}, статус: {existing_application.status}).")

    db_application = models.Application(student_id=student.id)
    db_sqlite.add(db_application)
    db_sqlite.commit()
    db_sqlite.refresh(db_application)
    return db_application


def get_student_by_ticket_number(db_pg: Session, student_ticket_number: str) -> Optional[models.Student]:
    return db_pg.query(models.Student).filter(models.Student.student_ticket_number == student_ticket_number).first()


def get_application_status_by_student_details(db_sqlite: Session, db_pg: Session, student_ticket_number: str,
                                              last_name: str) -> Optional[schemas.ApplicationStatusResponse]:
    student = get_student_by_ticket_number_and_lastname(db_pg, student_ticket_number, last_name)
    if not student:
        return None

    application_query = db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail).selectinload(models.Room.dormitory)
    )

    application = application_query.filter(
        models.Application.student_id == student.id,
        models.Application.status.in_([
            models.ApplicationStatus.PENDING,
            models.ApplicationStatus.APPROVED,
            models.ApplicationStatus.ALLOCATED
        ])
    ).order_by(models.Application.application_date.desc()).first()

    if not application:
        application = application_query.filter(
            models.Application.student_id == student.id
        ).order_by(models.Application.application_date.desc()).first()

    if not application:
        return None

    response_data = {
        "application_id": application.id,
        "student_ticket_number": student.student_ticket_number,
        "student_last_name": student.last_name,
        "student_first_name": student.first_name,
        "student_middle_name": student.middle_name,
        "status": application.status,
        "rejection_reason": application.rejection_reason
    }

    if application.status == models.ApplicationStatus.ALLOCATED and application.allocated_room_detail and application.allocated_room_detail.dormitory:
        room = application.allocated_room_detail
        dormitory = room.dormitory
        response_data["dormitory_name"] = dormitory.name
        response_data["dormitory_address"] = dormitory.address
        response_data["room_number"] = room.room_number
        response_data["floor_number"] = room.floor_number

    return schemas.ApplicationStatusResponse(**response_data)


def get_all_applications(db_sqlite: Session, skip: int = 0, limit: int = 100) -> List[models.Application]:
    return db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail).selectinload(models.Room.dormitory)
    ).order_by(models.Application.application_date.desc()).offset(skip).limit(limit).all()


def create_dormitory(db_sqlite: Session, dormitory: schemas.DormitoryCreate) -> models.Dormitory:
    db_dormitory = models.Dormitory(name=dormitory.name, address=dormitory.address)
    db_sqlite.add(db_dormitory)
    db_sqlite.commit()
    db_sqlite.refresh(db_dormitory)
    return db_dormitory


def delete_dormitory(db_sqlite: Session, dormitory_id: int) -> Optional[models.Dormitory]:
    dormitory = db_sqlite.query(models.Dormitory).filter(models.Dormitory.id == dormitory_id).first()

    if not dormitory:
        return None

    room_ids_subquery = db_sqlite.query(models.Room.id).filter(models.Room.dormitory_id == dormitory_id).subquery()

    active_application = db_sqlite.query(models.Application).filter(
        models.Application.allocated_room_id.in_(room_ids_subquery),
        models.Application.status == models.ApplicationStatus.ALLOCATED
    ).first()

    if active_application:
        raise ValueError(
            f"Невозможно удалить общежитие '{dormitory.name}' (идентификатор: {dormitory_id}), "
            f"так как в нем есть комнаты с заселенными студентами. "
            f"Сначала отмените заселение или перераспределите студентов."
        )

    db_sqlite.query(models.Room).filter(models.Room.dormitory_id == dormitory_id).delete(synchronize_session=False)
    db_sqlite.delete(dormitory)
    db_sqlite.commit()
    return dormitory


def define_dormitory_structure(db_sqlite: Session, dormitory_id: int, rooms_data: List[schemas.RoomCreate]) -> Optional[
    models.Dormitory]:
    dormitory = db_sqlite.query(models.Dormitory).filter(models.Dormitory.id == dormitory_id).first()
    if not dormitory:
        return None

    db_sqlite.query(models.Room).filter(models.Room.dormitory_id == dormitory_id).delete()
    db_sqlite.flush()

    for room_data in rooms_data:
        db_room = models.Room(**room_data.dict(), dormitory_id=dormitory_id, current_occupancy=0)
        db_sqlite.add(db_room)
    db_sqlite.commit()
    return db_sqlite.query(models.Dormitory).options(
        selectinload(models.Dormitory.rooms)
    ).filter(models.Dormitory.id == dormitory_id).first()


def get_dormitories_structure(db_sqlite: Session) -> List[models.Dormitory]:
    return db_sqlite.query(models.Dormitory).options(
        selectinload(models.Dormitory.rooms)
    ).all()


def import_dormitories_structure(db_sqlite: Session, structure_data: schemas.DormitoryStructureExport):
    for dorm_data in structure_data.dormitories:
        dormitory = db_sqlite.query(models.Dormitory).filter(models.Dormitory.name == dorm_data.name).first()
        if not dormitory:
            dormitory = models.Dormitory(name=dorm_data.name, address=dorm_data.address)
            db_sqlite.add(dormitory)
            db_sqlite.flush()
        else:
            dormitory.address = dorm_data.address
            db_sqlite.query(models.Room).filter(models.Room.dormitory_id == dormitory.id).delete()
            db_sqlite.flush()

        for room_data in dorm_data.rooms:
            db_room = models.Room(
                dormitory_id=dormitory.id,
                floor_number=room_data.floor_number,
                room_number=room_data.room_number,
                capacity=room_data.capacity,
                current_occupancy=0
            )
            db_sqlite.add(db_room)
    db_sqlite.commit()


def update_application_status(db_sqlite: Session, db_pg: Session, application_id: int,
                              status_update: schemas.ApplicationStatusUpdate) -> Optional[models.Application]:
    application = db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail)
    ).filter(models.Application.id == application_id).first()
    if not application:
        return None

    if application.status == models.ApplicationStatus.ALLOCATED and \
            status_update.status != models.ApplicationStatus.ALLOCATED and \
            application.allocated_room_detail:
        application.allocated_room_detail.current_occupancy = max(0,
                                                                  application.allocated_room_detail.current_occupancy - 1)
        application.allocated_room_id = None
        application.rejection_reason = None

    if status_update.status == models.ApplicationStatus.APPROVED:
        available_room = db_sqlite.query(models.Room).filter(
            models.Room.current_occupancy < models.Room.capacity
        ).order_by(models.Room.dormitory_id, models.Room.id).first()

        if available_room:
            application.status = models.ApplicationStatus.ALLOCATED
            application.allocated_room_id = available_room.id
            available_room.current_occupancy += 1
            application.rejection_reason = None
        else:
            application.status = models.ApplicationStatus.APPROVED
            application.rejection_reason = "Одобрено, но свободных комнат на данный момент нет. Ожидает распределения."
    else:
        application.status = status_update.status
        application.rejection_reason = status_update.rejection_reason

    db_sqlite.commit()
    return db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail).selectinload(models.Room.dormitory)
    ).filter(models.Application.id == application_id).first()


def allocate_student_to_room(db_sqlite: Session, application_id: int, room_id: int) -> Optional[models.Application]:
    application = db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail)
    ).filter(models.Application.id == application_id).first()

    if not application:
        return None

    if application.status != models.ApplicationStatus.ALLOCATED:
        raise ValueError(
            f"Заявление с номером {application_id} не находится в статусе '{models.ApplicationStatus.ALLOCATED}'. "
            "Изменить место заселения можно только для уже заселенных студентов.")

    new_room = db_sqlite.query(models.Room).filter(models.Room.id == room_id).first()

    if not new_room:
        raise ValueError(f"Комната с идентификатором {room_id} не найдена.")

    if new_room.current_occupancy >= new_room.capacity:
        raise ValueError(
            f"Комната {new_room.dormitory.name} (эт.{new_room.floor_number}, к.{new_room.room_number}) уже полностью занята.")

    if application.allocated_room_id:
        old_room = application.allocated_room_detail
        if old_room and old_room.id != new_room.id:
            old_room.current_occupancy = max(0, old_room.current_occupancy - 1)
            db_sqlite.add(old_room)

    application.allocated_room_id = new_room.id
    new_room.current_occupancy += 1
    application.status = models.ApplicationStatus.ALLOCATED
    application.rejection_reason = None

    db_sqlite.add(application)
    db_sqlite.add(new_room)
    db_sqlite.commit()

    return db_sqlite.query(models.Application).options(
        selectinload(models.Application.allocated_room_detail).selectinload(models.Room.dormitory)
    ).filter(models.Application.id == application_id).first()


def get_available_rooms(db_sqlite: Session) -> List[dict]:
    rooms = db_sqlite.query(models.Room).options(
        selectinload(models.Room.dormitory)
    ).filter(
        models.Room.current_occupancy < models.Room.capacity
    ).order_by(
        models.Room.dormitory_id, models.Room.floor_number, models.Room.room_number
    ).all()

    return [
        {
            "id": room.id,
            "room_number": room.room_number,
            "floor_number": room.floor_number,
            "capacity": room.capacity,
            "current_occupancy": room.current_occupancy,
            "dormitory_id": room.dormitory_id,
            "dormitory_name": room.dormitory.name if room.dormitory else None,
            "dormitory_address": room.dormitory.address if room.dormitory else None,
        }
        for room in rooms
    ]


def get_dormitory_details(db_sqlite: Session, db_pg: Session, dormitory_id: int) -> Optional[
    schemas.DormitoryDetailsResponse]:
    dormitory = db_sqlite.query(models.Dormitory).options(
        selectinload(models.Dormitory.rooms).selectinload(models.Room.allocations)
    ).filter(models.Dormitory.id == dormitory_id).first()

    if not dormitory:
        return None

    rooms_details = []
    for room_orm in dormitory.rooms:
        students_in_room = []
        allocated_applications = [
            app for app in room_orm.allocations
            if app.status == models.ApplicationStatus.ALLOCATED and app.allocated_room_id == room_orm.id
        ]

        student_ids = [app.student_id for app in allocated_applications]
        if student_ids:
            pg_students = db_pg.query(models.Student).filter(models.Student.id.in_(student_ids)).all()
            pg_students_map = {student.id: student for student in pg_students}

            for app in allocated_applications:
                student_orm = pg_students_map.get(app.student_id)
                if student_orm:
                    students_in_room.append(schemas.StudentInDB.from_orm(student_orm))

        rooms_details.append(schemas.RoomDetails(
            id=room_orm.id,
            floor_number=room_orm.floor_number,
            room_number=room_orm.room_number,
            capacity=room_orm.capacity,
            current_occupancy=room_orm.current_occupancy,
            occupants=students_in_room
        ))

    rooms_details.sort(key=lambda x: (x.floor_number, x.room_number))

    return schemas.DormitoryDetailsResponse(
        id=dormitory.id,
        name=dormitory.name,
        address=dormitory.address,
        rooms=rooms_details
    )


def process_applications_auto(db_sqlite: Session, db_pg: Session):
    pending_applications = db_sqlite.query(models.Application).filter(
        models.Application.status == models.ApplicationStatus.PENDING
    ).options(
        selectinload(models.Application.allocated_room_detail)
    ).all()

    processed_count = 0

    for app in pending_applications:
        student = get_student_by_id_pg(db_pg, student_id=app.student_id)
        if not student:
            app.status = models.ApplicationStatus.REJECTED
            app.rejection_reason = "Запись о студенте не найдена во внешней БД."
            processed_count += 1
            continue

        if student.is_foreign:
            available_room = db_sqlite.query(models.Room).filter(
                models.Room.current_occupancy < models.Room.capacity
            ).order_by(models.Room.dormitory_id, models.Room.id).first()

            if available_room:
                app.status = models.ApplicationStatus.ALLOCATED
                app.allocated_room_id = available_room.id
                available_room.current_occupancy += 1
                app.rejection_reason = None
            else:
                app.status = models.ApplicationStatus.APPROVED
                app.rejection_reason = "Соответствует критериям и одобрено, но свободных комнат на данный момент нет. Ожидает распределения."
        else:
            app.status = models.ApplicationStatus.REJECTED
            app.rejection_reason = "Студент не является иногородним."

        processed_count += 1
    db_sqlite.commit()
    return {"message": f"Обработано заявлений: {processed_count}."}


def get_dormitory_by_id(db_sqlite: Session, dormitory_id: int) -> Optional[models.Dormitory]:
    return db_sqlite.query(models.Dormitory).options(selectinload(models.Dormitory.rooms)).filter(
        models.Dormitory.id == dormitory_id).first()


def get_dormitory_by_name(db: Session, name: str):
    return db.query(models.Dormitory).filter(models.Dormitory.name == name).first()


def get_student_by_id_pg(db: Session,
                         student_id: int) -> Optional[models.Student]:
    return db.query(models.Student).filter(models.Student.id == student_id).first()