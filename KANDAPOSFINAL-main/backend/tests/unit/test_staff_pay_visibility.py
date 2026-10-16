"""Master Test Report P1: /api/staff returned every employee's salary to a
dashboard manager who has no payroll permission (Payroll itself 403s)."""
from routes.staff import can_see_pay, _to_public

DOC = {"id": "s1", "name": "A B", "role": "Cashier", "monthly_pay": 25000, "hourly_rate": 100, "pay_type": "monthly"}


def test_dash_user_without_payroll_cannot_see_pay():
    assert not can_see_pay({"dash": True, "permissions": {"staff": True, "payroll": False}})
    assert not can_see_pay({"dash": True, "permissions": {}})


def test_dash_user_with_payroll_and_pos_staff_can():
    assert can_see_pay({"dash": True, "permissions": {"payroll": True}})
    assert can_see_pay({"role": "Manager"})  # PIN-login store manager


def test_to_public_strips_pay_when_hidden():
    hidden = _to_public(DOC, show_pay=False)
    assert hidden["monthly_pay"] is None and hidden["hourly_rate"] is None
    assert hidden["pay_visible"] is False
    shown = _to_public(DOC)
    assert shown["monthly_pay"] == 25000 and shown["pay_visible"] is True
