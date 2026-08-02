import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.generate_api_client import to_type


def test_openapi_binary_strings_generate_file_types() -> None:
    assert to_type({"type": "string", "format": "binary"}) == "File"


def test_openapi_content_media_type_strings_remain_strings() -> None:
    assert to_type({"type": "string", "contentMediaType": "application/json"}) == "string"


def test_fastapi_upload_schema_generates_a_file_type() -> None:
    from app.main import create_app

    upload_schema = create_app().openapi()["components"]["schemas"][
        "Body_upload_asset_api_cases__case_id__assets_post"
    ]["properties"]["file"]

    assert upload_schema["format"] == "binary"
    assert to_type(upload_schema) == "File"
