"""Typed DTOs mirroring lib/api-v1/openapi.yaml's components.schemas —
kept in sync by hand for now (Python has no equivalent to the TypeScript
SDK's openapi-typescript codegen step in this stage; see the SDK usage
guide's "keeping in sync" note). Field names are snake_case per Python
convention; the wire format's camelCase is translated in `from_dict`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


@dataclass(frozen=True)
class Location:
    id: str
    name: str
    address: Optional[str]

    @staticmethod
    def from_dict(data: Optional[dict]) -> Optional["Location"]:
        if data is None:
            return None
        return Location(id=data["id"], name=data["name"], address=data.get("address"))


@dataclass(frozen=True)
class Audit:
    id: str
    score: int
    summary: Optional[str]
    created_at: str
    location: Optional[Location]

    @staticmethod
    def from_dict(data: dict) -> "Audit":
        return Audit(
            id=data["id"],
            score=data["score"],
            summary=data.get("summary"),
            created_at=data["createdAt"],
            location=Location.from_dict(data.get("location")),
        )


@dataclass(frozen=True)
class IssueCounts:
    low: int
    medium: int
    high: int

    @staticmethod
    def from_dict(data: dict) -> "IssueCounts":
        return IssueCounts(low=data["low"], medium=data["medium"], high=data["high"])


@dataclass(frozen=True)
class ReportListItem(Audit):
    issue_count: int = 0
    issue_counts: Optional[IssueCounts] = None

    @staticmethod
    def from_dict(data: dict) -> "ReportListItem":  # type: ignore[override]
        audit = Audit.from_dict(data)
        return ReportListItem(
            id=audit.id,
            score=audit.score,
            summary=audit.summary,
            created_at=audit.created_at,
            location=audit.location,
            issue_count=data["issueCount"],
            issue_counts=IssueCounts.from_dict(data["issueCounts"]),
        )


@dataclass(frozen=True)
class ReportIssue:
    id: str
    title: str
    description: Optional[str]
    priority: Literal["low", "medium", "high"]
    recommendation: Optional[str]

    @staticmethod
    def from_dict(data: dict) -> "ReportIssue":
        return ReportIssue(
            id=data["id"],
            title=data["title"],
            description=data.get("description"),
            priority=data["priority"],
            recommendation=data.get("recommendation"),
        )


@dataclass(frozen=True)
class Report(Audit):
    issue_counts: Optional[IssueCounts] = None
    issues: tuple = ()

    @staticmethod
    def from_dict(data: dict) -> "Report":  # type: ignore[override]
        audit = Audit.from_dict(data)
        return Report(
            id=audit.id,
            score=audit.score,
            summary=audit.summary,
            created_at=audit.created_at,
            location=audit.location,
            issue_counts=IssueCounts.from_dict(data["issueCounts"]),
            issues=tuple(ReportIssue.from_dict(i) for i in data["issues"]),
        )


@dataclass(frozen=True)
class Client:
    id: str
    name: str
    contact_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    stage: Literal["lead", "prospect", "client", "churned"]
    created_at: str

    @staticmethod
    def from_dict(data: dict) -> "Client":
        return Client(
            id=data["id"],
            name=data["name"],
            contact_name=data.get("contactName"),
            email=data.get("email"),
            phone=data.get("phone"),
            address=data.get("address"),
            stage=data["stage"],
            created_at=data["createdAt"],
        )


@dataclass(frozen=True)
class Task:
    id: str
    client_id: Optional[str]
    title: str
    description: Optional[str]
    due_date: Optional[str]
    status: Literal["todo", "in_progress", "done"]
    created_at: str

    @staticmethod
    def from_dict(data: dict) -> "Task":
        return Task(
            id=data["id"],
            client_id=data.get("clientId"),
            title=data["title"],
            description=data.get("description"),
            due_date=data.get("dueDate"),
            status=data["status"],
            created_at=data["createdAt"],
        )


@dataclass(frozen=True)
class Interaction:
    id: str
    client_id: str
    type: Literal["call", "email", "meeting", "note"]
    summary: str
    occurred_at: str
    created_at: str

    @staticmethod
    def from_dict(data: dict) -> "Interaction":
        return Interaction(
            id=data["id"],
            client_id=data["clientId"],
            type=data["type"],
            summary=data["summary"],
            occurred_at=data["occurredAt"],
            created_at=data["createdAt"],
        )


@dataclass(frozen=True)
class Pagination:
    limit: int
    next_cursor: Optional[str]

    @staticmethod
    def from_dict(data: dict) -> "Pagination":
        return Pagination(limit=data["limit"], next_cursor=data.get("nextCursor"))
