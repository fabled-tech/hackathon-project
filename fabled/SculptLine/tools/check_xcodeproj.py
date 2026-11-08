#!/usr/bin/env python3
"""Sanity-check SculptLine.xcodeproj/project.pbxproj against the files on disk.

Checks:
  (a) every Sources/**/*.swift on disk is in the app target's Sources build phase
  (b) every Swift file in the Sources build phase exists on disk
      (use --allow-missing a.swift,b.swift to tolerate specific files)
  (c) no duplicate object IDs in the objects section
  (d) braces/parentheses balance, and every PBXBuildFile fileRef points to an
      existing PBXFileReference (and every build-phase entry to a PBXBuildFile)

Usage (from SculptLine/):
  python3 tools/check_xcodeproj.py [--project PATH] [--root DIR]
                                   [--target NAME] [--allow-missing a.swift,b.swift]

Python 3 standard library only. Exits 0 on success, 1 on check failure,
2 on a parse error.
"""

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(HERE)
DEFAULT_PROJECT = os.path.join(DEFAULT_ROOT, "SculptLine.xcodeproj", "project.pbxproj")
DEFAULT_TARGET = "SculptLine"


class ParseError(Exception):
    pass


# ---------------------------------------------------------------------------
# Lexing / parsing of the OpenStep (old-style ASCII) property list format.
# ---------------------------------------------------------------------------

_UNQUOTED = re.compile(r"[A-Za-z0-9_$+/:.\-<>@]+")


def _skip_ws(text, i):
    n = len(text)
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j < 0:
                raise ParseError("unterminated comment at offset %d" % i)
            i = j + 2
        else:
            break
    return i


def _line_of(text, i):
    return text.count("\n", 0, i) + 1


class Parser:
    """Minimal recursive-descent parser. Records every key defined directly in
    the top-level 'objects' dictionary, in order, so duplicates can be found
    (a plain dict would silently overwrite them)."""

    def __init__(self, text):
        self.text = text
        self.i = 0
        self.object_keys = []  # (id, line) in definition order
        self._depth_path = []

    def parse(self):
        self.i = _skip_ws(self.text, self.i)
        value = self._value()
        self.i = _skip_ws(self.text, self.i)
        if self.i != len(self.text):
            raise ParseError("trailing content at line %d" % _line_of(self.text, self.i))
        return value

    def _value(self):
        t = self.text
        self.i = _skip_ws(t, self.i)
        if self.i >= len(t):
            raise ParseError("unexpected end of file")
        c = t[self.i]
        if c == "{":
            return self._dict()
        if c == "(":
            return self._array()
        if c == '"':
            return self._quoted()
        m = _UNQUOTED.match(t, self.i)
        if not m:
            raise ParseError("unexpected character %r at line %d" % (c, _line_of(t, self.i)))
        self.i = m.end()
        return m.group(0)

    def _quoted(self):
        t = self.text
        i = self.i + 1
        out = []
        while True:
            if i >= len(t):
                raise ParseError("unterminated string starting at line %d" % _line_of(t, self.i))
            c = t[i]
            if c == "\\":
                nxt = t[i + 1:i + 2]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
                i += 2
            elif c == '"':
                self.i = i + 1
                return "".join(out)
            else:
                out.append(c)
                i += 1

    def _dict(self):
        t = self.text
        start = self.i
        self.i += 1
        result = {}
        is_objects = self._depth_path == ["objects"]
        while True:
            self.i = _skip_ws(t, self.i)
            if self.i >= len(t):
                raise ParseError("unclosed '{' opened at line %d" % _line_of(t, start))
            if t[self.i] == "}":
                self.i += 1
                return result
            key_pos = self.i
            key = self._value()
            if not isinstance(key, str):
                raise ParseError("non-string key at line %d" % _line_of(t, key_pos))
            self.i = _skip_ws(t, self.i)
            if t[self.i:self.i + 1] != "=":
                raise ParseError("expected '=' after key %r at line %d" % (key, _line_of(t, self.i)))
            self.i += 1
            if is_objects:
                self.object_keys.append((key, _line_of(t, key_pos)))
            self._depth_path.append(key)
            value = self._value()
            self._depth_path.pop()
            self.i = _skip_ws(t, self.i)
            if t[self.i:self.i + 1] != ";":
                raise ParseError("expected ';' after value for %r at line %d" % (key, _line_of(t, self.i)))
            self.i += 1
            result[key] = value

    def _array(self):
        t = self.text
        start = self.i
        self.i += 1
        result = []
        saved = self._depth_path
        self._depth_path = saved + ["[]"]
        while True:
            self.i = _skip_ws(t, self.i)
            if self.i >= len(t):
                raise ParseError("unclosed '(' opened at line %d" % _line_of(t, start))
            if t[self.i] == ")":
                self.i += 1
                self._depth_path = saved
                return result
            result.append(self._value())
            self.i = _skip_ws(t, self.i)
            if t[self.i:self.i + 1] == ",":
                self.i += 1
            elif t[self.i:self.i + 1] != ")":
                raise ParseError("expected ',' or ')' at line %d" % _line_of(t, self.i))


