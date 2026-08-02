import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.generate_api_client import (
    extract_operation_spec,
    render_upload_asset,
    to_type,
)


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


def test_operation_helpers_follow_openapi_parameter_body_and_response_metadata() -> None:
    schema = {
        "components": {
            "schemas": {
                "UploadRequest": {
                    "type": "object",
                    "required": ["upload"],
                    "properties": {
                        "upload": {"type": "string", "format": "binary"},
                    },
                },
                "AssetResult": {"type": "object", "properties": {}},
                "CreatePayload": {
                    "type": "object",
                    "properties": {"script": {"type": "string"}},
                },
                "CaseResult": {"type": "object", "properties": {}},
            }
        },
        "paths": {
            "/api/cases/{id}/assets": {
                "post": {
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        },
                    ],
                    "requestBody": {
                        "content": {
                            "multipart/form-data": {
                                "schema": {"$ref": "#/components/schemas/UploadRequest"}
                            }
                        }
                    },
                    "responses": {
                        "201": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AssetResult"}
                                }
                            }
                        }
                    },
                }
            },
            "/api/cases": {
                "post": {
                    "parameters": [
                        {
                            "name": "page_size",
                            "in": "query",
                            "schema": {"type": "integer", "default": 7},
                        }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CreatePayload"}
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CaseResult"}
                                }
                            }
                        }
                    },
                }
            }
        },
    }

    operation = extract_operation_spec(schema, "/api/cases/{id}/assets", "post")

    assert operation.path_parameters[0].name == "id"
    assert operation.multipart_field == "upload"
    assert operation.response_type == "AssetResult"
    rendered = render_upload_asset(operation)
    assert "body.append('upload', upload);" in rendered
    assert "encodeURIComponent(id)" in rendered

    json_operation = extract_operation_spec(schema, "/api/cases", "post")
    assert json_operation.json_body_component == "CreatePayload"
    assert json_operation.query_parameters[0].name == "page_size"
    assert json_operation.query_parameters[0].type == "number"
    assert json_operation.query_parameters[0].default == 7
