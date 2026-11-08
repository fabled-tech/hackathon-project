# Read-only use of sculptline_validator's own loader + analyze() (no edits to their code) to get per-mesh triangle indices.
import os, sys, json, numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'validator'))
try:
    from sculptline_validator.geometry import analyze
    from sculptline_validator.loaders import load_asset
except ImportError:  # checkout from before the SculptLine rebrand
    from fabled_validator.geometry import analyze
    from fabled_validator.loaders import load_asset
a = load_asset(sys.argv[1])
lod0 = [m for m in a.meshes if m.lod == min(mm.lod for mm in a.meshes)]  # same as checks.Context
allp = np.concatenate([m.positions[np.unique(m.tris)] for m in lod0])
diag = float(np.linalg.norm(allp.max(0) - allp.min(0)))
out = []
for m in a.meshes:
    t = analyze(m, diag)
    w = t["winding_flipped_mask"]; n = t["normals_against_mask"]; f = w | n
    out.append({"mesh": m.name, "triangles": int(t["faces"]), "flagged": int(f.sum()), "winding": int(w.sum()), "against": int(n.sum()),
                "stored_normals": bool(t["has_normals"]), "inconsistent_edges": t["inconsistent_edges"], "boundary_edges": t["boundary_edges"], "components": t["components"],
                "flagged_idx": np.nonzero(f)[0][:50].tolist(), "against_idx": np.nonzero(n)[0][:50].tolist(), "winding_idx": np.nonzero(w)[0][:50].tolist()})
print(json.dumps(sorted(out, key=lambda d: d['mesh'])))
