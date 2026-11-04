#!/usr/bin/env python3
"""Create a separate local diagram for dragging, connecting and saving nodes."""
import json
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

API = "http://127.0.0.1:8787"


def call(path, body=None, method=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    request = Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    return result.get("data", result)


def main():
    token = call("/dev/login?format=json")["token"]

    def api(path, body=None, method=None):
        return call(path, body, method, token)

    resources = {item["label"]: item for item in api("/resources")}
    # New records on every run keep existing diagrams and moved positions intact.
    suffix = uuid.uuid4().hex[:8]
    org = api("/organization", {
        "organizationName": "Diagram Playground " + suffix,
        "description": "Local sample data for testing node movement",
    })["id"]
    stack = api(f"/cloudformation-stack-url/{org}?accountName=playground{suffix}&region=us-west-2")
    parsed = urlparse(stack["url"])
    query = parsed.fragment.split("?", 1)[1] if "?" in parsed.fragment else parsed.query
    unique = parse_qs(query)["param_UniqueId"][0]
    api(f"/organization/{org}/accounts/{stack['account_id']}", {
        "role_arn": f"arn:aws:iam::123456789012:role/AllowClutterToDeployTerraformRole-{unique}",
    })
    project = api("/project", {
        "organizationId": org, "name": "Movement Test",
        "description": "Drag nodes, pan, zoom, save and reopen",
    })["id"]
    nodes = []
    # The editor's Save accepts lowercase letters, numbers and hyphens only.
    samples = [
        ("API Gateway", "demo-api", "/aws/apigateway.png", 0, 150),
        ("Lambda", "demo-handler", "/aws/lambda.png", 300, 50),
        ("Lambda", "demo-worker", "/aws/lambda.png", 300, 300),
        ("S3", "demo-uploads", "/aws/s3.png", 650, 0),
        ("DynamoDB", "demo-records", "/aws/dynamodb.png", 650, 300),
    ]
    for label, name, image, x, y in samples:
        variables = {
            v["name"]: v["default"] for v in resources[label]["variables"]
            if v.get("default") is not None
        }
        variables["resource_name"] = name
        nodes.append({
            "id": str(uuid.uuid4()), "type": "awsService",
            "position": {"x": x, "y": y},
            "data": {"label": label, "img": image, "variables": variables},
        })
    edges = [
        {"id": f"demo-edge-{a}-{b}", "source": nodes[a]["id"], "target": nodes[b]["id"]}
        for a, b in [(0, 1), (0, 2), (1, 3), (2, 4)]
    ]
    diagram = api("/diagram", {"projectId": project, "name": "Drag Me Around"})
    if isinstance(diagram, list):
        diagram = diagram[0]
    diagram_id = diagram["id"]
    layout = {"nodes": nodes, "edges": edges}
    api("/diagram", {
        "projectId": project, "diagramId": diagram_id,
        "name": "Drag Me Around", "data": layout,
    }, "PUT")
    saved = api(f"/diagram?projectId={project}&diagramId={diagram_id}")
    if isinstance(saved, list):
        saved = saved[0]
    if saved["data"] != layout:
        raise ValueError("Saved diagram did not match the sample layout")
    print("Created and verified 5 draggable nodes and 4 connections.")
    print("Sign in first: http://localhost:3000/dev/login")
    print(f"Open diagram: http://localhost:3000/projects/{project}/diagram/{diagram_id}")
    print("Drag a node, click Save, then refresh to check its position persists.")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        sys.exit(f"Local API returned HTTP {error.code} at {error.url}; check gateway.log.")
    except URLError:
        sys.exit("Cannot reach the local backend. Start it first with npm run dev.")
    except (KeyError, ValueError, TypeError) as error:
        sys.exit(f"Could not seed the diagram: {error}")
