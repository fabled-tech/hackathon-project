#!/usr/bin/env python3
"""TEST FIXTURE ONLY - fakes the pipeline CLI contract so the UI's progress bar and failed-run handling can be tested
without launching Blender. Writes <out>/progress.json per step, then a FAILED manifest with one partial LOD
(a copy of the UI's procedural sample OBJ) and exits 1. Never presented as SculptLine output: manifest has test_fixture=true."""
import argparse, json, os, shutil, time, datetime
ap = argparse.ArgumentParser(); ap.add_argument('--input'); ap.add_argument('--out'); ap.add_argument('--config'); ap.add_argument('--validator-profile')
a = ap.parse_args(); os.makedirs(os.path.join(a.out, 'export'), exist_ok=True)
now = lambda: datetime.datetime.now().astimezone().isoformat(timespec='seconds')
steps = [('import_measure', 'Import + measure'), ('retopology', 'Retopology'), ('uv_unwrap', 'UV unwrap')]
def prog(i, name, label, done, status):
    json.dump({'step': i, 'total': 7, 'name': name, 'label': label, 'done': done, 'status': status, 'updated_at': now()}, open(os.path.join(a.out, 'progress.json'), 'w'))
for i, (n, l) in enumerate(steps, 1):
    prog(i, n, l, False, 'running'); time.sleep(2.5)
    if i < 3: prog(i, n, l, True, 'ok'); time.sleep(0.5)
prog(3, 'uv_unwrap', 'UV unwrap', True, 'failed')
shutil.copy(os.path.join(os.path.dirname(__file__), '..', 'samples', 'fabled_sample_head.obj'), os.path.join(a.out, 'export', 'MOCK_LOD0.obj'))
json.dump({'schema': 'fabled.pipeline.manifest/0.1', 'test_fixture': True, 'concept_mockup': True, 'asset': 'MockAsset', 'status': 'failed',
  'up_axis': 'Y', 'units': {'unreal_units': 'cm'}, 'combined_fbx': None,
  'lods': [{'level': 0, 'path': 'export/MOCK_LOD0.obj', 'triangles': None, 'budget_triangles': 30000}],
  'textures': [{'material': 'M_Mock', 'base_color': None, 'normal': None, 'orm': None}],
  'source': {'name': 'TEST FIXTURE (procedural sample head)', 'url': None, 'license': 'self-made'},
  'steps': [{'name': 'import_measure', 'status': 'ok'}, {'name': 'retopology', 'status': 'ok'}, {'name': 'uv_unwrap', 'status': 'failed'}, {'name': 'skinning', 'status': 'not_implemented'}],
  'warnings': ['TEST FIXTURE: simulated failure in uv_unwrap (mock CLI, no Blender run)']}, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=2)
raise SystemExit(1)
