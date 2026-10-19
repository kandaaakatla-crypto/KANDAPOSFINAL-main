"""The AI phone agent answered in Telugu (Telangana dialect) unless a store
changed the setting, and its fallback greeting was Telugu even for stores set
to English. Launch restaurants aren't all Telugu-speaking, so the default is
now English, the greeting follows the chosen language, and auto-detect starts
in English.
"""
from routes.voice import DEFAULT_VOICE_CONFIG, _system_instructions


def _t(lang=None):
    voice = {} if lang is None else {"default_language": lang}
    return {"id": "t", "name": "Spice Hub", "store": {"name": "Spice Hub"}, "voice": voice}


def test_default_language_is_english():
    assert DEFAULT_VOICE_CONFIG["default_language"] == "en"
    text = _system_instructions(_t(), "menu")
    assert "Indian English" in text
    assert "Thanks for calling Spice Hub" in text


def test_greeting_follows_the_chosen_language():
    assert "Thanks for calling Spice Hub" in _system_instructions(_t("en"), "menu")
    assert "కాల్ చేసినందుకు" in _system_instructions(_t("te"), "menu")


def test_auto_detect_starts_in_english():
    text = _system_instructions(_t("auto"), "menu")
    assert "Start speaking in ENGLISH" in text
