"""Pydantic models for Kanda POS."""
from __future__ import annotations
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


OrderType = Literal["delivery", "collection", "dine-in", "sale"]
OrderStatus = Literal["new", "in-kitchen", "ready", "out-for-delivery", "completed"]
OrderPayment = Literal["cash", "card", "unpaid"]
TableStatus = Literal["available", "occupied", "reserved"]
OrderSource = Literal["in-store", "phone", "swiggy", "zomato", "other", "qr", "website"]
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
    brandId: Optional[str] = None
    # Receipt branding (name/address/phone/tax_id/footer/logo_url) — exposed
    # here so the POS can cache it and build a receipt fully offline
    # (see frontend/src/utils/escpos.js) instead of needing a network round
    # trip to GET /orders/{id}/receipt every time.
    store: Optional[dict] = None


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


# ---------- Brands (franchise / multi-store grouping) ----------
class BrandStoreDefaults(BaseModel):
    """Brand-wide defaults an owner can push out to every member store.
    Pushing is an explicit action, not continuous enforcement — a franchisee
    store keeps whatever it has until the owner pushes again."""
    features: Optional[dict] = None  # subset of TenantFeatures keys -> bool
    store_footer: Optional[str] = None  # receipt footer text
    logo_url: Optional[str] = None


class Brand(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    slug: str
    name: str
    logo_url: Optional[str] = None
    royalty_percent: float = 0.0  # default % of sales owed by member stores, per-tenant overridable
    defaults: BrandStoreDefaults = BrandStoreDefaults()
    created_at: str


class BrandCreate(BaseModel):
    slug: str
    name: str
    logo_url: Optional[str] = None
    royalty_percent: float = 0.0


class BrandUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    royalty_percent: Optional[float] = None
    defaults: Optional[BrandStoreDefaults] = None


class BrandAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand_id: str
    kind: Literal["image", "text"] = "image"
    title: str
    content: str  # image URL for kind="image", promo copy for kind="text"
    created_at: str
    created_by: str


class BrandAssetCreate(BaseModel):
    kind: Literal["image", "text"] = "image"
    title: str
    content: str


class BrandStoreCreate(BaseModel):
    """Create a new franchisee store under a brand, from the Dashboard (not
    the Platform Owner's Owner Portal) — mirrors TenantCreateRequest in
    owner_routes.py but scoped to the requesting brand owner."""
    slug: str
    name: str
    contact_email: str
    store: dict  # {name, address, phone, tax_id}
    manager_name: str = "Manager"
    manager_pin: str
    business_type: BusinessType = "restaurant"
    apply_brand_defaults: bool = True


class BrandSmsBroadcast(BaseModel):
    body: str


BrandInviteStatus = Literal["pending", "accepted", "declined", "cancelled"]


class BrandInvite(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand_id: str
    brand_name: str
    tenant_id: str
    tenant_slug: str
    tenant_name: str
    status: BrandInviteStatus = "pending"
    invited_by: str
    created_at: str
    responded_at: Optional[str] = None


class BrandInviteCreate(BaseModel):
    tenant_slug: str


# ---------- Royalty invoices ----------
RoyaltyInvoiceStatus = Literal["pending", "paid", "void"]


class RoyaltyInvoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand_id: str
    tenant_id: str
    store_name: str
    period_start: str
    period_end: str
    sales: float
    royalty_percent: float
    amount: float
    status: RoyaltyInvoiceStatus = "pending"
    created_at: str
    paid_at: Optional[str] = None


class RoyaltyInvoiceGenerate(BaseModel):
    start: str
    end: str


class RoyaltyInvoiceStatusUpdate(BaseModel):
    status: RoyaltyInvoiceStatus


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
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)
    deleted_at: Optional[str] = None  # soft-delete tombstone; None while active


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
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)
    deleted_at: Optional[str] = None  # soft-delete tombstone; None while active


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


