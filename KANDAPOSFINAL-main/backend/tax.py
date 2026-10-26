"""GST rate auto-suggestion + order-time tax computation for Kanda POS.

IMPORTANT: the default rates below are common-case starting points for Indian
GST, not authoritative tax advice. A tenant should confirm the correct rate
for their actual products with their own CA / GST practitioner — every rate
here is just a suggestion and is fully overridable per category and per menu
item once set (see Category.tax_rate / MenuItem.tax_rate in models.py).

Two different checkout conventions are modelled, matching how each vertical
actually prices in India:
  - Restaurant menu prices are tax-EXCLUSIVE: GST is added on top of the bill.
  - Retail MRP prices are tax-INCLUSIVE by law: GST is extracted out of the
    price the customer already sees, not added again on top of it.

GST is always split 50/50 into CGST + SGST (the standard intra-state split
for a single-location small business); inter-state IGST isn't modelled since
this app doesn't collect a customer's billing state.
"""
import math
from typing import Optional, List, Tuple, TypedDict

# Standalone restaurants (non-AC, no liquor licence, not part of a >Rs.7,500
# room-tariff hotel) attract a single flat 5% GST on food & beverage service
# under the most common composition, so every restaurant category defaults here.
RESTAURANT_DEFAULT_RATE = 5.0

# Retail: GST is product-classification (HSN) driven and varies by slab.
# Keyword-matched against the category name; first match wins. `None` marks
# apparel, which is price-banded rather than a flat rate (handled below).
_RETAIL_CATEGORY_RATES: List[Tuple[tuple, Optional[float]]] = [
    (("electronic", "gadget", "mobile", "computer"), 18.0),
    (("accessor",), 18.0),
    (("snack", "food", "grocery", "beverage", "drink"), 5.0),
    (("apparel", "clothing", "garment", "fashion"), None),
]
RETAIL_FALLBACK_RATE = 18.0  # most general-goods slab — safest generic default

# Apparel/clothing: <= Rs.1000 per piece is 5%, above that is 12%.
APPAREL_LOW_RATE = 5.0
APPAREL_HIGH_RATE = 12.0
APPAREL_PRICE_THRESHOLD = 1000.0


def is_price_banded(category_name: str, business_type: str) -> bool:
    """True when this category's rate genuinely depends on each item's own
    price (currently: retail apparel/clothing) rather than being flat for the
    whole category. Callers should NOT freeze a concrete category-level
    tax_rate for these — leave it unset so resolve_effective_rate() keeps
    re-deriving the rate per item at order time."""
    if business_type != "retail":
        return False
    name = (category_name or "").lower()
    return any(k in name for k in ("apparel", "clothing", "garment", "fashion"))


def suggest_tax_rate(category_name: str, business_type: str, item_price: Optional[float] = None) -> float:
    """Best-effort default GST % for a category (or a specific item's price,
    for price-banded categories like apparel). Always overridable — this is a
    starting point, not a compliance guarantee."""
    if business_type != "retail":
        return RESTAURANT_DEFAULT_RATE

    name = (category_name or "").lower()
    for keywords, rate in _RETAIL_CATEGORY_RATES:
        if any(k in name for k in keywords):
            if rate is None:  # apparel — price-banded
                price = item_price if item_price is not None else 0
                return APPAREL_LOW_RATE if price <= APPAREL_PRICE_THRESHOLD else APPAREL_HIGH_RATE
            return rate
    return RETAIL_FALLBACK_RATE


def resolve_effective_rate(
    item_tax_rate: Optional[float],
    category_tax_rate: Optional[float],
    category_name: str,
    business_type: str,
    item_price: Optional[float] = None,
) -> Tuple[float, str]:
    """Chain: explicit item override > explicit category override > auto-suggested.
    Returns (rate, source) where source is one of "item", "category", "auto"."""
    if item_tax_rate is not None:
        return item_tax_rate, "item"
    if category_tax_rate is not None:
        return category_tax_rate, "category"
    return suggest_tax_rate(category_name, business_type, item_price), "auto"


def collects_gst(tenant: Optional[dict]) -> bool:
    """Only a regular GST-registered store charges GST. Composition-scheme and
    unregistered stores may not, and issue a Bill of Supply instead."""
    return ((tenant or {}).get("store") or {}).get("gst_scheme", "regular") == "regular"