def check_balance(text):
    """Return a list of error strings about unbalanced {} / () outside strings
    and comments."""
    errors = []
    stack = []
    pairs = {"}": "{", ")": "("}
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j < 0:
                errors.append("unterminated /* comment at line %d" % _line_of(text, i))
                return errors
            i = j + 2
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            if j >= n:
                errors.append("unterminated string at line %d" % _line_of(text, i))
                return errors
            i = j + 1
            continue
        if c in "{(":
            stack.append((c, i))
        elif c in "})":
            if not stack or stack[-1][0] != pairs[c]:
                errors.append("unmatched '%s' at line %d" % (c, _line_of(text, i)))
                return errors
            stack.pop()
        i += 1
    for c, pos in stack:
        errors.append("unclosed '%s' opened at line %d" % (c, _line_of(text, pos)))
    return errors


# ---------------------------------------------------------------------------
# Project model helpers
# ---------------------------------------------------------------------------

def resolve_paths(objects, project):
    """Map PBXFileReference id -> path relative to the project root (or None
    for refs not rooted in the source tree, e.g. BUILT_PRODUCTS_DIR)."""
    parent = {}
    for oid, obj in objects.items():
        if isinstance(obj, dict) and obj.get("isa") in ("PBXGroup", "PBXVariantGroup"):
            for child in obj.get("children", []):
                parent[child] = oid

    project_dir = project.get("projectDirPath", "") or ""

    def path_of(oid, seen=()):
        obj = objects.get(oid)
        if obj is None or oid in seen:
            return None
        tree = obj.get("sourceTree", "<group>")
        own = obj.get("path", "")
        if tree == "<group>":
            if oid in parent:
                base = path_of(parent[oid], seen + (oid,))
                if base is None:
                    return None
            else:
                base = project_dir  # main group
            return os.path.normpath(os.path.join(base, own)) if (base or own) else ""
        if tree == "SOURCE_ROOT":
            return os.path.normpath(own)
        return None  # BUILT_PRODUCTS_DIR, SDKROOT, absolute, ...

    return {oid: path_of(oid) for oid, obj in objects.items()
            if isinstance(obj, dict) and obj.get("isa") == "PBXFileReference"}


