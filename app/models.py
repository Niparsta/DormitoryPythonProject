from sqlalchemy import Column, Integer, String, Boolean, Date, ForeignKey, Enum as SQLEnum, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base_sqlite

Base_postgres = declarative_base()


class ApplicationStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ALLOCATED = "allocated"


class Dormitory(Base_sqlite):
    __tablename__ = "dormitories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    address = Column(String)
    rooms = relationship("Room", back_populates="dormitory", cascade="all, delete-orphan")


class Room(Base_sqlite):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    dormitory_id = Column(Integer, ForeignKey("dormitories.id"))
    floor_number = Column(Integer)
    room_number = Column(String)
    capacity = Column(Integer)
    current_occupancy = Column(Integer, default=0)
    dormitory = relationship("Dormitory", back_populates="rooms")
    allocations = relationship("Application", back_populates="allocated_room_detail")


class Application(Base_sqlite):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, index=True)
    application_date = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(SQLEnum(ApplicationStatus), default=ApplicationStatus.PENDING)
    rejection_reason = Column(String, nullable=True)
    allocated_room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    allocated_room_detail = relationship("Room", back_populates="allocations")


class Faculty(Base_postgres):
    __tablename__ = "faculties"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True)
    groups = relationship("Group", back_populates="faculty")


class Group(Base_postgres):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    faculty_id = Column(Integer, ForeignKey("faculties.id"), nullable=False)
    faculty = relationship("Faculty", back_populates="groups")
    students = relationship("Student", back_populates="group")


class Student(Base_postgres):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_ticket_number = Column(String(50), unique=True, nullable=False, index=True)
    last_name = Column(String(100), nullable=False)
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100), nullable=True)
    birth_date = Column(Date, nullable=False)
    is_foreign = Column(Boolean, nullable=False)
    city_of_residence = Column(String(100), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    group = relationship("Group", back_populates="students")