def compute_line_tax(price: float, qty: int, rate: float, inclusive: bool) -> Tuple[float, float]:
    """Given a line's unit price/qty and effective GST rate, return
    (taxable_value, tax_amount) for that line.

    - inclusive=True (retail MRP): price already includes tax — extract it.
    - inclusive=False (restaurant menu pricing): tax is added on top.
    """
    gross = round(price * qty, 2)
    if rate <= 0:
        return gross, 0.0
    if inclusive:
        taxable = round(gross / (1 + rate / 100), 2)
        tax = round(gross - taxable, 2)
        return taxable, tax
    tax = round(gross * rate / 100, 2)
    return gross, tax


class OrderTaxBreakdown(TypedDict):
    items_total: float  # what the item lines contribute to the grand total (gross for inclusive, taxable for exclusive)
    subtotal: float      # taxable value across all lines (net of tax either way)
    tax_total: float
    cgst: float
    sgst: float


def compute_order_tax(line_amounts: List[Tuple[float, float]]) -> OrderTaxBreakdown:
    """Aggregate per-line (taxable_value, tax_amount) pairs (from
    compute_line_tax) into an order-level GST breakdown."""
    subtotal = round(sum(t for t, _ in line_amounts), 2)
    tax_total = round(sum(x for _, x in line_amounts), 2)
    # gross (what the customer pays for the items) = taxable value + tax,
    # whether the tax was added on top or extracted from an inclusive price.
    items_total = round(subtotal + tax_total, 2)
    return {
        "items_total": items_total,
        "subtotal": subtotal,
        "tax_total": tax_total,
        "cgst": split_cgst_sgst(tax_total)[0],
        "sgst": split_cgst_sgst(tax_total)[1],
    }


def _paise(x: float) -> int:
    return int(round(float(x) * 100))


def apply_taxable_discount(subtotal: float, tax_total: float, discount, inclusive: bool) -> Tuple[float, float, float]:
    """Take a discount off the taxable value, then re-derive the GST on what's
    left → (subtotal, tax_total, items_total) after the discount.

    GST is charged on the value actually supplied, so a bill discount or
    coupon lowers the tax too (tax is scaled by the same factor as the base,
    which is exact because every line keeps its own rate). Restaurant
    (exclusive) menus take the discount off the pre-tax subtotal; retail
    (inclusive) MRP takes it off the gross. Done in integer paise with
    half-up rounding so the frontend's mirror (utils/tax.js
    applyTaxableDiscount) lands on exactly the same figures. Clamped to
    [0, base]; a missing/negative discount is a no-op."""
    sub_p, tax_p = _paise(subtotal), _paise(tax_total)
    base_p = sub_p + tax_p if inclusive else sub_p
    d_p = max(0, min(_paise(discount or 0), base_p))
    if d_p == 0 or base_p == 0:
        return round(sub_p / 100, 2), round(tax_p / 100, 2), round((sub_p + tax_p) / 100, 2)
    left_p = base_p - d_p
    new_tax_p = (tax_p * left_p * 2 + base_p) // (2 * base_p)  # round half up
    if inclusive:
        new_sub_p = left_p - new_tax_p
        items_p = left_p
    else:
        new_sub_p = left_p
        items_p = left_p + new_tax_p
    return round(new_sub_p / 100, 2), round(new_tax_p / 100, 2), round(items_p / 100, 2)


def split_cgst_sgst(tax_total: float) -> Tuple[float, float]:
    """Intra-state 50/50 split, with any odd paisa going to SGST. Integer
    paise (not float round()) so the screen, receipt and server always agree
    — 19.95 is 9.97 + 9.98 everywhere."""
    total_p = _paise(tax_total)
    cgst_p = total_p // 2
    return round(cgst_p / 100, 2), round((total_p - cgst_p) / 100, 2)


def compute_service_charge(subtotal: float, tax_total: float, pct: float) -> Tuple[float, float]:
    """Optional restaurant service charge → (charge, gst_on_charge).

    The charge is `pct` of the taxable item subtotal. A service charge is
    part of the value of the supply for GST, so it is taxed at the bill's own
    effective rate (tax_total / subtotal — the flat 5% for a typical
    restaurant bill)."""
    if not pct or pct <= 0 or subtotal <= 0:
        return 0.0, 0.0
    charge = round(subtotal * pct / 100, 2)
    return charge, round(charge * tax_total / subtotal, 2)


def apply_cash_round_off(total: float, payment: str, enabled: bool):
    """(total, round_off). Only an all-cash bill is rounded, to the nearest
    rupee (half up); card/UPI/split amounts must match the processor exactly."""
    if not enabled or payment != "cash":
        return total, 0.0
    rounded = float(math.floor(total + 0.5 + 1e-9))
    return rounded, round(rounded - total, 2)
