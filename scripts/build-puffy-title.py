"""Build Kivuno's authored inflated glyphs, optionally pressure-settle them, and export glTF.
Run: blender --background --threads 2 --python scripts/build-puffy-title.py -- --preview
"""
import argparse
import bmesh
import json
import math
import random
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--preview', action='store_true')
parser.add_argument('--simulate', action='store_true')
parser.add_argument('--samples', type=int, default=24)
opts = parser.parse_args(ARGS)
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'art'
LOCAL = ROOT / '.local' / 'puffy-title'
OUT.mkdir(parents=True, exist_ok=True)
LOCAL.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.gravity = (0, 0, 0)
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2


def collection(name):
    value = bpy.data.collections.new(name)
    scene.collection.children.link(value)
    return value


ASSET = collection('COL_Kivuno_Inflated_Type')
STUDIO = collection('COL_Studio')
root = bpy.data.objects.new('EMPTY_Kivuno_Puffy_Title', None)
ASSET.objects.link(root)


def move_to(obj, col):
    for item in list(obj.users_collection):
        item.objects.unlink(obj)
    col.objects.link(obj)


def srgb(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def material(name, hexcolor):
    rgb = [srgb(int(hexcolor[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = .235
    bsdf.inputs['Metallic'].default_value = .04
    bsdf.inputs['IOR'].default_value = 1.47
    bsdf.inputs['Coat Weight'].default_value = .55
    bsdf.inputs['Coat Roughness'].default_value = .16
    bsdf.inputs['Subsurface Weight'].default_value = .045
    return mat


MATERIALS = [
    material('MAT_Inflated_Violet', '793ed5'),
    material('MAT_Inflated_Lilac', 'a57ce6'),
    material('MAT_Inflated_Lime', 'b8f52c'),
    material('MAT_Inflated_Pearl', 'ede6fa'),
]


def catmull(points, steps=10):
    result = []
    extended = [points[0]] + points + [points[-1]]
    for j in range(len(points) - 1):
        a, b, c, d = [Vector(p) for p in extended[j:j + 4]]
        for k in range(steps):
            t = k / steps
            result.append(tuple(.5 * ((2 * b) + (-a + c) * t + (2*a-5*b+4*c-d) * t*t + (-a+3*b-3*c+d) * t*t*t)))
    result.append(tuple(Vector(points[-1])))
    return result


def strokes(letter):
    if letter == 'K':
        return [catmull([(-.54, -.66), (-.57, -.12), (-.53, .64)], 12), catmull([(.53, .66), (.23, .31), (-.37, .00), (.16, -.32), (.55, -.64)], 8)]
    if letter == 'I':
        return [catmull([(-.03, -.65), (.025, -.02), (-.025, .65)], 13)]
    if letter == 'V':
        return [catmull([(-.58, .65), (-.35, .05), (-.04, -.65), (.29, -.06), (.6, .65)], 9)]
    if letter == 'U':
        return [catmull([(-.59, .65), (-.6, .02), (-.46, -.49), (0, -.67), (.48, -.48), (.59, .02), (.57, .65)], 7)]
    if letter == 'N':
        return [catmull([(-.57, -.65), (-.58, -.08), (-.57, .66), (-.13, .05), (.56, -.65), (.58, .04), (.55, .65)], 7)]
    return [[(.58 * math.cos(i * 2 * math.pi / 64), .68 * math.sin(i * 2 * math.pi / 64)) for i in range(64)]]


def make_tube(points, radius, seed, closed=False):
    rng = random.Random(seed)
    verts, faces = [], []
    n = len(points)
    sides = 14
    phase = rng.random() * 6
    for i, point in enumerate(points):
        before = Vector(points[(i-1) % n] if closed or i > 0 else points[0])
        after = Vector(points[(i+1) % n] if closed or i < n-1 else points[-1])
        tangent = (after-before).normalized()
        normal = Vector((-tangent.y, tangent.x))
        bulge = 1 + .065 * math.sin(i / max(1, n-1) * 5.4 + phase)
        r = radius * bulge
        depth = .46 * (1 + .08 * math.cos(i * .12 + phase))
        for j in range(sides):
            angle = j * math.tau / sides
            x, y = Vector(point) + normal * (r * math.sin(angle))
            z = depth * math.cos(angle)
            verts.append((x, -z, y))
    count = n if closed else n-1
    for i in range(count):
        for j in range(sides):
            a = i*sides+j; b=i*sides+(j+1)%sides
            c=((i+1)%n)*sides+(j+1)%sides;d=((i+1)%n)*sides+j
            faces.append((a,b,c,d))
    if not closed:
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple((n-1)*sides+j for j in range(sides)))
    mesh=bpy.data.meshes.new('TubeMesh')
    mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('Stroke',mesh);ASSET.objects.link(obj)
    pieces=[obj]
    if not closed:
        for x,y in (points[0],points[-1]):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,radius=1,location=(x,0,y))
            cap=bpy.context.object;move_to(cap,ASSET)
            cap.scale=(radius,.46,radius)
            bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            pieces.append(cap)
    return pieces


def apply(obj, modifier):
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


letters=[]
row_palette=[[0,1,0,0,1,2],[2,2,1,0,0,1],[1,0,0,2,1,0],[0,1,2,1,0,2]]
row_scales=[(1.02,.94),(.98,1.05),(1.025,.96),(.99,1.01)]
for row in range(4):
    parent=bpy.data.objects.new(f'EMPTY_Row_{row+1:02d}',None);ASSET.objects.link(parent);parent.parent=root
    glyphs=[]
    for column,letter in enumerate('KIVUNO'):
        seed=73+row*19+column*7;rng=random.Random(seed)
        pieces=[]
        radius=.355 if letter not in ('I','N') else (.395 if letter=='I' else .325)
        for stroke_idx,points in enumerate(strokes(letter)):
            pieces.extend(make_tube(points,radius,seed+stroke_idx,letter=='O'))
        bpy.ops.object.select_all(action='DESELECT')
        for piece in pieces:piece.select_set(True)
        bpy.context.view_layer.objects.active=pieces[0]
        if len(pieces)>1:bpy.ops.object.join()
        obj=bpy.context.object
        obj.name=f'SM_Row_{row+1:02d}_Letter_{column+1:02d}_{letter}'
        remesh=obj.modifiers.new('Closed balloon surface','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.065;remesh.use_smooth_shade=True
        apply(obj,remesh)
        smooth=obj.modifiers.new('Inflated rounded joints','SMOOTH');smooth.factor=.6;smooth.iterations=7;apply(obj,smooth)
        # Per-letter silhouette art direction: squash, belly drift and unequal corners.
        sx=row_scales[row][0]*(1+rng.uniform(-.055,.055));sy=row_scales[row][1]*(1+rng.uniform(-.07,.06))
        for vertex in obj.data.vertices:
            x,depth,y=vertex.co
            vertex.co.x=x*sx+.035*math.sin(y*4.1+seed)
            vertex.co.z=y*sy+.035*math.sin(x*3.3+seed)
            vertex.co.y=depth*(1+.06*math.sin(x*3+y*2+seed))
        for poly in obj.data.polygons:poly.use_smooth=True
        obj.rotation_euler=(rng.uniform(-.045,.045),rng.uniform(-.085,.085),rng.uniform(-.035,.035))
        obj.data.materials.append(MATERIALS[row_palette[row][column]])
        obj.parent=parent
        glyphs.append(obj);letters.append(obj)
    bpy.context.view_layer.update()
    widths=[o.dimensions.x for o in glyphs]
    cursor=-sum(widths)/2+.08*(len(glyphs)-1)/2
    for column,(obj,width) in enumerate(zip(glyphs,widths)):
        obj.location.x=cursor+width/2+.07*math.sin(row*2+column)
        obj.location.z=(1.5-row)*1.64+.045*math.sin(column*1.8+row*1.6)
        obj.location.y=.05*math.sin(column+row*2.3)
        cursor+=width-.08
bpy.context.view_layer.update()
print('BLOCKOUT letters',len(letters),'verts',sum(len(o.data.vertices) for o in letters),flush=True)

if opts.simulate:
    # Static neighbor proxies avoid cyclic dependencies between 24 cloth solvers.
    # Pressure responds to the composed neighbors; the resulting geometry is baked.
    collision_collection=collection('COL_Pressure_Collision_Proxies')
    proxies=[]
    for obj in letters:
        proxy=bpy.data.objects.new('COLLIDER_'+obj.name, obj.data.copy())
        collision_collection.objects.link(proxy)
        proxy.matrix_world=obj.matrix_world.copy()
        proxy.scale*=.93
        proxy.hide_render=True
        proxy.modifiers.new('Static neighboring balloon','COLLISION')
        proxies.append(proxy)
    original_positions={obj.name:[v.co.copy() for v in obj.data.vertices] for obj in letters}
    for index,obj in enumerate(letters):
        neighbors=bpy.data.collections.new('COL_Neighbors_'+obj.name)
        for other,proxy in zip(letters,proxies):
            if other is not obj and (other.location-obj.location).length<3:
                neighbors.objects.link(proxy)
        pin=obj.vertex_groups.new(name='Back support')
        for v in obj.data.vertices:
            if v.co.y>.15:pin.add([v.index],min(.8,(v.co.y-.15)*2),'REPLACE')
        cloth=obj.modifiers.new('Pressure settle','CLOTH')
        cloth.settings.quality=3;cloth.settings.mass=.25
        cloth.settings.tension_stiffness=22;cloth.settings.compression_stiffness=22
        cloth.settings.shear_stiffness=12;cloth.settings.bending_stiffness=.8
        cloth.settings.use_pressure=True;cloth.settings.uniform_pressure_force=2.0
        cloth.settings.vertex_group_mass=pin.name
        cloth.settings.effector_weights.gravity=0
        cloth.settings.time_scale=.35
        cloth.collision_settings.use_collision=True;cloth.collision_settings.distance_min=.008
        cloth.collision_settings.collision_quality=2
        cloth.collision_settings.collection=neighbors
    scene.frame_end=12
    for frame in range(1,13):
        scene.frame_set(frame);bpy.context.view_layer.update()
        for obj in letters:
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            evaluated.to_mesh()
            evaluated.to_mesh_clear()
        print('PRESSURE_FRAME',frame,flush=True)
    for obj in letters:
        apply(obj,obj.modifiers.get('Pressure settle'))
    deltas=[(v.co-original_positions[obj.name][v.index]).length for obj in letters for v in obj.data.vertices]
    simulation_displacement={'mean':sum(deltas)/len(deltas),'maximum':max(deltas)}
    print('PRESSURE_DISPLACEMENT',json.dumps(simulation_displacement),flush=True)
    for proxy in proxies:bpy.data.objects.remove(proxy,do_unlink=True)
    # The tightly packed second U produces a narrow solver pinch at its cap.
    # Blend that small cap region toward the rounded authored rest shape.
    cap_letter=letters[9]
    for v in cap_letter.data.vertices:
        rest=original_positions[cap_letter.name][v.index]
        distance=math.hypot(rest.x-.58,rest.z-.67)
        blend=.9*max(0,1-distance/.55)**.5
        v.co=v.co.lerp(rest,blend)
    for obj in letters:
        relax=obj.modifiers.new('Relax narrow contact pinches','SMOOTH')
        relax.factor=.42;relax.iterations=3;apply(obj,relax)

# Art-directed localized creases and contact compression; these are not described as a simulation.
for idx,obj in enumerate(letters):
    row=idx//6;column=idx%6;letter='KIVUNO'[column]
    rng=random.Random(200+idx*11)
    crease_specs=[]
    if letter=='K':crease_specs=[(-.27,.05,.6,.23,.09)]
    elif letter=='V':crease_specs=[(-.03,-.42,1.55,.18,.09)]
    elif letter=='N':crease_specs=[(-.37,.37,-.55,.19,.085),(.34,-.36,-.45,.18,.07)]
    elif letter=='U':crease_specs=[(-.48,-.30,-.45,.15,.06),(.48,-.31,.5,.15,.055)]
    elif letter=='O':crease_specs=[(.5,.33,-.6,.15,.065)]
    else:crease_specs=[(.16,-.30,1.0,.16,.05)]
    crease_specs.append((rng.uniform(-.25,.25),.67 if row else -.62,rng.uniform(-.6,.6),.17,.055))
    for vertex in obj.data.vertices:
        x,depth,y=vertex.co
        front=max(0,min(1,(-depth-.03)/.25))
        fold=0
        for cx,cy,angle,length,strength in crease_specs:
            dx=x-cx;dy=y-cy
            along=dx*math.cos(angle)+dy*math.sin(angle)
            across=-dx*math.sin(angle)+dy*math.cos(angle)+.22*along*along
            fold+=strength*math.exp(-(across/.036)**2-(along/length)**4)
        vertex.co.y += front*fold
        vertex.co.y += .002*math.sin(x*11+idx)*math.cos(y*9+idx*.7)*front
    smooth=obj.modifiers.new('Soften crease shoulders','SMOOTH');smooth.factor=.18;smooth.iterations=1;apply(obj,smooth)
    sub=obj.modifiers.new('Silky surface','SUBSURF');sub.levels=1;sub.render_levels=1;apply(obj,sub)
    dec=obj.modifiers.new('Web triangle budget','DECIMATE');dec.ratio=.22;apply(obj,dec)
    for poly in obj.data.polygons:poly.use_smooth=True
    obj['glyph']='KIVUNO'[column];obj['row']=row+1
    obj['surface_process']='Pressure/collision settle plus authored creases' if opts.simulate else 'Authored inflated strokes and creases'

# Normalize the assembly to 12 units wide and center its geometric bounds.
bpy.context.view_layer.update()
points=[o.matrix_world@Vector(corner) for o in letters for corner in o.bound_box]
minimum=Vector(tuple(min(p[i] for p in points) for i in range(3)))
maximum=Vector(tuple(max(p[i] for p in points) for i in range(3)))
center=(minimum+maximum)/2;scale=12/(maximum.x-minimum.x)
for obj in letters:
    obj.location=(obj.location-center)*scale
    obj.scale*=scale
    # Compress the full four-row composition while keeping each balloon's depth.
    squash=7.2/((maximum.z-minimum.z)*scale)
    obj.location.z*=squash
    obj.scale.z*=squash
bpy.context.view_layer.update()


def point_at(obj,target=(0,0,0)):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def area(name,location,power,size,color,size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color
    data.shape='RECTANGLE';data.size=size;data.size_y=size_y or size
    obj=bpy.data.objects.new(name,data);STUDIO.objects.link(obj);obj.location=location;point_at(obj)
    return obj


area('LGT_Key_Softbox',(-5,-7,8),1300,5,(1,.94,.86),7)
area('LGT_Right_Strip',(7,-5,3),1050,2.2,(.82,.74,1),7)
area('LGT_Front_White',(-1,-9,-1),650,3,(1,1,1),1.5)
area('LGT_Top_Rim',(0,1,7),1500,5,(.9,1,.75),3)
world=bpy.data.worlds.new('WORLD_Studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.21,.29,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.38
camera_data=bpy.data.cameras.new('CAM_Puffy_Title_Hero');camera=bpy.data.objects.new('CAM_Puffy_Title_Hero',camera_data);STUDIO.objects.link(camera)
camera.location=(0,-24,1.35);point_at(camera);camera_data.type='ORTHO';camera_data.ortho_scale=13.4;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=opts.samples
# Avoid OIDN's large memory spike on the shared 16 GB development host.
scene.cycles.use_denoising=False
scene.render.resolution_x=1440;scene.render.resolution_y=960;scene.render.resolution_percentage=75 if opts.preview else 100
scene.render.film_transparent=True
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.filepath=str(LOCAL/('preview.png' if opts.preview else 'poster.png'))
bpy.ops.wm.save_as_mainfile(filepath=str(LOCAL/'kivuno-puffy-title.blend'))
# Export first so a failed render cannot discard the completed geometry.
bpy.ops.object.select_all(action='DESELECT')
for obj in [root]+list(root.children)+letters:obj.select_set(True)
scene.frame_set(12 if opts.simulate else 1)
bpy.ops.export_scene.gltf(filepath=str(OUT/'kivuno-puffy-title.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
triangles=sum(sum(len(poly.vertices)-2 for poly in obj.data.polygons) for obj in letters)
nonmanifold=0
for obj in letters:
    mesh=bmesh.new();mesh.from_mesh(obj.data)
    nonmanifold+=sum(not edge.is_manifold for edge in mesh.edges)
    mesh.free()
points=[o.matrix_world@Vector(corner) for o in letters for corner in o.bound_box]
bounds=[max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
report={'letters':len(letters),'triangles':triangles,'nonmanifold_edges':nonmanifold,'blender_bounds_xyz':bounds,'gltf_front':'+Z','gltf_up':'+Y','simulation_frames':12 if opts.simulate else 0,'simulation_displacement':simulation_displacement if opts.simulate else None,'glb_bytes':(OUT/'kivuno-puffy-title.glb').stat().st_size,'render':scene.render.filepath}
(LOCAL/'validation.json').write_text(json.dumps(report,indent=2))
assert triangles<150000, 'Web geometry budget exceeded'
assert report['glb_bytes']<5000000, 'Web transfer budget exceeded'
assert nonmanifold==0, 'Balloon surfaces must remain closed'
print('PUFFY_VALIDATION',json.dumps(report),flush=True)

bpy.ops.outliner.orphans_purge(do_recursive=True)
bpy.ops.render.render(write_still=True)
if not opts.preview:
    poster=OUT/'kivuno-puffy-title-poster.webp'
    # Pillow only encodes the already-rendered RGBA image; geometry and lighting
    # remain Blender's. This avoids Blender image-buffer format conversion issues.
    python=shutil.which('python')
    if not python:raise RuntimeError('Install Python + Pillow to encode the WebP poster.')
    subprocess.run([python,'-c',
        'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2], format="WEBP", quality=94, method=6)',
        scene.render.filepath,str(poster)],check=True)
