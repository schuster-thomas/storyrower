# StoryRower – racing single scull with sculling oars and (optionally) the rigged rower, animated
# through one rowing stroke. The game scrubs the "Stroke" clip with the real stroke phase.
#
#   blender --background --factory-startup --python scripts/blender/boat.py -- <outdir> [--rower rigged.glb] [--preview]
#
# Coordinates: Blender is Z-up. The bow points to +Y (= -Z in three.js, the direction of travel);
# the rower sits facing the stern (-Y). Origin = boat centre at the waterline.
# Stroke clip: frame 0 = catch, frame 21 (35 %) = finish, frame 60 = next catch.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/boat')
PREVIEW = '--preview' in ARGS
ROWER = os.path.abspath(ARGS[ARGS.index('--rower') + 1]) if '--rower' in ARGS else None
os.makedirs(OUT, exist_ok=True)

FPS = 60
FRAMES = 60                  # one stroke cycle
LENGTH = 8.0                 # hull length (m)
BEAM = 0.36                  # max hull width – a bit wider than real so it reads from the camera
PIN_X = 0.92                 # half the span: a little wide, so long inboards still leave the fists apart
PIN_Y = -0.49                # pin position along the boat: straight arms at the catch, hands at the ribs at the finish
PIN_Z = 0.48                 # oarlock height above the waterline (handles at about knee height at the catch)
INBOARD = 0.92               # pin to the handle end; with the span the fists stay ~13 cm apart at mid-drive
OUTBOARD = 2.00              # pin to the blade tip
SEAT_Z = 0.20
FEET_Y = -0.66               # ankles on the foot stretcher

# ------------------------------------------------------------------ helpers
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, FRAMES

def mat(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)   # workbench preview
    return m

def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M = {
    'hull': mat('Hull', srgb(0xf4f4f2), 0.25),
    'red': mat('Red', srgb(0xd8282f), 0.35),
    'cockpit': mat('Cockpit', srgb(0x2c2f34), 0.7),
    'metal': mat('Metal', srgb(0xb8bec4), 0.3, 0.8),
    'shaft': mat('Shaft', srgb(0x1d2025), 0.45),
    'grip': mat('Grip', srgb(0x3a3d42), 0.9),
    'yellow': mat('Gate', srgb(0xf2c014), 0.4),
    'blade': mat('Blade', srgb(0xf7f7f5), 0.35),
}

def obj(name, mesh, parent=None):
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    if parent: o.parent = parent
    return o

def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.empty_display_size = 0.1
    if parent: o.parent = parent
    o.location = loc
    return o

