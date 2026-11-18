# StoryRower – painted river-bank sections (matte-painting approach).
#
# 1. blockout:  builds one 120 m stretch of river bank as simple coloured geometry and renders it
#               from a painting camera across the river (→ <out>/blockout.png)
# 2. paint-over: scripts/painted/paint.mjs <kind> lets the image model paint over that render
# 3. project:   --paint <image> projects the painting back onto the geometry through the same
#               camera (UVs = camera projection), exports <out>/section.glb and renders previews
#               from the boat's point of view
#
#   blender --background --factory-startup --python scripts/blender/painted_shore.py -- <outdir> --kind cliffs|glacier [--paint painted.png]
#
# Coordinates: Blender Z-up, the river runs along +Y (= -Z in three.js). Every section is built as
# the LEFT bank (inland = -X); the game mirrors the glacier to the right bank. Sections alternate
# normal / mirrored along the river, so neighbours meet without a seam; the bank lines are symmetric
# about every multiple of LENGTH (same functions in src/game/scene/Fjord.ts).
import bpy, bmesh, math, os, sys
from mathutils import Vector, noise
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/painted/cliffs')
PAINT = os.path.abspath(ARGS[ARGS.index('--paint') + 1]) if '--paint' in ARGS else None
KIND = ARGS[ARGS.index('--kind') + 1] if '--kind' in ARGS else 'cliffs'
os.makedirs(OUT, exist_ok=True)

LENGTH = 120.0
DEPTH = 230.0             # how far inland the terrain goes
# distance from the boat's lane to the waterline (left bank: cliffs, right bank: glacier front)
BASE = {'cliffs': 14.0, 'glacier': 16.0}[KIND]

def bank(y):
    """symmetric about every multiple of LENGTH, almost straight so every face looks onto the river"""
    w = 2 * math.pi * y / (2 * LENGTH)
    return BASE + 1.5 * math.cos(w) + 0.8 * math.cos(3 * w)

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def n1(x, y, s=1.0, seed=0.0):
    return noise.noise(Vector((x * s, y * s, seed)))

def column(y, width, seed):
    return (hash((int(math.floor(y / width)), seed)) % 1000) / 1000.0

def lin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

# ---------------------------------------------------------------- cliffs (left bank)
FALL_Y = 76.0             # the waterfall
ROCK_Y = 34.0             # the puffin rock in the water
LUPINES = (8.0, 60.0)     # lupine field along the lower bench

LEDGE = 3.6               # width of the ledge at the foot of the cliffs
LEDGE_LIFT = float(os.environ.get('LEDGE_LIFT', '1.8'))   # the painter put the waterline ~1.3 m higher than the blockout

def band_d(y):
    return 34 + 6 * n1(0, y, 0.03, 4.0)

def cliffs_height(d, y):
    if d < 0:
        return -3.0 + d * 0.05
    cliff = 9 + 3 * n1(0, y, 0.06, 1.0) + 2.0 * column(y, 3.5, 1)   # basalt columns ~3.5 m wide
    notch = 3.0 * math.exp(-((y - FALL_Y) / 3.5) ** 2)
    # a low grassy rock ledge at the water (lupines, puffins – what you see from the boat), except
    # where the waterfall comes down: there the cliff drops straight into the river
    ledge_w = LEDGE * (1 - math.exp(-((y - FALL_Y) / 5.0) ** 2))
    ledge = (0.7 + 0.35 * n1(0, y, 0.15, 6.0)) * smooth(0.0, 0.6, d)
    d = max(0.0, d - ledge_w)
    h = ledge + (cliff - notch - ledge) * smooth(0.0, 1.0, d) if d > 0 else ledge
    bd = band_d(y)
    h += max(0.0, d - 1.0) * 0.10
    h += (22 - 5 * math.exp(-((y - FALL_Y) / 4.0) ** 2)) * smooth(bd, bd + 3, d)
    h += max(0.0, d - bd - 3) * 0.45 * (0.8 + 0.4 * n1(d, y, 0.012, 7.0))
    h += n1(d, y, 0.08, 2.0) * 2.0 * smooth(3, 14, d)
    return h

COL = {
    'rock': lin(0x55545a), 'rockLight': lin(0x6c6a70), 'moss': lin(0x6fa63c), 'grass': lin(0x8dbb4c),
    'snow': lin(0xf2f5f8), 'lupine': lin(0x8a5cc8), 'fall': lin(0xf4fbff), 'wet': lin(0x34363a),
    'ice': lin(0x5cc4ec), 'iceDeep': lin(0x2a78c4), 'iceTop': lin(0xe8f4fa), 'moraine': lin(0x5a5652), 'crevasse': lin(0x1f4f8a),
}

