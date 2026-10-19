"""Master Test Report P1: a location phone of "abcd" was accepted."""
import pytest
from pydantic import ValidationError

from models import LocationCreate, LocationUpdate


def test_bad_phone_rejected():
    with pytest.raises(ValidationError):
        LocationCreate(name="Main", phone="abcd")
    with pytest.raises(ValidationError):
        LocationUpdate(phone="abcd")


def test_blank_or_valid_phone_ok():
    assert LocationCreate(name="Main").phone == ""
    assert LocationCreate(name="Main", phone="+91 98765 43210").phone
    assert LocationUpdate(phone="").phone == ""
