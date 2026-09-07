import asyncio

import pytest
from fastapi import HTTPException

from app.routes.cases import upload_asset


def test_plain_text_asset_uploads_are_disabled() -> None:
    with pytest.raises(HTTPException) as error:
        asyncio.run(upload_asset("case-1", object(), object()))  # type: ignore[arg-type]

    assert error.value.status_code == 410
    assert "disabled" in str(error.value.detail).lower()