# ---------- Menu schedules (day-part menus + time-based pricing) ----------
# A schedule owns its own set of categories/items — assign membership from
# the schedule's Dashboard screen rather than editing each menu item.
class MenuSchedule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    days: List[int] = []  # ISO weekday: 1=Mon..7=Sun; empty = every day
    start_time: str  # "HH:MM" 24h
    end_time: str  # "HH:MM" 24h; may be < start_time for an overnight window
    active: bool = True
    restrict_availability: bool = False  # if True, member items are hidden outside the window (day-part menu)
    pricing_mode: Literal["none", "percent", "fixed"] = "none"
    discount_pct: Optional[float] = None  # used when pricing_mode == "percent"
    fixed_price: Optional[float] = None  # used when pricing_mode == "fixed" — flat ₹ price for every member item
    category_ids: List[str] = []  # every item in these categories is a member
    item_ids: List[str] = []  # individually-added members (e.g. one item from an otherwise-excluded category)
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)
    deleted_at: Optional[str] = None  # soft-delete tombstone; None while active


class MenuScheduleCreate(BaseModel):
    name: str
    days: List[int] = []
    start_time: str
    end_time: str
    active: bool = True
    restrict_availability: bool = False
    pricing_mode: Literal["none", "percent", "fixed"] = "none"
    discount_pct: Optional[float] = None
    fixed_price: Optional[float] = None
    category_ids: List[str] = []
    item_ids: List[str] = []


class MenuScheduleUpdate(BaseModel):
    name: Optional[str] = None
    days: Optional[List[int]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    active: Optional[bool] = None
    restrict_availability: Optional[bool] = None
    pricing_mode: Optional[Literal["none", "percent", "fixed"]] = None
    discount_pct: Optional[float] = None
    fixed_price: Optional[float] = None
    category_ids: Optional[List[str]] = None
    item_ids: Optional[List[str]] = None


# ---------- Aggregator surge / peak pricing ----------
AggregatorChannel = Literal["swiggy", "zomato", "other"]
_HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"


class SurgeRule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    # Which aggregators the markup applies to. One channel = that aggregator
    # only; several (or all) = one combined rule across them. Every active
    # rule matching an order's source stacks (percentages add up).
    channels: List[AggregatorChannel]
    pct: float  # markup % on each line price
    days: List[int] = []  # ISO weekday: 1=Mon..7=Sun; empty = every day
    start_time: Optional[str] = None  # "HH:MM" IST; None (with end_time None) = all day
    end_time: Optional[str] = None  # may be < start_time for an overnight window
    active: bool = True
    updated_at: Optional[str] = None


class SurgeRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    channels: List[AggregatorChannel] = Field(min_length=1)
    pct: float = Field(ge=0.01, le=100)
    days: List[int] = []
    start_time: Optional[str] = Field(None, pattern=_HHMM)
    end_time: Optional[str] = Field(None, pattern=_HHMM)
    active: bool = True


class SurgeRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    channels: Optional[List[AggregatorChannel]] = Field(None, min_length=1)
    pct: Optional[float] = Field(None, ge=0.01, le=100)
    days: Optional[List[int]] = None
    start_time: Optional[str] = Field(None, pattern=_HHMM)
    end_time: Optional[str] = Field(None, pattern=_HHMM)
    all_day: bool = False  # clears start_time/end_time (None can't be sent through exclude_none)
    active: Optional[bool] = None


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
    birthday: Optional[str] = None  # "MM-DD" — month+day only, no birth year stored
    store_credit: float = 0.0  # ₹ wallet balance — refunds-to-credit + manual top-ups
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)
    deleted_at: Optional[str] = None  # soft-delete tombstone; None while active


class CustomerCreate(BaseModel):
    name: str
    phone: str
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    notes: Optional[str] = ""
    email: Optional[str] = ""
    birthday: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    notes: Optional[str] = None
    email: Optional[str] = None
    birthday: Optional[str] = None


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
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)


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
    seats: Optional[int] = Field(None, ge=1, le=50)  # edited in the layout editor's side panel


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
    expiry_date: Optional[str] = None  # ISO date (YYYY-MM-DD), batch-level tracking not modeled
    location_id: Optional[str] = None  # None = shared/unassigned pool, not tied to one outlet
    updated_at: Optional[str] = None  # for offline-client delta sync (?since=)
    deleted_at: Optional[str] = None  # soft-delete tombstone; None while active


