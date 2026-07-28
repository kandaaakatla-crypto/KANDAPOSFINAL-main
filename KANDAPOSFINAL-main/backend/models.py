"""Pydantic models for Kanda POS."""
from __future__ import annotations
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict


OrderType = Literal["delivery", "collection", "dine-in", "sale"]
OrderStatus = Literal["new", "in-kitchen", "ready", "out-for-delivery", "completed"]
OrderPayment = Literal["cash", "card", "unpaid"]
TableStatus = Literal["available", "occupied", "reserved"]
OrderSource = Literal["in-store", "phone", "swiggy", "zomato", "other", "qr"]
TableShape = Literal["round", "square", "rect"]

# ---------- Business type / feature flags ----------
BusinessType = Literal["restaurant", "retail"]

# Every screen/concept a tenant can turn on or off independent of business_type.
# Restaurant tenants default the dine-in-only ones on; retail tenants default
# them off. Everything in _UNIVERSAL_KEYS is generically useful either way and
# defaults on for both — the Platform Owner can always override per client.
_DINE_IN_KEYS = ["tables", "kitchen_display", "packing_station", "dispatch", "meal_deals", "pizza_sizing"]
_UNIVERSAL_KEYS = ["qr_ordering", "online_payments", "loyalty", "customer_display",
                   "voice_agent", "customer_sms", "whatsapp", "daily_digest", "payroll"]
_FEATURE_KEYS = _DINE_IN_KEYS + _UNIVERSAL_KEYS


class TenantFeatures(BaseModel):
    tables: bool = True
    kitchen_display: bool = True
    packing_station: bool = True
    dispatch: bool = True
    meal_deals: bool = True
    pizza_sizing: bool = True
    qr_ordering: bool = True
    online_payments: bool = True
    loyalty: bool = True
    customer_display: bool = True
    voice_agent: bool = True
    customer_sms: bool = True
    whatsapp: bool = True
    daily_digest: bool = True
    payroll: bool = True


def default_features(business_type: str) -> dict:
    dine_in_default = business_type != "retail"
    return {
        **{k: dine_in_default for k in _DINE_IN_KEYS},
        **{k: True for k in _UNIVERSAL_KEYS},
    }


class TenantInfo(BaseModel):
    id: str
    slug: str
    name: str
    businessType: BusinessType = "restaurant"
    features: TenantFeatures = TenantFeatures()


class TenantFeaturesUpdate(BaseModel):
    tables: Optional[bool] = None
    kitchen_display: Optional[bool] = None
    packing_station: Optional[bool] = None
    dispatch: Optional[bool] = None
    meal_deals: Optional[bool] = None
    pizza_sizing: Optional[bool] = None
    qr_ordering: Optional[bool] = None
    online_payments: Optional[bool] = None
    loyalty: Optional[bool] = None
    customer_display: Optional[bool] = None
    voice_agent: Optional[bool] = None
    customer_sms: Optional[bool] = None
    whatsapp: Optional[bool] = None
    daily_digest: Optional[bool] = None
    payroll: Optional[bool] = None


# ---------- Users ----------
class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    role: str
    initials: str


class LoginRequest(BaseModel):
    pin: str


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


