#!/usr/bin/env python3
"""Generate the minimal browser client directly from FastAPI's OpenAPI document."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api"))

# Contract generation never initializes configured cloud integrations.
os.environ["RIGHTSRADAR_MODE"] = "mock"

from app.main import create_app  # noqa: E402

OUTPUT = REPOSITORY_ROOT / "packages" / "api-client" / "src" / "generated.ts"


@dataclass(frozen=True)
class ParameterSpec:
    name: str
    location: str
    type: str
    default: Any | None = None

    @property
    def argument_name(self) -> str:
        parts = self.name.split("_")
        return parts[0] + "".join(part.capitalize() for part in parts[1:])


@dataclass(frozen=True)
class OperationSpec:
    path: str
    method: str
    path_parameters: tuple[ParameterSpec, ...]
    query_parameters: tuple[ParameterSpec, ...]
    json_body_component: str | None
    json_body_fields: tuple[ParameterSpec, ...]
    multipart_field: str | None
    response_type: str


def to_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", maxsplit=1)[-1]
    if "anyOf" in schema:
        return " | ".join(to_type(item) for item in schema["anyOf"])
    if schema.get("type") == "array":
        item_type = to_type(schema.get("items", {}))
        return f"({item_type})[]" if " | " in item_type else f"{item_type}[]"
    if schema.get("type") == "string" and schema.get("format") == "binary":
        return "File"
    if schema.get("type") == "integer" or schema.get("type") == "number":
        return "number"
    if schema.get("type") == "boolean":
        return "boolean"
    if schema.get("type") == "null":
        return "null"
    if schema.get("type") == "string":
        return "string"
    if schema.get("type") == "object":
        return "Record<string, unknown>"
    return "unknown"


def render_component(name: str, schema: dict[str, Any]) -> str:
    if "enum" in schema:
        values = " | ".join(json.dumps(value) for value in schema["enum"])
        return f"export type {name} = {values};"
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    lines = [f"export interface {name} {{"]
    for property_name, property_schema in properties.items():
        optional = "" if property_name in required else "?"
        lines.append(f"  {property_name}{optional}: {to_type(property_schema)};")
    lines.append("}")
    return "\n".join(lines)


def _resolve_reference(schema: dict[str, Any], document: dict[str, Any]) -> dict[str, Any]:
    if "$ref" not in schema:
        return schema
    reference = schema["$ref"]
    if not reference.startswith("#/components/"):
        raise RuntimeError(f"Unsupported OpenAPI reference: {reference}")
    value: Any = document
    for segment in reference.removeprefix("#/").split("/"):
        value = value[segment]
    if not isinstance(value, dict):
        raise RuntimeError(f"OpenAPI reference did not resolve to an object: {reference}")
    return value


def _component_name(schema: dict[str, Any]) -> str | None:
    reference = schema.get("$ref")
    if not isinstance(reference, str):
        return None
    return reference.rsplit("/", maxsplit=1)[-1]


def _parameter_specs(
    parameters: list[dict[str, Any]], document: dict[str, Any]
) -> tuple[ParameterSpec, ...]:
    specs: list[ParameterSpec] = []
    for parameter in parameters:
        resolved = _resolve_reference(parameter, document)
        parameter_schema = resolved.get("schema", {})
        resolved_parameter_schema = _resolve_reference(parameter_schema, document)
        specs.append(
            ParameterSpec(
                name=resolved["name"],
                location=resolved["in"],
                type=to_type(parameter_schema),
                default=resolved_parameter_schema.get("default"),
            )
        )
    return tuple(specs)


def _request_body_spec(
    operation: dict[str, Any], document: dict[str, Any]
) -> tuple[str | None, tuple[ParameterSpec, ...], str | None]:
    request_body = operation.get("requestBody")
    if not isinstance(request_body, dict):
        return None, (), None
    content = _resolve_reference(request_body, document).get("content", {})
    if not isinstance(content, dict):
        return None, (), None
    if "application/json" in content:
        body_schema = content["application/json"].get("schema", {})
        component = _component_name(body_schema)
        resolved = _resolve_reference(body_schema, document)
        fields = _parameter_specs(
            [
                {
                    "name": name,
                    "in": "body",
                    "schema": property_schema,
                }
                for name, property_schema in resolved.get("properties", {}).items()
            ],
            document,
        )
        return component, fields, None
    if "multipart/form-data" in content:
        body_schema = content["multipart/form-data"].get("schema", {})
        resolved = _resolve_reference(body_schema, document)
        binary_fields = [
            name
            for name, property_schema in resolved.get("properties", {}).items()
            if to_type(_resolve_reference(property_schema, document)) == "File"
        ]
        if len(binary_fields) != 1:
            raise RuntimeError("Expected exactly one binary multipart field")
        return None, (), binary_fields[0]
    raise RuntimeError("Unsupported request content type")


def _success_response_type(operation: dict[str, Any], document: dict[str, Any]) -> str:
    for status_code, response in operation.get("responses", {}).items():
        if not str(status_code).startswith("2"):
            continue
        content = _resolve_reference(response, document).get("content", {})
        if "application/json" in content:
            return to_type(content["application/json"].get("schema", {}))
    raise RuntimeError("Operation is missing a JSON success response")


def extract_operation_spec(
    schema: dict[str, Any], path: str, method: str
) -> OperationSpec:
    path_item = schema["paths"].get(path)
    if not isinstance(path_item, dict) or method not in path_item:
        raise RuntimeError(f"OpenAPI operation is missing: {method.upper()} {path}")
    operation = path_item[method]
    parameters = _parameter_specs(
        [*path_item.get("parameters", []), *operation.get("parameters", [])], schema
    )
    body_component, body_fields, multipart_field = _request_body_spec(operation, schema)
    return OperationSpec(
        path=path,
        method=method.upper(),
        path_parameters=tuple(item for item in parameters if item.location == "path"),
        query_parameters=tuple(item for item in parameters if item.location == "query"),
        json_body_component=body_component,
        json_body_fields=body_fields,
        multipart_field=multipart_field,
        response_type=_success_response_type(operation, schema),
    )


def _operation_by_id(schema: dict[str, Any], operation_id: str) -> OperationSpec:
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if isinstance(operation, dict) and operation.get("operationId") == operation_id:
                return extract_operation_spec(schema, path, method)
    raise RuntimeError(f"OpenAPI operation is missing operationId: {operation_id}")


def _render_path(operation: OperationSpec) -> str:
    pieces: list[str] = []
    remaining = operation.path
    for parameter in operation.path_parameters:
        marker = "{" + parameter.name + "}"
        before, found, remaining = remaining.partition(marker)
        if not found:
            raise RuntimeError(f"Path parameter is not present in path: {parameter.name}")
        if before:
            pieces.append(repr(before))
        pieces.append(f"encodeURIComponent({parameter.argument_name})")
    if remaining:
        pieces.append(repr(remaining))
    return " + ".join(pieces) or "''"


def _render_parameters(parameters: tuple[ParameterSpec, ...]) -> str:
    return "\n".join(
        f"  {parameter.argument_name}: {parameter.type}"
        + (
            f" = {json.dumps(parameter.default)}"
            if parameter.default is not None and parameter.location == "query"
            else ""
        )
        + ","
        for parameter in parameters
    )


def _require_json_body(operation: OperationSpec) -> str:
    if operation.json_body_component is None:
        raise RuntimeError("Expected an application/json request body component")
    return operation.json_body_component


def render_create_case(operation: OperationSpec) -> str:
    body_type = _require_json_body(operation)
    return f"""export function createCase(
  payload: {body_type},
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  return request<{operation.response_type}>({_render_path(operation)}, baseUrl, {{
    method: '{operation.method}',
    headers: {{ 'Content-Type': 'application/json' }},
    body: JSON.stringify(payload)
  }}, fetcher);
}}"""


def render_get_case(operation: OperationSpec) -> str:
    return f"""export function getCase(
{_render_parameters(operation.path_parameters)}
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  return request<{operation.response_type}>({_render_path(operation)}, baseUrl, {{ method: '{operation.method}' }}, fetcher);
}}"""


def render_list_cases(operation: OperationSpec) -> str:
    if len(operation.query_parameters) != 1:
        raise RuntimeError("Expected exactly one case-list query parameter")
    query = operation.query_parameters[0]
    return f"""export function listCases(
{_render_parameters((query,))}
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  return request<{operation.response_type}>(
    {_render_path(operation)} + '?{query.name}=' + encodeURIComponent({query.argument_name}),
    baseUrl,
    {{ method: '{operation.method}' }},
    fetcher
  );
}}"""


def render_upload_asset(operation: OperationSpec) -> str:
    if operation.multipart_field is None:
        raise RuntimeError("Expected a multipart upload field")
    field = operation.multipart_field
    argument = ParameterSpec(field, "body", "File").argument_name
    return f"""export function uploadAsset(
{_render_parameters(operation.path_parameters)}
  {argument}: File,
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  const body = new FormData();
  body.append('{field}', {argument});
  return request<{operation.response_type}>(
    {_render_path(operation)},
    baseUrl,
    {{ method: '{operation.method}', body }},
    fetcher
  );
}}"""


def render_list_assets(operation: OperationSpec) -> str:
    return f"""export function listAssets(
{_render_parameters(operation.path_parameters)}
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  return request<{operation.response_type}>(
    {_render_path(operation)},
    baseUrl,
    {{ method: '{operation.method}' }},
    fetcher
  );
}}"""


def render_update_finding_status(operation: OperationSpec) -> str:
    _require_json_body(operation)
    if len(operation.json_body_fields) != 1:
        raise RuntimeError("Expected exactly one finding-status request field")
    field = operation.json_body_fields[0]
    return f"""export function updateFindingStatus(
{_render_parameters(operation.path_parameters)}
  {field.argument_name}: {field.type},
  baseUrl: string,
  fetcher: ApiFetcher = fetch
): Promise<{operation.response_type}> {{
  return request<{operation.response_type}>({_render_path(operation)}, baseUrl, {{
    method: '{operation.method}',
    headers: {{ 'Content-Type': 'application/json' }},
    body: JSON.stringify({{ {field.name}: {field.argument_name} }})
  }}, fetcher);
}}"""


def generate() -> str:
    schema = create_app().openapi()
    operations = {
        "create_case": _operation_by_id(schema, "create_case_api_cases_post"),
        "list_cases": _operation_by_id(schema, "list_cases_api_cases_get"),
        "get_case": _operation_by_id(schema, "get_case_api_cases__case_id__get"),
        "upload_asset": _operation_by_id(
            schema, "upload_asset_api_cases__case_id__assets_post"
        ),
        "list_assets": _operation_by_id(
            schema, "list_assets_api_cases__case_id__assets_get"
        ),
        "update_finding": _operation_by_id(
            schema, "update_finding_api_cases__case_id__findings__finding_id__patch"
        ),
    }
    components = schema["components"]["schemas"]
    component_definitions = "\n\n".join(
        render_component(name, component_schema)
        for name, component_schema in sorted(components.items())
    )
    return f"""/* This file is generated by scripts/generate_api_client.py. Do not edit manually. */

{component_definitions}

export type ApiFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function apiUrl(baseUrl: string, path: string): string {{
  return `${{baseUrl.replace(/\\/$/, '')}}${{path}}`;
}}

async function request<T>(
  path: string,
  baseUrl: string,
  init: RequestInit,
  fetcher: ApiFetcher
): Promise<T> {{
  const response = await fetcher(apiUrl(baseUrl, path), init);
  if (!response.ok) {{
    throw new Error(`API request failed (${{response.status}})`);
  }}
  return (await response.json()) as T;
}}

{render_create_case(operations["create_case"])}

{render_get_case(operations["get_case"])}

{render_list_cases(operations["list_cases"])}

{render_upload_asset(operations["upload_asset"])}

{render_list_assets(operations["list_assets"])}

{render_update_finding_status(operations["update_finding"])}
"""


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generate(), encoding="utf-8")