class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1, pattern=r"\S")
    unit: str = Field(min_length=1)
    stock: float = Field(0, ge=0)
    reorder: float = Field(0, ge=0)
    supplier: str = ""
    cost_per_unit: float = Field(0.0, ge=0)
    expiry_date: Optional[str] = None
    location_id: Optional[str] = None


class InventoryItemUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    reorder: Optional[float] = Field(None, ge=0)
    supplier: Optional[str] = None
    cost_per_unit: Optional[float] = Field(None, ge=0)
    expiry_date: Optional[str] = None  # explicit null clears it; omitted leaves it unchanged
    location_id: Optional[str] = None  # explicit null clears it (moves to shared pool); omitted leaves it unchanged


# ---------- Stock transfers (between locations, or from a brand's central supply) ----------
class StockTransfer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    item_name: str
    unit: str
    qty: float
    from_location_id: Optional[str] = None  # None = shared/unassigned pool
    to_location_id: Optional[str] = None
    source: str = "location"  # "location" (in-store transfer) or "brand_supply" (central warehouse push)
    note: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


class StockTransferCreate(BaseModel):
    to_location_id: Optional[str] = None  # None = move to the shared/unassigned pool
    qty: float
    note: Optional[str] = None


# ---------- Brand central supply — a warehouse catalog the brand owner stocks
# and pushes out to member stores, since each store is its own tenant with
# its own independent inventory collection. ----------
class CentralSupplyItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand_id: str
    name: str
    unit: str
    stock: float = 0.0
    cost_per_unit: float = 0.0
    reorder: float = 0.0


class CentralSupplyItemCreate(BaseModel):
    name: str
    unit: str
    stock: float = 0.0
    cost_per_unit: float = 0.0
    reorder: float = 0.0


class CentralSupplyItemUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    cost_per_unit: Optional[float] = None
    reorder: Optional[float] = None


class CentralSupplyRestock(BaseModel):
    delta: float  # positive to add stock at the central warehouse


class SupplyPush(BaseModel):
    tenant_ids: List[str]  # target stores to push to
    qty_per_store: float
    note: Optional[str] = None


class SupplyLogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand_id: str
    central_item_id: str
    item_name: str
    unit: str
    tenant_id: str
    store_name: str
    qty: float
    note: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


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
    email: Optional[str] = None
    gstin: Optional[str] = None  # buyer's GSTIN, printed on the tax invoice for B2B customers


class OrderItem(BaseModel):
    name: str
    qty: int
    price: float
    mods: List[str] = []
    size: Optional[str] = None
    tax_rate: Optional[float] = None  # resolved GST % for this line, stamped server-side
    tax_amount: Optional[float] = None  # resolved GST amount for this line, stamped server-side
    # Aggregator surge: `price` is already the surged price the POS charged;
    # these record the pre-surge price and the % applied, for reporting.
    base_price: Optional[float] = None
    surge_pct: Optional[float] = None


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
    service_charge_pct: float = Field(0, ge=0, le=100)  # optional, off unless the customer agrees to it
    redeem_loyalty_points: int = 0  # cashier elects to burn X points → ₹X off
    redeem_store_credit: float = 0  # ₹ amount to burn from the customer's own wallet balance
    gift_card_code: Optional[str] = None
    gift_card_amount: float = 0  # ₹ amount to redeem against gift_card_code
    # Split payment: list of {method, amount} that sums to total when supplied.
    splits: Optional[List["OrderSplit"]] = None
    # Client-generated idempotency key for offline-queued order creation — a
    # retried POST with the same client_ref returns the already-created order
    # instead of creating a duplicate. None for normal online order creation.
    client_ref: Optional[str] = None


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
    store_credit_redeemed: float = 0
    gift_card_code: Optional[str] = None
    gift_card_redeemed: float = 0
    splits: Optional[List[OrderSplit]] = None
    packed: bool = False
    # GST breakdown, computed server-side at checkout (see tax.py).
    subtotal: float = 0
    taxTotal: float = 0
    cgst: float = 0
    sgst: float = 0
    taxInclusive: bool = False  # True when item prices already included tax (retail MRP) and it was extracted, not added on top
    # Optional service charge — 0 unless staff add it at the customer's request.
    # serviceChargeTax (GST on the charge) is already included in taxTotal/cgst/sgst.
    serviceChargePct: float = 0
    serviceCharge: float = 0
    serviceChargeTax: float = 0
    surgeAmount: float = 0  # ₹ aggregator surge added to line prices (sum of (price - base_price) * qty)
    client_ref: Optional[str] = None  # idempotency key, set when this order was created offline and later synced
    sync_warnings: List[str] = []  # non-fatal issues found when replaying an offline-queued order (e.g. item since deleted)


