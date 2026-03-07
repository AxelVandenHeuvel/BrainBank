from pydantic import BaseModel


class DocumentResponse(BaseModel):
    doc_id: str
    name: str
    full_text: str