def box(name, size, loc, material, parent=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(material)
    o = obj(name, me, parent)
    o.location = loc
    return o

def tube(name, a, b, r, material, parent=None, seg=10):
    """Cylinder from point a to point b (in the parent's space)."""
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=(b - a).length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(material)
    for p in me.polygons: p.use_smooth = True
    o = obj(name, me, parent)
    o.location = (a + b) / 2
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    return o

# ------------------------------------------------------------------ hull
def hull_shape(y):
    """half width, depth below the waterline and deck edge height at station y."""
    t = (y - 0.25) / (LENGTH / 2 + (0.25 if y > 0.25 else -0.25))
    t = min(1.0, abs(t))
    w = BEAM / 2 * max(0.0, 1 - t ** 2.2) ** 0.75
    d = 0.14 * max(0.0, 1 - t ** 2.6) ** 0.5
    e = 0.07 + 0.03 * (1 - t ** 2)
    return w, d, e

def build_hull():
    bm = bmesh.new()
    STATIONS, SIDE, DECK = 80, 10, 8
    rings = []
    for i in range(STATIONS + 1):
        y = -LENGTH / 2 + LENGTH * i / STATIONS
        w, d, e = hull_shape(y)
        w = max(w, 0.004); d = max(d, 0.004)
        ring = []
        # side: from the right deck edge down around the keel to the left deck edge
        for k in range(SIDE + 1):
            th = math.pi * k / SIDE
            ring.append(bm.verts.new((w * math.cos(th), y, -d * math.sin(th) + e * (1 - math.sin(th)))))
        # deck: from left to right with a crown
        for k in range(1, DECK):
            x = -w + 2 * w * k / DECK
            ring.append(bm.verts.new((x, y, e + 0.035 * (1 - (x / w) ** 2))))
        rings.append(ring)
    n = len(rings[0])
    for i in range(STATIONS):
        y = -LENGTH / 2 + LENGTH * (i + 0.5) / STATIONS
        for k in range(n):
            f = bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % n], rings[i][(k + 1) % n]))
            on_deck = k >= SIDE
            if on_deck and -1.35 < y < 0.75:
                f.material_index = 2                                   # cockpit
            elif on_deck and k in (SIDE + DECK // 2 - 1, SIDE + DECK // 2) and not (-1.35 < y < 0.75):
                f.material_index = 1                                   # red stripe along the decks
            elif k in (1, SIDE - 2):
                f.material_index = 1                                   # red side stripe
            else:
                f.material_index = 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('Hull')
    bm.to_mesh(me); bm.free()
    for m in (M['hull'], M['red'], M['cockpit']): me.materials.append(m)
    for p in me.polygons: p.use_smooth = True
    return obj('Hull', me)

boat = empty('Boat')
hull = build_hull(); hull.parent = boat

# cockpit fittings: slides, seat, foot stretcher
for sx in (-0.07, 0.07):
    tube(f'Slide{sx}', (sx, -0.5, SEAT_Z - 0.04), (sx, 0.45, SEAT_Z - 0.04), 0.012, M['metal'], boat)
seat = empty('Seat', boat, (0, 0.0, SEAT_Z))
box('SeatPad', (0.28, 0.26, 0.04), (0, 0, 0), M['cockpit'], seat, bevel=0.012)
stretcher = empty('Stretcher', boat, (0, FEET_Y - 0.1, 0.1))
plate = box('FootPlate', (0.30, 0.03, 0.26), (0, 0, 0.06), M['cockpit'], stretcher, bevel=0.01)
plate.rotation_euler = (math.radians(-40), 0, 0)

# wing riggers: struts from the gunwales to the pins
for side in (-1, 1):
    pin = Vector((side * PIN_X, PIN_Y, PIN_Z))
    for (y, z) in ((PIN_Y - 0.45, 0.10), (PIN_Y + 0.40, 0.10)):
        tube(f'Strut{side}{y:.1f}', (side * 0.16, y, z), pin, 0.013, M['metal'], boat)
    tube(f'Backstay{side}', (side * 0.12, PIN_Y + 0.05, 0.12), pin + Vector((0, 0, -0.1)), 0.011, M['metal'], boat)
    tube(f'Pin{side}', pin + Vector((0, 0, -0.12)), pin + Vector((0, 0, 0.08)), 0.012, M['metal'], boat)

# ------------------------------------------------------------------ oars
def build_oar(side):
    """Oar pivoting at the pin. Built along local +X (outboard); the left oar gets a base yaw of π."""
    pivot = empty(f'Oar{"R" if side > 0 else "L"}', boat, (side * PIN_X, PIN_Y, PIN_Z + (0.012 if side < 0 else 0)))
    pivot.rotation_mode = 'XYZ'
    tube('Shaft', (-INBOARD + 0.12, 0, 0), (OUTBOARD - 0.45, 0, 0), 0.019, M['shaft'], pivot)
    tube('Handle', (-INBOARD, 0, 0), (-INBOARD + 0.13, 0, 0), 0.017, M['grip'], pivot, seg=8)
    tube('Sleeve', (-0.09, 0, 0), (0.09, 0, 0), 0.026, M['grip'], pivot)
    gate = box('Gate', (0.05, 0.07, 0.09), (0, 0, 0.0), M['yellow'], pivot, bevel=0.008)
    tube('Collar', (0.07, 0, 0), (0.095, 0, 0), 0.034, M['yellow'], pivot)
    # hatchet blade: white with a red band; square = vertical (plane XZ). Feathering rolls only the
    # blade end, so the hands keep a steady grip.
    feather = empty(f'Feather{"R" if side > 0 else "L"}', pivot)
    feather.rotation_mode = 'XYZ'
    blade = box('Blade', (0.50, 0.012, 0.23), (OUTBOARD - 0.25, 0, -0.02), M['blade'], feather, bevel=0.004)
    band = box('BladeBand', (0.14, 0.016, 0.235), (OUTBOARD - 0.30, 0, -0.02), M['red'], feather)
    band.rotation_euler = (0, math.radians(-30), 0)
    tube('Neck', (OUTBOARD - 0.55, 0, 0), (OUTBOARD - 0.45, 0, -0.01), 0.016, M['shaft'], feather)
    empty(f'Blade{"R" if side > 0 else "L"}', feather, (OUTBOARD - 0.25, 0, -0.02))   # splash position for the game
    return pivot, feather

oars = {side: build_oar(side) for side in (1, -1)}

# ------------------------------------------------------------------ stroke animation
# (phase, value) keys; phase 0 = catch, 0.35 = finish
SWEEP = [(0, 0.72), (0.12, 0.46), (0.25, -0.12), (0.35, -0.62), (0.45, -0.33), (0.6, 0.12), (0.75, 0.36), (0.88, 0.57), (1.0, 0.72)]
# + = blade down. Buried: blade centre just under the surface; recovery: ~15 cm above it
BURIED = math.atan2(PIN_Z + 0.06, OUTBOARD - 0.25)
CARRY = math.atan2(PIN_Z - 0.16, OUTBOARD - 0.25)
PITCH = [(0, BURIED * 0.75), (0.04, BURIED), (0.33, BURIED), (0.39, CARRY), (0.92, CARRY), (1.0, BURIED * 0.75)]
FEATHER = [(0, 0), (0.36, 0), (0.43, math.pi / 2), (0.85, math.pi / 2), (0.95, 0), (1.0, 0)]
SEAT = [(0, -0.28), (0.08, -0.22), (0.2, 0.06), (0.28, 0.16), (0.35, 0.17), (0.55, 0.14), (0.75, -0.06), (1.0, -0.28)]
LEAN = [(0, 0.6), (0.15, 0.45), (0.3, -0.18), (0.35, -0.25), (0.42, -0.18), (0.52, 0.2), (0.62, 0.5), (1.0, 0.6)]

def key(o, path, index, keys, base=0.0, scale=1.0):
    for p, v in keys:
        if index is None: setattr(o, path, v)
        else: getattr(o, path)[index] = base + v * scale
        o.keyframe_insert(data_path=path, index=-1 if index is None else index, frame=round(p * FRAMES))

for side, (pivot, feather) in oars.items():
    # right oar: +yaw swings the blade to the bow; left oar mirrored around a base yaw of π
    key(pivot, 'rotation_euler', 2, SWEEP, base=0 if side > 0 else math.pi, scale=1 if side > 0 else -1)
    key(pivot, 'rotation_euler', 1, PITCH)
    key(feather, 'rotation_euler', 0, FEATHER, scale=-1 if side > 0 else 1)
key(seat, 'location', 1, SEAT)

# ------------------------------------------------------------------ rower (optional)
if ROWER:
    exec(open(os.path.join(os.path.dirname(__file__), 'boat_rower.py'), encoding='utf8').read())

# smooth, looping curves
for o in scene.objects:
    ad = o.animation_data
    if ad and ad.action:
        for layer in getattr(ad.action, 'layers', []):
            pass
        fcurves = getattr(ad.action, 'fcurves', None)
        if fcurves is None:
            fcurves = [fc for l in ad.action.layers for s in l.strips for cb in s.channelbags for fc in cb.fcurves]
        for fc in fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'

# ------------------------------------------------------------------ export
bpy.ops.export_scene.gltf(
    filepath=f'{OUT}/boat.glb', export_format='GLB', export_animations=True, export_animation_mode='SCENE',
    export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=False,
    export_apply=False, export_yup=True, export_skins=True, export_def_bones=False)
print('exported', f'{OUT}/boat.glb')

# ------------------------------------------------------------------ preview (workbench render)
if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # game camera (behind the stern, the rower faces it) and a side view, through the stroke
    views = []
    CLOSE = '--close' in ARGS   # close-ups of the hands on the grips
    scene.display.shading.color_type = 'TEXTURE' if CLOSE else 'MATERIAL'
    for frame in ((0, 5, 21, 50) if '--close' in ARGS else (0, 10, 21, 40)):
        if CLOSE:
            views.append((frame, f'hands-{frame:02d}', (0.9, -2.2, 1.3), (0, -0.2, 0.55)))
            views.append((frame, f'handfront-{frame:02d}', (0.0, -2.8, 1.7), (0, -0.3, 0.45)))
        else:
            views.append((frame, f'game-{frame:02d}', (0, -7.5, 2.6), (0, 0, 0.7)))
            views.append((frame, f'side-{frame:02d}', (5.0, -0.2, 1.0), (0, -0.2, 0.55)))
    for frame, name, loc, look in views:
        scene.frame_set(frame)
        cam.location = loc
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y')
        scene.render.filepath = f'{OUT}/preview-{name}.png'
        bpy.ops.render.render(write_still=True)
    print('previews written')