class OrderStatusPayload(BaseModel):
    status: OrderStatus


class OrderPackedPayload(BaseModel):
    packed: bool


class ServiceChargePayload(BaseModel):
    pct: float = Field(ge=0, le=100)


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
    refund_method: Literal["original", "store_credit"] = "original"


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
# Defaults mirror the program's original hardcoded rates (1pt/₹100 earned,
# 1pt=₹1 redeemed, Silver/Gold at ₹5k/₹20k lifetime spend) — every tenant
# starts here but can customize via LoyaltyConfig (GET/PUT /loyalty/config).
class LoyaltyConfig(BaseModel):
    earn_rate: float = Field(default=100.0, gt=0)          # ₹ spent per 1 point earned
    redeem_value: float = Field(default=1.0, gt=0)         # ₹ discount per point redeemed
    silver_threshold: float = Field(default=5000.0, ge=0)  # ₹ lifetime spend for Silver
    gold_threshold: float = Field(default=20000.0, ge=0)   # ₹ lifetime spend for Gold
    welcome_bonus_points: int = Field(default=0, ge=0)     # granted when a new customer is added
    silver_multiplier: float = Field(default=1.0, ge=1.0)  # earn-rate multiplier for Silver members
    gold_multiplier: float = Field(default=1.0, ge=1.0)    # earn-rate multiplier for Gold members
    birthday_bonus_points: int = Field(default=0, ge=0)    # granted once a year on the customer's birthday


class LoyaltyTxn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    customer_id: str
    customer_name: str
    kind: Literal["earn", "redeem", "adjust", "bonus"]
    points: int           # positive for earn, negative for redeem
    order_id: Optional[str] = None
    note: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


class LoyaltyAdjust(BaseModel):
    points: int  # can be negative
    note: str


# ---------- Store credit ----------
class CreditTxn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    customer_id: str
    customer_name: str
    kind: Literal["topup", "redeem", "adjust", "refund"]
    amount: float  # positive for topup/refund/adjust-up, negative for redeem/adjust-down
    order_id: Optional[str] = None
    note: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


class StoreCreditAdjust(BaseModel):
    amount: float  # can be negative
    note: str


# ---------- Gift cards ----------
GiftCardStatus = Literal["active", "redeemed", "cancelled"]


class GiftCard(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    code: str
    initial_value: float
    balance: float
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_email: Optional[str] = None
    purchaser_name: Optional[str] = None
    status: GiftCardStatus = "active"
    created_at: str
    created_by: Optional[str] = None
    expires_at: Optional[str] = None
    redeemed_at: Optional[str] = None


class GiftCardCreate(BaseModel):
    value: float
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_email: Optional[str] = None
    purchaser_name: Optional[str] = None
    expires_at: Optional[str] = None


class GiftCardTxn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    gift_card_id: str
    code: str
    kind: Literal["issue", "redeem", "cancel"]
    amount: float
    order_id: Optional[str] = None
    by_user_id: Optional[str] = None
    by_user_name: Optional[str] = None
    at: str


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
