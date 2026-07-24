"""Suppliers — name + contact email, referenced by inventory items via name match."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from ._shared import PROJECTION, clean

router = APIRouter()


class Supplier(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None


class SupplierCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


@router.get("/suppliers", response_model=List[Supplier])
async def list_suppliers(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.suppliers.find(tenant_filter(user), PROJECTION).sort("name", 1).to_list(200)
    return docs


@router.post("/suppliers", response_model=Supplier)
async def create_supplier(payload: SupplierCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    doc = {"id": f"sup_{uuid.uuid4().hex[:8]}", "tenant_id": user["tenant_id"], **payload.model_dump()}
    await db.suppliers.insert_one(doc)
    return clean(doc)


@router.patch("/suppliers/{supplier_id}", response_model=Supplier)
async def update_supplier(supplier_id: str, payload: SupplierUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.suppliers.find_one_and_update(
        tenant_filter(user, {"id": supplier_id}), {"$set": updates}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return clean(res)


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.suppliers.delete_one(tenant_filter(user, {"id": supplier_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {"ok": True}
