from pydantic import BaseModel
from typing import List, Optional


class MissionConstraints(BaseModel):
    mass: Optional[str]
    power: Optional[str]
    lifetime: Optional[str]


class Payload(BaseModel):
    type: str
    resolution: Optional[str]


class OrbitalElements(BaseModel):
    """Classical Keplerian orbital elements (all resolved — never None after backend processing)."""
    body: str                   # e.g. "Earth", "Moon", "Mars"
    bodyRadius: float           # km — radius of the central body
    sma: float                  # Semi-major axis, km
    ecc: float                  # Eccentricity, 0–1
    inc: float                  # Inclination, degrees
    raan: float                 # Right Ascension of Ascending Node, degrees
    aop: float                  # Argument of Periapsis, degrees
    color: Optional[str] = None # Hex color for 3D visualisation


class MissionInput(BaseModel):
    name: str
    orbit: str
    objectives: List[str]
    constraints: Optional[MissionConstraints] = None
    payload: Optional[Payload] = None
    orbital_elements: Optional[OrbitalElements] = None  # Populated for orbital missions


class FunctionNode(BaseModel):
    id: str
    name: str
    parent_id: Optional[str]


class Interface(BaseModel):
    id: str
    source_function: str
    target_function: str
    interface_type: str   # data | control | power

class Requirement(BaseModel):
    id: str
    description: str
    related_function: str


class Subsystem(BaseModel):
    id: str
    name: str


class TraceLink(BaseModel):
    function_id: str
    requirement_id: str


class SystemOutput(BaseModel):
    functions: List[FunctionNode]
    requirements: List[Requirement]
    subsystems: List[Subsystem]
    traceability: List[TraceLink]