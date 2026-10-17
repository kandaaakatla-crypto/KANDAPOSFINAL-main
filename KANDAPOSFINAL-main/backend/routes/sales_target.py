"""Daily sales target — the owner's "what a good day looks like" number.

Stored as `daily_sales_target` (INR, incl. GST like the totals it is compared
with) on the tenant. reports.report_summary returns it as `dailyTarget` so the
Dashboard Home can show today's progress without a second request.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_role
from db import get_db

router = APIRouter()


class SalesTarget(BaseModel):
    # None clears the target.
    target: Optional[float] = Field(default=None, gt=0, le=10_000_000)


@router.put("/tenant/sales-target", response_model=SalesTarget)
async def set_sales_target(payload: SalesTarget, user: dict = Depends(require_role("Manager"))):
    update = ({"$unset": {"daily_sales_target": ""}} if payload.target is None
              else {"$set": {"daily_sales_target": round(payload.target, 2)}})
    res = await get_db().tenants.update_one({"id": user["tenant_id"]}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return SalesTarget(target=None if payload.target is None else round(payload.target, 2))
