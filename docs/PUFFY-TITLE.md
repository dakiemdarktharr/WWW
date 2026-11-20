# Kivuno puffy title

The hero title is an original Blender asset: four closely stacked rows of six
rounded `KIVUNO` letters. Every row has a different silhouette, tilt and contact
deformation. Violet, lilac and lime materials use broad glossy highlights.
The poster is a transparent render of the same geometry. No image generation
model, external font or third-party mesh is used.

## Published assets

- `public/art/kivuno-puffy-title.glb`: 24 separate, named letter meshes beneath
  four row groups and `EMPTY_Kivuno_Puffy_Title`.
- `public/art/kivuno-puffy-title-poster.webp`: 1440 × 960 transparent fallback.
- `scripts/build-puffy-title.py`: deterministic geometry, simulation, lighting,
  rendering and export pipeline. Fixed seeds preserve row variation.

The release GLB contains **134,044 triangles**, is **2,439,940 bytes** and has
**zero nonmanifold edges**. Its material extension is `KHR_materials_clearcoat`.

The GLB uses glTF's +Y up and faces a camera on +Z. Its centered bounds are
approximately 12 units wide, 7.2 high and 1.4 deep. Blender's source scene uses
Z up and faces −Y; the glTF exporter performs the conversion. There are no
exported cameras, lights, rigs or animation clips. The website handles the
drag/rotate/return interaction around the whole assembly and a local contact
deformation on each separate letter.

## How the shape is made

1. Author each glyph from closed, rounded tube strokes, merge their surfaces
   with a voxel remesh, and smooth the joints. These are custom glyphs rather
   than an inflated font.
2. Vary each letter's proportions, belly, rotation and position; pack all four
   rows with small overlaps at intended contact areas.
3. Run **12 actual Blender cloth frames** with internal pressure, no gravity,
   back support pins and collision against static copies of nearby letters.
   Static neighbor proxies avoid dependency cycles between the 24 solvers.
   This is a short pressure/collision settling pass, not a mutually coupled
   simulation of all the balloons moving freely.
4. Bake the simulated deformation, relax narrow contact pinches and add a few
   authored folds at joins/contact areas. The folds are explicitly art-directed;
   they are not all claimed to arise from simulation.
5. Subdivide and decimate the baked surfaces for the web, then render a softly
   lit studio poster. Only meshes and material definitions are exported.

The browser receives the baked rest mesh. It does not run cloth physics.
Materials use glTF metallic/roughness plus the standard clearcoat extension;
the site supplies its own lights and environment, so its specular highlights
can differ from the poster.

## Local pressure interaction

The November 20 interaction pass preserves the four-row silhouette and the
existing 134,044-triangle budget. The brief is a glossy, fingertip-sized dent
that follows the contact point, with a soft shoulder and a slower elastic
return. The imported meshes retain their pivots and need no new textures.

`puffy-title-scene.ts` raycasts the actual clicked letter, transforms the point
and surface normal into its local coordinates, and evaluates a bounded contact
field against immutable rest positions. The center compresses inward while an
annular shoulder spreads a little of the displaced volume. Distance, facing
and depth masks keep the back surface and unrelated parts of the letter fixed.
Updated vertex normals make the specular reflection follow the dent. This is
a soft-surface approximation, not a claim of a complete real-time cloth or
volume-conserving finite-element solver.

At most four letters recover simultaneously. Only changing surfaces update;
the render loop sleeps after settling and while offscreen. Rest positions and
normals are restored exactly, so repeated presses cannot accumulate distortion.
Space provides a keyboard press, arrows rotate, and Home/Escape release. Reduced
motion uses immediate states. A silhouette glow identifies keyboard focus
without the previous rectangular outline or reset controls.

Rotation follows a critically damped analytic spring. Dragging stays responsive;
release uses frequency 3.4 rather than the earlier fast return. About 15% of an
initial rotation remains after one second, and the return settles in roughly
four seconds. The calculation is independent of frame rate. Light mode uses
darker violet/lilac/lime materials with lower exposure; dark mode retains its
brighter palette. The fallback poster also has a light-mode contrast treatment.

### Blender contact preview

The same contact field is reproduced by `scripts/preview-puffy-contact.py`, which
imports the published GLB and adds animated, editable shape keys on representative
I, V and O letters. It does not re-run or replace the original pressure-settled
geometry. Run this lightweight preview without a render:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --threads 2 --python scripts/preview-puffy-contact.py
```

Output: `.local/puffy-title/kivuno-contact-preview.blend` and
`contact-validation.json`. Frame 14 shows the press; frame 120 restores the rest
shape. The validated contact patches affect 295/1,542 vertices on I,
341/2,728 on V, and 474/3,087 on O. Their maximum local displacement is
0.196, 0.234 and 0.245 units respectively, below the configured depth bounds.
These shape keys are an authoring preview; arbitrary click points are evaluated
by Three.js at runtime, so no extra morph targets inflate the downloaded GLB.

`tests/puffy-title.test.ts` checks 15/30/60/144 Hz consistency, slow return,
back-face/distance isolation, contact orientation, and repeated press recovery.
The portal browser test exercises a visible dent, release, rotation, touch,
keyboard, reduced motion and WebGL fallback. The local press screenshot was
visually inspected for the stronger light-mode colors and the contact response.

## Rebuild

Requires Blender 5.2 and a `python` command with Pillow available for WebP
encoding. Pillow only encodes Blender's completed RGBA render.

From the repository root in PowerShell:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --threads 2 --python scripts/build-puffy-title.py -- --simulate --samples 32
```

For a faster 1080 × 720 visual check, add `--preview --simulate --samples 16`.
Preview builds update the GLB but do not replace the published poster. Omitting
`--simulate` creates authored shapes only; use `--simulate` for the intended
release asset and for the process described above.

The editable `.blend`, full PNG and validation report are saved under
`.local/puffy-title/` and are not deployed. The report records actual simulation
displacement, closed-surface validation, bounds, triangle count and byte size.
The pressure pass measured a mean displacement of 0.02865 and a maximum of
0.32170 in the original glyph units, before composition scaling and finishing.
The generator rejects geometry above 150,000 triangles, a GLB above 5 MB or
nonmanifold mesh edges. Render previews were inspected before the final export.
Cycles uses two CPU threads without OIDN denoising to keep memory use bounded
on the development host. Geometry exports before the poster render.

## Integration

Keep the 3:2 poster aspect ratio and its alpha channel. The fallback must remain
available when WebGL is unavailable or context creation fails. Load the GLB
without adding its studio lights; they are deliberately excluded from export.
Use reduced-motion preferences in the interaction layer to suppress automatic
movement, and provide an accessible text title independently of the canvas.