def find_app_target(objects, project, name):
    targets = [objects.get(t) for t in project.get("targets", [])]
    targets = [(tid, t) for tid, t in zip(project.get("targets", []), targets) if isinstance(t, dict)]
    if name:
        for tid, t in targets:
            if t.get("name") == name:
                return tid, t
        return None, None
    for tid, t in targets:
        if t.get("productType") == "com.apple.product-type.application":
            return tid, t
    return targets[0] if targets else (None, None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--project", default=DEFAULT_PROJECT,
                    help="path to project.pbxproj (default: %(default)s)")
    ap.add_argument("--root", default=DEFAULT_ROOT,
                    help="directory group paths are relative to (default: SculptLine/)")
    ap.add_argument("--target", default=DEFAULT_TARGET,
                    help="native target to check (default: %(default)s)")
    ap.add_argument("--allow-missing", default="",
                    help="comma-separated Swift file names (basename or Sources/... path) "
                         "allowed to be in the Sources phase but missing on disk")
    args = ap.parse_args(argv)

    allow = {a.strip() for a in args.allow_missing.split(",") if a.strip()}

    try:
        with open(args.project, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        print("error: cannot read %s: %s" % (args.project, e), file=sys.stderr)
        return 2

    failures = []
    notes = []

    # (d1) structural balance
    bal = check_balance(text)
    failures += ["unbalanced: " + e for e in bal]

    try:
        parser = Parser(text)
        plist = parser.parse()
    except ParseError as e:
        for msg in failures:
            print("FAIL " + msg)
        print("FAIL could not parse %s: %s" % (args.project, e))
        return 2

    objects = plist.get("objects", {})
    root_id = plist.get("rootObject")
    project = objects.get(root_id, {})
    if not isinstance(project, dict) or project.get("isa") != "PBXProject":
        print("FAIL rootObject %r is not a PBXProject" % root_id)
        return 2

    # (c) duplicate IDs
    seen = {}
    for oid, line in parser.object_keys:
        if oid in seen:
            failures.append("duplicate object ID %s (lines %d and %d)" % (oid, seen[oid], line))
        else:
            seen[oid] = line

    # (d2) dangling references
    for oid, obj in objects.items():
        if not isinstance(obj, dict):
            continue
        if obj.get("isa") == "PBXBuildFile":
            ref = obj.get("fileRef") or obj.get("productRef")
            if ref is None:
                failures.append("PBXBuildFile %s has no fileRef" % oid)
            elif "fileRef" in obj and (objects.get(ref) or {}).get("isa") not in (
                    "PBXFileReference", "PBXVariantGroup", "XCVersionGroup", "PBXReferenceProxy"):
                failures.append("PBXBuildFile %s fileRef %s does not point to an existing PBXFileReference"
                                % (oid, ref))
        if obj.get("isa", "").endswith("BuildPhase"):
            for bf in obj.get("files", []):
                if (objects.get(bf) or {}).get("isa") != "PBXBuildFile":
                    failures.append("%s %s lists %s, which is not a PBXBuildFile"
                                    % (obj.get("isa"), oid, bf))
        if obj.get("isa") in ("PBXGroup", "PBXVariantGroup"):
            for child in obj.get("children", []):
                if child not in objects:
                    failures.append("group %s lists missing child %s" % (oid, child))

    # Locate the app target's Sources phase
    tid, target = find_app_target(objects, project, args.target)
    if target is None:
        failures.append("no matching native target found")
        phase_paths = {}
    else:
        phases = [objects.get(p, {}) for p in target.get("buildPhases", [])]
        src_phases = [p for p in phases if p.get("isa") == "PBXSourcesBuildPhase"]
        if not src_phases:
            failures.append("target %s has no PBXSourcesBuildPhase" % target.get("name"))
        ref_paths = resolve_paths(objects, project)
        phase_paths = {}  # rel path -> build file id
        for phase in src_phases:
            for bf in phase.get("files", []):
                ref = (objects.get(bf) or {}).get("fileRef")
                p = ref_paths.get(ref)
                if p is None:
                    continue
                if p in phase_paths:
                    failures.append("%s is in the Sources phase twice" % p)
                phase_paths[p] = bf
        res_phases = [p for p in phases if p.get("isa") == "PBXResourcesBuildPhase"]
        res_paths = sorted(ref_paths.get((objects.get(bf) or {}).get("fileRef")) or "?"
                           for ph in res_phases for bf in ph.get("files", []))
        notes.append("target %s: %d Sources entries, %d Resources entries (%s)"
                     % (target.get("name"), len(phase_paths), len(res_paths), ", ".join(res_paths) or "none"))
        test_targets = [objects[t].get("name") for t in project.get("targets", [])
                        if "unit-test" in (objects.get(t) or {}).get("productType", "")]
        notes.append("test targets in Xcode project: %s" % (", ".join(test_targets) or "none (tests run via SwiftPM)"))

    # (a) every Sources/**/*.swift on disk is in the phase
    on_disk = set()
    src_root = os.path.join(args.root, "Sources")
    for dirpath, _dirs, files in os.walk(src_root):
        for fn in files:
            if fn.endswith(".swift"):
                on_disk.add(os.path.relpath(os.path.join(dirpath, fn), args.root))
    for p in sorted(on_disk - set(phase_paths)):
        failures.append("not in Sources build phase: %s" % p)

    # (b) every Swift file in the phase exists on disk
    for p in sorted(phase_paths):
        if not p.endswith(".swift"):
            continue
        if not os.path.isfile(os.path.join(args.root, p)):
            if os.path.basename(p) in allow or p in allow:
                notes.append("missing on disk (allowed): %s" % p)
            else:
                failures.append("missing on disk: %s" % p)

    shown = os.path.relpath(args.project)
    print("Checked %s" % (args.project if shown.startswith("..") else shown))
    for n in notes:
        print("  note: " + n)
    if failures:
        for msg in failures:
            print("FAIL " + msg)
        print("%d problem(s) found." % len(failures))
        return 1
    print("OK: %d Swift files on disk, all in the Sources phase; %d objects, no duplicates or dangling refs."
          % (len(on_disk), len(objects)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
