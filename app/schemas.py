import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from app.models import ApplicationStatus


class AppBaseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)


class StudentBase(AppBaseModel):
    student_ticket_number: str
    last_name: str
    first_name: str
    middle_name: Optional[str] = None
    birth_date: datetime.date
    is_foreign: bool
    city_of_residence: str
    group_id: int


class StudentInDB(StudentBase):
    id: int


class ApplicationCreate(AppBaseModel):
    student_ticket_number: str
    last_name: str


class ApplicationBase(AppBaseModel):
    id: int
    student_id: int
    application_date: datetime.datetime
    status: ApplicationStatus
    rejection_reason: Optional[str] = None
    allocated_room_id: Optional[int] = None


class ApplicationResponse(ApplicationBase):
    pass


class StaffApplicationResponse(ApplicationResponse):
    student_info: Optional[StudentInDB] = None
    allocated_dorm_name: Optional[str] = None
    allocated_dorm_address: Optional[str] = None
    allocated_room_number: Optional[str] = None
    allocated_floor_number: Optional[int] = None


class ApplicationStatusCheckByTicketRequest(AppBaseModel):
    student_ticket_number: str
    last_name: str


class ApplicationStatusResponse(AppBaseModel):
    application_id: int
    student_ticket_number: str
    student_last_name: str
    student_first_name: Optional[str] = None
    student_middle_name: Optional[str] = None
    status: ApplicationStatus
    rejection_reason: Optional[str] = None
    dormitory_name: Optional[str] = None
    dormitory_address: Optional[str] = None
    room_number: Optional[str] = None
    floor_number: Optional[int] = None


class RoomBase(AppBaseModel):
    floor_number: int
    room_number: str
    capacity: int


class RoomCreate(RoomBase):
    pass


class DormitoryBase(AppBaseModel):
    name: str
    address: str


class RoomResponse(RoomBase):
    id: int
    current_occupancy: int
    dormitory_id: int


class DormitoryCreate(DormitoryBase):
    pass


class DormitoryResponse(DormitoryBase):
    id: int
    rooms: List[RoomResponse] = ()


class DormitoryStructure(DormitoryBase):
    id: Optional[int] = None
    rooms: List[RoomCreate] = ()


class DormitoryStructureExport(AppBaseModel):
    dormitories: List[DormitoryStructure]


class ApplicationStatusUpdate(AppBaseModel):
    status: ApplicationStatus
    rejection_reason: Optional[str] = None


class ApplicationAllocationUpdate(AppBaseModel):
    room_id: int


class RoomResponseWithDormitory(AppBaseModel):
    id: int
    dormitory_id: int
    floor_number: int
    room_number: str
    capacity: int
    current_occupancy: int
    dormitory_name: Optional[str] = None
    dormitory_address: Optional[str] = None


class RoomDetails(AppBaseModel):
    id: int
    floor_number: int
    room_number: str
    capacity: int
    current_occupancy: int
    occupants: List[StudentInDB] = ()


class DormitoryDetailsResponse(AppBaseModel):
    id: int
    name: str
    address: str
    rooms: List[RoomDetails] = ()