# ---------- Menu ----------
class Category(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    color: str
    sort_order: int = 0
    station: Optional[str] = None
    tax_rate: Optional[float] = None  # GST % applied to items in this category unless overridden per-item


class CategoryCreate(BaseModel):
    name: str
    color: str = "#3b82f6"
    sort_order: int = 100
    station: Optional[str] = None
    tax_rate: Optional[float] = None  # None = auto-suggest from name + tenant business type


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    station: Optional[str] = None
    tax_rate: Optional[float] = None


class CategoryReorder(BaseModel):
    order: List[str]


class PizzaSizes(BaseModel):
    sm: float
    md: float
    lg: float


class DealGroup(BaseModel):
    """One pick-N-from-category slot inside a meal deal, e.g. 'choose 1 pizza'.

    `size` only applies when `cat_id` is the pizzas category — it fixes which
    size tier's price/label to show since the deal itself has one flat price.
    """
    cat_id: str
    label: str
    count: int = 1
    size: Optional[str] = None


class ProductVariant(BaseModel):
    """A generic product variant (e.g. size/colour for retail) — independent
    of the restaurant-only pizza sizes/deal groups above. Each variant has its
    own price and, optionally, its own barcode/SKU."""
    label: str
    price: float
    sku: Optional[str] = None
    available: bool = True


class MenuItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    catId: str
    name: str
    desc: Optional[str] = None
    price: Optional[float] = None
    sizes: Optional[PizzaSizes] = None
    available: bool = True
    isPizza: bool = False
    dealGroups: Optional[List[DealGroup]] = None
    imageUrl: Optional[str] = None
    barcode: Optional[str] = None
    variants: Optional[List[ProductVariant]] = None
    tax_rate: Optional[float] = None  # GST % override; None = inherit the category's rate


class MenuItemCreate(BaseModel):
    catId: str
    name: str
    desc: Optional[str] = None
    price: Optional[float] = None
    sizes: Optional[PizzaSizes] = None
    available: bool = True
    isPizza: bool = False
    dealGroups: Optional[List[DealGroup]] = None
    imageUrl: Optional[str] = None
    barcode: Optional[str] = None
    variants: Optional[List[ProductVariant]] = None
    tax_rate: Optional[float] = None


class MenuItemUpdate(BaseModel):
    catId: Optional[str] = None
    name: Optional[str] = None
    desc: Optional[str] = None
    price: Optional[float] = None
    sizes: Optional[PizzaSizes] = None
    available: Optional[bool] = None
    isPizza: Optional[bool] = None
    dealGroups: Optional[List[DealGroup]] = None
    imageUrl: Optional[str] = None
    barcode: Optional[str] = None
    variants: Optional[List[ProductVariant]] = None
    tax_rate: Optional[float] = None


class AvailabilityPayload(BaseModel):
    available: bool


# ---------- Recipes ----------
class RecipeIngredient(BaseModel):
    inventory_id: str
    qty: float


class Recipe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    menu_item_id: str
    size: Optional[str] = None
    ingredients: List[RecipeIngredient] = []


class RecipeUpsert(BaseModel):
    recipes: List[Recipe]


# ---------- Customers ----------
class Customer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    phone: str
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    notes: Optional[str] = ""
    orders: int = 0
    email: Optional[str] = ""
    loyalty_points: int = 0
    loyalty_tier: Literal["bronze", "silver", "gold"] = "bronze"
    loyalty_lifetime_spend: float = 0.0


class CustomerCreate(BaseModel):
    name: str
    phone: str
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    notes: Optional[str] = ""
    email: Optional[str] = ""


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    notes: Optional[str] = None
    email: Optional[str] = None


# ---------- Tables + Layout ----------
class Table(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    number: int
    seats: int
    status: TableStatus
    orderId: Optional[str] = None
    x: float = 0
    y: float = 0
    width: float = 80
    height: float = 80
    shape: TableShape = "square"
    rotation: float = 0


class TableUpdate(BaseModel):
    status: TableStatus
    orderId: Optional[str] = None


class TableCreate(BaseModel):
    number: int
    seats: int = 4
    x: float = 0
    y: float = 0
    width: float = 80
    height: float = 80
    shape: TableShape = "square"
    rotation: float = 0


class TablePosition(BaseModel):
    x: float
    y: float
    width: float = 80
    height: float = 80
    shape: TableShape = "square"
    rotation: float = 0


class FloorElement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    kind: Literal["wall", "label", "door"]
    x: float
    y: float
    width: float = 100
    height: float = 20
    rotation: float = 0
    label: Optional[str] = None
    color: Optional[str] = None


class FloorElementCreate(BaseModel):
    kind: Literal["wall", "label", "door"]
    x: float
    y: float
    width: float = 100
    height: float = 20
    rotation: float = 0
    label: Optional[str] = None
    color: Optional[str] = None


class FloorElementUpdate(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    rotation: Optional[float] = None
    label: Optional[str] = None
    color: Optional[str] = None


# ---------- Reservations ----------
class Reservation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    table_id: str
    customer_name: str
    phone: Optional[str] = None
    party_size: int = 2
    at: str
    duration_min: int = 90
    notes: Optional[str] = ""
    created_by: Optional[str] = None
    status: Literal["booked", "seated", "cancelled", "no-show"] = "booked"


class ReservationCreate(BaseModel):
    table_id: str
    customer_name: str
    phone: Optional[str] = None
    party_size: int = 2
    at: str
    duration_min: int = 90
    notes: Optional[str] = ""


class ReservationUpdate(BaseModel):
    status: Optional[Literal["booked", "seated", "cancelled", "no-show"]] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    party_size: Optional[int] = None
    at: Optional[str] = None
    duration_min: Optional[int] = None
    notes: Optional[str] = None


# ---------- Inventory ----------
class InventoryItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    unit: str
    stock: float
    reorder: float
    supplier: str
    cost_per_unit: float = 0.0


class InventoryItemCreate(BaseModel):
    name: str
    unit: str
    stock: float = 0
    reorder: float = 0
    supplier: str = ""
    cost_per_unit: float = 0.0


class InventoryItemUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    reorder: Optional[float] = None
    supplier: Optional[str] = None
    cost_per_unit: Optional[float] = None


class AdjustStockPayload(BaseModel):
    delta: float


# ---------- Orders ----------
class OrderCustomer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None


class OrderItem(BaseModel):
    name: str
    qty: int
    price: float
    mods: List[str] = []
    size: Optional[str] = None
    tax_rate: Optional[float] = None  # resolved GST % for this line, stamped server-side
    tax_amount: Optional[float] = None  # resolved GST amount for this line, stamped server-side


class OrderCreate(BaseModel):
    type: OrderType
    status: OrderStatus = "new"
    customer: OrderCustomer
    table: Optional[int] = None
    items: List[OrderItem]
    deliveryFee: float = 0
    discount: float = 0
    total: float
    payment: OrderPayment = "unpaid"
    driver: Optional[str] = None
    source: OrderSource = "in-store"
    tip: float = 0
    coupon_code: Optional[str] = None
    location_id: Optional[str] = None
    customer_email: Optional[str] = None
    send_email_receipt: bool = False
    redeem_loyalty_points: int = 0  # cashier elects to burn X points → ₹X off
    # Split payment: list of {method, amount} that sums to total when supplied.
    splits: Optional[List["OrderSplit"]] = None


class OrderSplit(BaseModel):
    method: Literal["cash", "card"]
    amount: float


class Order(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    number: int
    type: OrderType
    status: OrderStatus
    customer: OrderCustomer
    table: Optional[int] = None
    items: List[OrderItem]
    deliveryFee: float = 0
    discount: float = 0
    total: float
    payment: OrderPayment
    placedAt: str
    driver: Optional[str] = None
    source: OrderSource = "in-store"
    tip: float = 0
    coupon_code: Optional[str] = None
    location_id: Optional[str] = None
    customer_email: Optional[str] = None
    # Refund + loyalty tracking — populated post-checkout.
    refunded_amount: float = 0
    refunded_at: Optional[str] = None
    refunded_by: Optional[str] = None
    voided: bool = False
    voided_at: Optional[str] = None
    voided_by: Optional[str] = None
    loyalty_earned: int = 0
    loyalty_redeemed: int = 0
    splits: Optional[List[OrderSplit]] = None
    packed: bool = False
    # GST breakdown, computed server-side at checkout (see tax.py).
    subtotal: float = 0
    taxTotal: float = 0
    cgst: float = 0
    sgst: float = 0
    taxInclusive: bool = False  # True when item prices already included tax (retail MRP) and it was extracted, not added on top


class OrderStatusPayload(BaseModel):
    status: OrderStatus


class OrderPackedPayload(BaseModel):
    packed: bool


class OrderAppendPayload(BaseModel):
    """Add extra items to an already-placed order (running tab / occupied table)."""
    items: List[OrderItem]


class AssignDriverPayload(BaseModel):
    driver: Optional[str] = None


# ---------- Reports ----------
class WeeklyPoint(BaseModel):
    day: str
    sales: float
    orders: int


class TopItem(BaseModel):
    name: str
    sold: int
    revenue: float


class ReportSummary(BaseModel):
    todaySales: float
    ordersToday: int
    avgOrder: float
    deliveriesToday: int
    cashTotal: float
    cardTotal: float
    unpaidTotal: float
    weeklySales: List[WeeklyPoint]
    topItems: List[TopItem]


# ---------- Staff / HR ----------
StaffRole = Literal["Manager", "Cashier", "Driver", "Kitchen"]
PayType = Literal["monthly", "hourly"]
# Indian convention used for labour-cost back-of-envelope:
#   26 working days × 9h = 234 effective hours / month.
MONTHLY_HOURS_DEFAULT = 234.0


class StaffPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    role: StaffRole
    initials: str
    phone: Optional[str] = ""
    pay_type: PayType = "monthly"
    monthly_pay: float = 0.0
    hourly_rate: float = 0.0
    active: bool = True


class StaffCreate(BaseModel):
    name: str
    role: StaffRole
    pin: str  # 4-digit numeric PIN
    phone: Optional[str] = ""
    pay_type: PayType = "monthly"
    monthly_pay: float = 0.0
    hourly_rate: float = 0.0
    active: bool = True


class StaffUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[StaffRole] = None
    pin: Optional[str] = None  # only set when manager rotates PIN
    phone: Optional[str] = None
    pay_type: Optional[PayType] = None
    monthly_pay: Optional[float] = None
    hourly_rate: Optional[float] = None
    active: Optional[bool] = None


def effective_hourly_rate(user_doc: dict) -> float:
    """Resolve a staff doc's effective hourly cost.
    Monthly-paid staff are converted using MONTHLY_HOURS_DEFAULT so the
    labour-cost widget can compare hourly + monthly employees apples-to-apples.
    """
    if (user_doc.get("pay_type") or "monthly") == "monthly":
        monthly = float(user_doc.get("monthly_pay") or 0)
        if monthly > 0:
            return round(monthly / MONTHLY_HOURS_DEFAULT, 4)
    return float(user_doc.get("hourly_rate") or 0)


# ---------- Time clock ----------
PunchSource = Literal["pin", "biometric", "qr", "manual"]


class TimePunch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    user_name: str
    type: Literal["in", "out"]
    at: str  # ISO-8601 UTC
    source: PunchSource = "pin"
    location_id: Optional[str] = None
    device_id: Optional[str] = None
    selfie_b64: Optional[str] = None  # tiny JPEG data URI; manager review only
    note: Optional[str] = None


class TimePunchRequest(BaseModel):
    pin: str
    selfie_b64: Optional[str] = None  # required by client when configured
    device_id: Optional[str] = None
    location_id: Optional[str] = None


class TimePunchManualEdit(BaseModel):
    """Manager override to fix a missed punch."""
    at: str  # ISO
    type: Literal["in", "out"]
    note: Optional[str] = None


class TimesheetRow(BaseModel):
    user_id: str
    user_name: str
    role: StaffRole
    hourly_rate: float
    total_hours: float
    overtime_hours: float
    gross_pay: float
    days_worked: int


# ---------- Payroll ----------
class PayrollRow(BaseModel):
    user_id: str
    user_name: str
    role: StaffRole
    pay_type: PayType
    hourly_rate: float
    monthly_pay: float
    total_hours: float
    overtime_hours: float
    wage_pay: float   # hours-based (hourly staff) or period-prorated (monthly staff)
    tips: float
    gross_pay: float  # wage_pay + tips


# ---------- Shifts / Rota ----------
class Shift(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    user_name: str
    role: StaffRole
    start: str  # ISO
    end: str  # ISO
    station: Optional[str] = None
    notes: Optional[str] = None
    location_id: Optional[str] = None
    published: bool = False


class ShiftCreate(BaseModel):
    user_id: str
    start: str
    end: str
    station: Optional[str] = None
    notes: Optional[str] = None
    location_id: Optional[str] = None
    published: bool = False


class ShiftUpdate(BaseModel):
    user_id: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    station: Optional[str] = None
    notes: Optional[str] = None
    published: Optional[bool] = None


# ---------- Wastage ----------
class WasteEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    inventory_id: str
    inventory_name: str
    qty: float
    unit: str
    reason: str
    by_user_id: str
    by_user_name: str
    at: str


class WasteCreate(BaseModel):
    inventory_id: str
    qty: float
    reason: str


# ---------- Cash drawer / Z-Report ----------
class CashDrawer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    date: str  # YYYY-MM-DD
    opening_float: float
    counted_cash: Optional[float] = None
    expected_cash: Optional[float] = None
    variance: Optional[float] = None
    opened_by: str
    closed_by: Optional[str] = None
    opened_at: str
    closed_at: Optional[str] = None
    notes: Optional[str] = None
    status: Literal["open", "closed"] = "open"


class CashDrawerOpen(BaseModel):
    opening_float: float
    notes: Optional[str] = None


class CashDrawerClose(BaseModel):
    counted_cash: float
    notes: Optional[str] = None


# ---------- Tip pool ----------
class TipAllocation(BaseModel):
    user_id: str
    user_name: str
    hours: float
    share: float


class TipPool(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    shift_date: str  # YYYY-MM-DD
    total_pool: float
    allocations: List[TipAllocation]
    created_by: str
    at: str
    notes: Optional[str] = None


class TipPoolCreate(BaseModel):
    shift_date: str
    total_pool: float
    notes: Optional[str] = None
    # If user_ids omitted, server derives from clocked-in staff that day.
    user_ids: Optional[List[str]] = None


# ---------- Coupons ----------
CouponKind = Literal["percent", "flat"]


class Coupon(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    code: str
    kind: CouponKind
    value: float
    valid_from: Optional[str] = None  # ISO date
    valid_to: Optional[str] = None
    max_uses: Optional[int] = None
    used_count: int = 0
    min_subtotal: float = 0.0
    active: bool = True


class CouponCreate(BaseModel):
    code: str
    kind: CouponKind
    value: float
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    max_uses: Optional[int] = None
    min_subtotal: float = 0.0
    active: bool = True


class CouponUpdate(BaseModel):
    kind: Optional[CouponKind] = None
    value: Optional[float] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    max_uses: Optional[int] = None
    min_subtotal: Optional[float] = None
    active: Optional[bool] = None


class CouponApplyRequest(BaseModel):
    code: str
    subtotal: float


class CouponApplyResponse(BaseModel):
    code: str
    kind: CouponKind
    value: float
    discount: float
    new_total: float


# ---------- Locations (multi-store) ----------
class Location(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    store_number: Optional[str] = ""
    active: bool = True
    is_default: bool = False


class LocationCreate(BaseModel):
    name: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    store_number: Optional[str] = ""
    active: bool = True
    is_default: bool = False


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    store_number: Optional[str] = None
    active: Optional[bool] = None
    is_default: Optional[bool] = None


# ---------- Prep list ----------
class PrepListItem(BaseModel):
    inventory_id: str
    name: str
    unit: str
    on_hand: float
    needed: float
    shortfall: float


class PrepListResponse(BaseModel):
    generated_at: str
    horizon_hours: int
    items: List[PrepListItem]


# ---------- Refund / Void ----------
class RefundRequest(BaseModel):
    amount: float
    reason: str
    notes: Optional[str] = None


class VoidRequest(BaseModel):
    reason: str
    notes: Optional[str] = None


class RefundLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    order_id: str
    order_number: int
    kind: Literal["refund", "void"]
    amount: float
    reason: str
    notes: Optional[str] = None
    by_user_id: str
    by_user_name: str
    at: str


# ---------- Loyalty ----------
# Earn rate: 1 point per ₹100 spent. Redeem 1 point → ₹1 off (cap at order subtotal).
LOYALTY_EARN_DIVISOR = 100.0
LOYALTY_TIERS = (
    ("bronze", 0),
    ("silver", 5000),     # ₹5,000 lifetime spend
    ("gold", 20000),      # ₹20,000 lifetime spend
)


class LoyaltyTxn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    customer_id: str
    customer_name: str
    kind: Literal["earn", "redeem", "adjust"]
    points: int           # positive for earn, negative for redeem
    order_id: Optional[str] = None
    note: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


class LoyaltyAdjust(BaseModel):
    points: int  # can be negative
    note: str


# ---------- Reports: labour cost widget ----------
class LabourCostResponse(BaseModel):
    as_of: str
    today_cost: float
    currently_in_count: int
    currently_in: List[dict]  # [{user_id, user_name, role, hours_today, cost_today}]
    monthly_run_rate: float   # projects today's cost forward to a 30-day month


# ---------- Onboarding (first-run wizard) ----------
class OnboardingStatus(BaseModel):
    tenant_id: str
    completed: bool
    has_extra_staff: bool        # any user beyond the seeded 4 demo accounts
    has_real_orders: bool        # any order with payment != "unpaid"
    has_menu: bool
    has_location: bool
    dismissed_at: Optional[str] = None


class OnboardingDismiss(BaseModel):
    pass
