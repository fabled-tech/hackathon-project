import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.generate_api_client import (
    extract_operation_spec,
    render_create_case,
    render_list_cases,
    render_update_finding_status,
    render_upload_asset,
    to_type,
)


def test_openapi_binary_strings_generate_file_types() -> None:
    assert to_type({"type": "string", "format": "binary"}) == "File"


def test_openapi_content_media_type_strings_remain_strings() -> None:
    assert to_type({"type": "string", "contentMediaType": "application/json"}) == "string"


def test_nullable_references_generate_null_unions() -> None:
    assert (
        to_type(
            {
                "anyOf": [
                    {"$ref": "#/components/schemas/Evidence"},
                    {"type": "null"},
                ]
            }
        )
        == "Evidence | null"
    )


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


def test_rendered_helpers_follow_mutated_openapi_wire_contracts() -> None:
    schema = {
        "components": {
            "schemas": {
                "CaseSubmission": {
                    "type": "object",
                    "required": ["screenplay"],
                    "properties": {"screenplay": {"type": "string"}},
                },
                "AcceptedCase": {"type": "object", "properties": {}},
                "HistoryEntry": {"type": "object", "properties": {}},
                "DecisionChange": {
                    "type": "object",
                    "required": ["decision_code"],
                    "properties": {
                        "decision_code": {"$ref": "#/components/schemas/DecisionCode"}
                    },
                },
                "DecisionCode": {"type": "string", "enum": ["keep", "remove"]},
                "UpdatedAlert": {"type": "object", "properties": {}},
            }
        },
        "paths": {
            "/case-submissions": {
                "put": {
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CaseSubmission"}
                            }
                        }
                    },
                    "responses": {
                        "202": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/AcceptedCase"}
                                }
                            }
                        }
                    },
                }
            },
            "/case-history": {
                "post": {
                    "parameters": [
                        {
                            "name": "page_size",
                            "in": "query",
                            "schema": {"type": "integer", "default": 42},
                        }
                    ],
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/components/schemas/HistoryEntry"
                                        },
                                    }
                                }
                            }
                        }
                    },
                }
            },
            "/reviews/{review_id}/alerts/{alert_id}": {
                "put": {
                    "parameters": [
                        {
                            "name": "review_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        },
                        {
                            "name": "alert_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        },
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/DecisionChange"}
                            }
                        }
                    },
                    "responses": {
                        "201": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/UpdatedAlert"}
                                }
                            }
                        }
                    },
                }
            },
        },
    }

    create_rendered = render_create_case(
        extract_operation_spec(schema, "/case-submissions", "put")
    )
    list_rendered = render_list_cases(
        extract_operation_spec(schema, "/case-history", "post")
    )
    update_rendered = render_update_finding_status(
        extract_operation_spec(schema, "/reviews/{review_id}/alerts/{alert_id}", "put")
    )

    assert "payload: CaseSubmission" in create_rendered
    assert "request<AcceptedCase>('/case-submissions'" in create_rendered
    assert "method: 'PUT'" in create_rendered
    assert "body: JSON.stringify(payload)" in create_rendered

    assert "pageSize: number = 42" in list_rendered
    assert "'?page_size=' + encodeURIComponent(pageSize)" in list_rendered
    assert "method: 'POST'" in list_rendered
    assert "request<HistoryEntry[]>" in list_rendered

    assert "reviewId: string" in update_rendered
    assert "alertId: string" in update_rendered
    assert "decisionCode: DecisionCode" in update_rendered
    assert "encodeURIComponent(reviewId)" in update_rendered
    assert "encodeURIComponent(alertId)" in update_rendered
    assert "method: 'PUT'" in update_rendered
    assert "body: JSON.stringify({ decision_code: decisionCode })" in update_rendered
    assert "request<UpdatedAlert>" in update_rendered
