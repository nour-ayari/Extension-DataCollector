from pydantic import BaseModel
from typing import Optional, Any, Dict


class MessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None


class MessageResponse(BaseModel):
    record_id: str
    clean_instruction: str
    intent: Dict[str, Any]
    sentiment: Dict[str, Any]
    churn_risk: Dict[str, Any]