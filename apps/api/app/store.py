from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.schemas.venue import Scenario, SimTick, VenueGraph
from app.services.simulator import SimulationEngine


@dataclass
class Session:
    id: str
    graph: VenueGraph | None = None
    scenario: Scenario | None = None
    image_bytes: bytes | None = None
    engine: SimulationEngine | None = None
    last_tick: SimTick | None = None
    confirmed: bool = False
    extraction_status: str = "idle"
    extraction_progress: int = 0
    extraction_stage: str = ""
    extraction_error: str | None = None
    revision_status: str = "idle"
    revision_progress: int = 0
    revision_stage: str = ""
    revision_error: str | None = None


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self) -> Session:
        session = Session(id=str(uuid.uuid4()))
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def require(self, session_id: str) -> Session:
        session = self.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session


store = SessionStore()
