from app.models import status_to_step, STATUS_STEP


def test_status_to_step():
    assert status_to_step("analyzing") == 0
    assert status_to_step("fetching") == 1
    assert status_to_step("thumbnailing") == 2
    assert status_to_step("ready") == 3
    assert status_to_step("error") == -1


def test_status_step_map():
    assert STATUS_STEP == {
        "analyzing": 0,
        "fetching": 1,
        "thumbnailing": 2,
        "ready": 3,
        "error": -1,
    }


def test_status_to_step_unknown_defaults_to_error():
    # Unknown / unexpected statuses map to the error sentinel.
    assert status_to_step("bogus") == -1