def cliffs_colour(cx, cy, cz, ny, d):
    if abs(cy - FALL_Y) < 2.2 and ny < 0.55 and cz > 0.5 and (d < 2.5 or abs(d - band_d(cy) - 1.5) < 3):
        return COL['fall']
    if cz < 0.6:
        return COL['wet']
    if ny > 0.6:
        if cz > 55 + 20 * n1(cx, cy, 0.03, 9.0):
            return COL['snow']
        if cz < 2.5 and d < LEDGE + 0.2:     # the ledge at the water: lupines and grass
            return COL['lupine'] if n1(cx, cy, 0.25, 3.0) > -0.2 and abs(cy - FALL_Y) > 7 else COL['grass']
        if LUPINES[0] < cy < LUPINES[1] and LEDGE + 2 < d < band_d(cy) - 4 and n1(cx, cy, 0.18, 3.0) > -0.15:
            return COL['lupine']
        return COL['grass'] if n1(cx, cy, 0.1, 5.0) > 0 else COL['moss']
    return COL['rockLight'] if column(cy, 3.5, 1) > 0.5 else COL['rock']

# ---------------------------------------------------------------- glacier (built as left bank, shown on the right)
def glacier_height(d, y):
    if d < 0:
        return -3.0 + d * 0.05
    # ice cliff split into serac towers of different heights, crevassed ice field behind
    tower = column(y, 5.0, 2)
    front = 8 + 3 * n1(0, y, 0.05, 1.7) + 6 * tower
    h = front * smooth(0.0, 0.8, d)
    blocks = column(y + 2.5 * math.floor(d / 7), 7.0, 3) * 6 * (1 - smooth(25, 90, d))
    h += blocks * smooth(1, 4, d)
    h += max(0.0, d - 2) * 0.32 + n1(d, y, 0.02, 4.0) * 10 * smooth(30, 120, d)
    return h

def glacier_colour(cx, cy, cz, ny, d):
    if cz < 0.6:
        return COL['iceDeep']
    if ny > 0.65:
        if abs(d - 120 - 25 * math.sin(cy * 0.02)) < 6:
            return COL['moraine']
        return COL['iceTop']
    if ny < 0.35 and n1(cx, cy, 0.3, 8.0) > 0.35:
        return COL['crevasse']
    return COL['ice'] if cz > 2.0 else COL['iceDeep']

height = cliffs_height if KIND == 'cliffs' else glacier_height
face_colour = cliffs_colour if KIND == 'cliffs' else glacier_colour

# ---------------------------------------------------------------- build
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

def terrain(y0=0.0, y1=LENGTH, cols=120):
    """the bank from y0 to y1; the blockout render uses a much longer stretch, so the painting shows
    land from edge to edge instead of an island with sky at both ends"""
    bm = bmesh.new()
    ROWS, COLS = 100, cols               # inland × along
    grid = []
    for j in range(COLS + 1):
        y = y0 + (y1 - y0) * j / COLS
        row = []
        for i in range(ROWS + 1):
            d = -6 + (DEPTH + 6) * (i / ROWS) ** 1.8      # dense near the water
            row.append(bm.verts.new((-bank(y) - d, y, height(d, y))))
        grid.append(row)
    for j in range(COLS):
        for i in range(ROWS):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    me = bpy.data.meshes.new('Bank')
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Bank', me)
    scene.collection.objects.link(o)
    return o

def rock():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        v.co.x *= 4.5; v.co.y *= 3.5; v.co.z = (v.co.z * 3.0 if v.co.z > 0 else v.co.z * 1.5) + n1(v.co.x, v.co.y, 0.6, 6.0) * 0.5
    me = bpy.data.meshes.new('PuffinRock')
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('PuffinRock', me)
    o.location = (-bank(ROCK_Y) + 6, ROCK_Y, -0.4)
    scene.collection.objects.link(o)
    return o

def paint_hints(o, is_rock=False):
    me = o.data
    attr = me.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
    mw = o.matrix_world
    for p in me.polygons:
        c = mw @ p.center
        n = (mw.to_3x3() @ p.normal).normalized()
        if is_rock:
            col = COL['moss'] if n.z > 0.55 and c.z > 1.2 else COL['rock']
        else:
            col = face_colour(c.x, c.y, c.z, abs(n.z), -c.x - bank(c.y))
        for li in p.loop_indices:
            attr.data[li].color = col
    for p in me.polygons: p.use_smooth = False

