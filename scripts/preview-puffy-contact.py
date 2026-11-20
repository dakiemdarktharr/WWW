"""Preview the browser's local contact response as editable Blender shape keys.

Run: blender --background --threads 2 --python scripts/preview-puffy-contact.py
The original 12-frame pressure-settled GLB stays unchanged. This lightweight
preview imports that exact release mesh and saves three animated contact patches.
The contact model is a bounded soft-surface approximation, not cloth simulation.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local' / 'puffy-title'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public' / 'art' / 'kivuno-puffy-title.glb'))
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.fps = 30
scene.frame_end = 120
report = []
for name in ['SM_Row_01_Letter_02_I', 'SM_Row_02_Letter_03_V', 'SM_Row_03_Letter_06_O']:
    obj = bpy.data.objects[name]
    # glTF imports into Blender Z-up, front toward -Y. Pick a true surface point.
    front = min(obj.data.vertices, key=lambda vertex: (obj.matrix_world @ vertex.co).y)
    center = front.co.copy()
    outward = front.normal.normalized()
    extent = Vector(tuple(max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    thickness = min(extent)
    radius, depth = max(.3, thickness * .6), min(.25, thickness * .25)
    obj.shape_key_add(name='Basis')
    contact = obj.shape_key_add(name='Fingertip contact')
    maximum, affected = 0, 0
    for vertex, target in zip(obj.data.vertices, contact.data):
        delta = vertex.co - center
        axial = delta.dot(outward)
        tangent = delta - outward * axial
        radial = tangent.length / radius
        if radial >= 1 or abs(axial) >= radius * .85:
            continue
        facing = max(0, vertex.normal.dot(outward))
        through = max(0, 1 - (axial / (radius * .85)) ** 2)
        mask = facing * through * through
        edge = (1 - radial * radial) ** 2
        shoulder = .2 * math.exp(-((radial - .64) / .19) ** 2)
        pressure = depth * mask * (shoulder - edge * math.exp(-2.2 * radial * radial))
        spread = depth * .13 * mask * edge / radius
        offset = outward * pressure + tangent * spread
        target.co = vertex.co + offset
        if offset.length > 1e-7:
            affected += 1
            maximum = max(maximum, offset.length)
    for frame in range(1, 121):
        seconds = (frame - 1) / 30
        if seconds < .45:
            amount = 1 - (1 + 17 * seconds) * math.exp(-17 * seconds)
        else:
            release = seconds - .45
            amount = (1 + 5.8 * release) * math.exp(-5.8 * release)
        contact.value = amount if frame < 120 else 0
        contact.keyframe_insert(data_path='value', frame=frame)
    obj['contact_radius'] = radius
    obj['contact_depth'] = depth
    obj['contact_process'] = 'Local fingertip field with damped elastic recovery; matches Three.js response'
    assert 0 < affected < len(obj.data.vertices) / 2, 'Contact must stay local'
    assert maximum <= depth * 1.05, 'Contact must remain bounded'
    report.append({'mesh': name, 'vertices': len(obj.data.vertices), 'affected_vertices': affected, 'maximum_displacement': maximum, 'radius': radius, 'depth': depth})
scene.frame_set(14)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'kivuno-contact-preview.blend'))
(OUT / 'contact-validation.json').write_text(json.dumps(report, indent=2))
print('CONTACT_VALIDATION', json.dumps(report), flush=True)
