from pydantic import BaseModel


class DocumentResponse(BaseModel):
    doc_id: str
    name: str
    full_text: str


class GraphEdgeResponse(BaseModel):
    source: str
    target: str
    type: str
    reason: str | None = None


class RelationshipDetailsResponse(BaseModel):
    source: str
    target: str
    type: str
    reason: str
    source_documents: list[DocumentResponse]
    target_documents: list[DocumentResponse]
    shared_document_ids: list[str]