bank_obj = terrain() if PAINT else terrain(-260.0, LENGTH + 260.0, 360)
paint_hints(bank_obj)
projected = [bank_obj]
if KIND == 'cliffs':
    rock_obj = rock()
    paint_hints(rock_obj, is_rock=True)
    projected.append(rock_obj)

    # waterfall markers for the animated overlay: centre of the falling sheet, scale = (width, 1, height)
    def fall_marker(name, d0, d1):
        top = height(d1, FALL_Y); bottom = max(0.0, height(d0, FALL_Y))
        e = bpy.data.objects.new(name, None)
        scene.collection.objects.link(e)
        e.location = (-bank(FALL_Y) - (d0 + d1) / 2 + 0.5, FALL_Y, (top + bottom) / 2)
        e.scale = (3.6, 1.0, top - bottom + 0.8)
    fall_marker('Fall_Lower', -0.5, 1.0)
    fall_marker('Fall_Upper', band_d(FALL_Y) - 0.5, band_d(FALL_Y) + 3.5)

# water plane (blockout render only)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
water = bpy.context.active_object
water.scale = (400, 800, 1)
wa = water.data.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
for li in range(len(water.data.loops)): wa.data[li].color = lin(0x2a8fb0)

# painting camera: across the river, looking at the whole section (it may stand inside the far
# bank – only this bank is rendered)
DIST, CAM_Z, TILT = 52.0, 8.0, 6.5
cam = bpy.data.objects.new('PaintCam', bpy.data.cameras.new('PaintCam'))
scene.collection.objects.link(cam)
cam.location = (DIST - BASE, LENGTH / 2, CAM_Z)
look = Vector((-BASE - 40, LENGTH / 2, CAM_Z + (DIST + 40) * math.tan(math.radians(TILT))))
cam.rotation_mode = 'QUATERNION'
cam.rotation_quaternion = (look - cam.location).to_track_quat('-Z', 'Y')
cam.data.sensor_fit = 'HORIZONTAL'
half = math.atan((LENGTH / 2 + 4) / DIST)
cam.data.lens = 18 / math.tan(half)
cam.data.clip_end = 2000
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 3072, 1024
scene.render.resolution_percentage = 100

world = bpy.data.worlds.new('Sky'); scene.world = world
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.background_type = 'VIEWPORT'
scene.display.shading.background_color = lin(0x9fd4ef)[:3]
bpy.context.view_layer.update()

if not PAINT:
    scene.display.shading.color_type = 'VERTEX'
    scene.render.filepath = f'{OUT}/blockout.png'
    bpy.ops.render.render(write_still=True)
    print('blockout rendered')
    sys.exit(0)

# ---------------------------------------------------------------- project the painting
img = bpy.data.images.load(PAINT)
mat = bpy.data.materials.new('Painted')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'EXTEND'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 1.0
for o in projected:
    me = o.data
    me.materials.clear(); me.materials.append(mat)
    uv = me.uv_layers.new(name='UVMap')
    mw = o.matrix_world
    for loop in me.loops:
        co = mw @ me.vertices[loop.vertex_index].co
        # the top of the ledge at the water is seen almost edge-on by the painting camera, so the
        # painting's thin lupine strip sits a little above it: sample there, not the water below
        if KIND == 'cliffs' and o is bank_obj and co.z > 0.3 and 0.05 < -co.x - bank(co.y) < LEDGE + 0.3:
            co = co + Vector((0, 0, LEDGE_LIFT))
        p = world_to_camera_view(scene, cam, co)
        uv.data[loop.index].uv = (p.x, p.y)
    for a in list(me.color_attributes): me.color_attributes.remove(a)

bpy.data.objects.remove(water, do_unlink=True)
for o in list(scene.objects):
    o.select_set(o.type in ('MESH', 'EMPTY'))
bpy.ops.export_scene.gltf(filepath=f'{OUT}/section.glb', export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='WEBP')
print('exported', f'{OUT}/section.glb')

# previews from the boat lane (x = 0): approaching and passing
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
w2 = bpy.context.active_object; w2.scale = (400, 800, 1)
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
view = bpy.data.objects.new('View', bpy.data.cameras.new('View'))
scene.collection.objects.link(view)
view.data.lens = 18 / math.tan(math.radians(40))
scene.camera = view
for name, y, yaw in (('far', -90, 0), ('near', -15, 0), ('along', 50, -40)):
    view.location = (0, y, 2.6)
    d = Vector((math.sin(math.radians(yaw)), math.cos(math.radians(yaw)), -0.05))
    view.rotation_mode = 'QUATERNION'
    view.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    scene.render.filepath = f'{OUT}/preview-{name}.png'
    bpy.ops.render.render(write_still=True)
print('previews written')
