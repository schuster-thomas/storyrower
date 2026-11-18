# StoryRower – painted shore section (proof of concept for the matte-painting approach).
#
# 1. blockout:  builds a 200 m stretch of the left fjord shore as simple coloured geometry and
#               renders it from a painting camera out on the fjord (→ blockout.png)
# 2. paint-over: scripts/painted/paint.mjs lets the image model paint over that render
# 3. project:   --paint <image> projects the painting back onto the geometry through the same
#               camera (UVs = camera projection), exports shore.glb and renders previews from the
#               boat's point of view
#
#   blender --background --factory-startup --python scripts/blender/painted_shore.py -- <outdir> [--paint painted.png]
#
# Coordinates: Blender Z-up, the fjord runs along +Y (= -Z in three.js), the shore is on -X.
# Sections alternate normal / mirrored in the game, so both ends match without a seam; the shore
# line below is symmetric about every multiple of 200 m (same function in src/game/scene/Fjord.ts).
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, noise
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/painted')
PAINT = os.path.abspath(ARGS[ARGS.index('--paint') + 1]) if '--paint' in ARGS else None
os.makedirs(OUT, exist_ok=True)

LENGTH = 200.0
DEPTH = 300.0            # how far inland the terrain goes
FALL_Y = 128.0           # the waterfall
ROCK_Y = 58.0            # the puffin rock in the water
LUPINES = (18.0, 95.0)   # lupine field along the lower bench

def shore(y):
    """distance from the boat's lane to the waterline (metres); symmetric about multiples of 200"""
    w = 2 * math.pi * y / 400
    return 60 + 2 * math.cos(w) + 1 * math.cos(3 * w)   # almost straight: every cliff face looks out onto the fjord

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def n1(x, y, s=1.0, seed=0.0):
    return noise.noise(Vector((x * s, y * s, seed)))

def band_d(y):
    return 52 + 9 * n1(0, y, 0.02, 4.0)

def height(d, y):
    """terrain height d metres inland at station y"""
    if d < 0:
        return -3.0 + d * 0.05
    # shore cliff of basalt columns (each ~4 m column a bit different)
    col = (hash(int(math.floor(y / 4))) % 100) / 100.0
    cliff = 13 + 4 * n1(0, y, 0.05, 1.0) + 2.5 * col
    notch = 3.5 * math.exp(-((y - FALL_Y) / 4.0) ** 2)
    h = (cliff - notch) * smooth(0.0, 1.2, d)
    # grassy bench, then a second cliff band and long slopes up to snowy tops
    bd = band_d(y)
    h += max(0.0, d - 1.2) * 0.10
    h += (26 - 6 * math.exp(-((y - FALL_Y) / 5.0) ** 2)) * smooth(bd, bd + 4, d)
    h += max(0.0, d - bd - 4) * 0.42 * (0.8 + 0.4 * n1(d, y, 0.01, 7.0))
    h += n1(d, y, 0.06, 2.0) * 3.0 * smooth(4, 20, d)
    return h

# hint colours for the painter (linear)
def lin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]
COL = {
    'rock': lin(0x55545a), 'rockLight': lin(0x6c6a70), 'moss': lin(0x6fa63c), 'grass': lin(0x8dbb4c),
    'snow': lin(0xf2f5f8), 'lupine': lin(0x8a5cc8), 'fall': lin(0xf4fbff), 'wet': lin(0x34363a),
}

def face_colour(cx, cy, cz, ny, d):
    if abs(cy - FALL_Y) < 2.6 and ny < 0.55 and cz > 0.5 and (d < 3 or abs(d - band_d(cy) - 2) < 4):
        return COL['fall']
    if cz < 0.6:
        return COL['wet']
    snow = 70 + 25 * n1(cx, cy, 0.03, 9.0)
    if ny > 0.6:
        if cz > snow:
            return COL['snow']
        if LUPINES[0] < cy < LUPINES[1] and 3 < d < band_d(cy) - 6 and n1(cx, cy, 0.15, 3.0) > -0.1:
            return COL['lupine']
        return COL['grass'] if n1(cx, cy, 0.08, 5.0) > 0 else COL['moss']
    return COL['rockLight'] if (int(cy // 4) % 2) else COL['rock']

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

def terrain():
    bm = bmesh.new()
    ROWS, COLS = 110, 160                # inland × along
    grid = []
    for j in range(COLS + 1):
        y = LENGTH * j / COLS
        row = []
        for i in range(ROWS + 1):
            d = -6 + (DEPTH + 6) * (i / ROWS) ** 1.8      # dense near the water
            x = -shore(y) - d
            row.append(bm.verts.new((x, y, height(d, y))))
        grid.append(row)
    for j in range(COLS):
        for i in range(ROWS):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    me = bpy.data.meshes.new('Shore')
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Shore', me)
    scene.collection.objects.link(o)
    return o

def rock():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        v.co.x *= 7; v.co.y *= 5.5; v.co.z = (v.co.z * 4.5 if v.co.z > 0 else v.co.z * 2) + n1(v.co.x, v.co.y, 0.5, 6.0) * 0.8
    me = bpy.data.meshes.new('PuffinRock')
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('PuffinRock', me)
    o.location = (-shore(ROCK_Y) + 14, ROCK_Y, -0.5)
    scene.collection.objects.link(o)
    return o

def paint_hints(o, rock=False):
    me = o.data
    attr = me.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
    mw = o.matrix_world
    for p in me.polygons:
        c = mw @ p.center
        n = (mw.to_3x3() @ p.normal).normalized()
        d = -c.x - shore(c.y)
        if rock:
            col = COL['moss'] if n.z > 0.55 and c.z > 2.0 else COL['rock']
        else:
            col = face_colour(c.x, c.y, c.z, abs(n.z), d)
        for li in p.loop_indices:
            attr.data[li].color = col
    for p in me.polygons: p.use_smooth = False

shore_obj = terrain()
rock_obj = rock()
paint_hints(shore_obj)
paint_hints(rock_obj, rock=True)

# water plane (blockout render only)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
water = bpy.context.active_object
water.scale = (400, 800, 1)
wm = bpy.data.materials.new('WaterHint'); wm.diffuse_color = (*lin(0x2a8fb0)[:3], 1)
water.data.materials.append(wm)

# waterfall markers for the animated overlay in the game: centre of the falling sheet, scale = (width, 1, height)
def fall_marker(name, d0, d1):
    y = FALL_Y
    top = height(d1, y); bottom = max(0.0, height(d0, y))
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = (-shore(y) - (d0 + d1) / 2 + 0.6, y, (top + bottom) / 2)
    e.scale = (5.0, 1.0, top - bottom + 1.0)
    return e
fall_marker('Fall_Lower', -0.5, 1.4)
fall_marker('Fall_Upper', band_d(FALL_Y) - 0.5, band_d(FALL_Y) + 4.5)

# painting camera: out on the fjord, looking at the whole section
cam = bpy.data.objects.new('PaintCam', bpy.data.cameras.new('PaintCam'))
scene.collection.objects.link(cam)
cam.location = (32, LENGTH / 2, 15)
look = Vector((-80, LENGTH / 2, 15 + 112 * math.tan(math.radians(8))))
cam.rotation_mode = 'QUATERNION'
cam.rotation_quaternion = (look - cam.location).to_track_quat('-Z', 'Y')
cam.data.sensor_fit = 'HORIZONTAL'
cam.data.lens = 18 / math.tan(math.radians(48))
cam.data.clip_end = 2000
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 3072, 1024
scene.render.resolution_percentage = 100

world = bpy.data.worlds.new('Sky'); scene.world = world
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.background_type = 'VIEWPORT'
scene.display.shading.background_color = lin(0x9fd4ef)[:3]

if not PAINT:
    scene.display.shading.color_type = 'VERTEX'
    # the water plane is not vertex coloured: give it hint colours too
    wa = water.data.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
    for li in range(len(water.data.loops)): wa.data[li].color = lin(0x2a8fb0)
    scene.render.filepath = f'{OUT}/blockout.png'
    bpy.ops.render.render(write_still=True)
    print('blockout rendered')
    sys.exit(0)

# ---------------------------------------------------------------- project the painting
bpy.context.view_layer.update()   # camera and object matrices must be current for the projection
img = bpy.data.images.load(PAINT)
mat = bpy.data.materials.new('Painted')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'EXTEND'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 1.0
for o in (shore_obj, rock_obj):
    me = o.data
    me.materials.clear(); me.materials.append(mat)
    uv = me.uv_layers.new(name='UVMap')
    mw = o.matrix_world
    for loop in me.loops:
        co = mw @ me.vertices[loop.vertex_index].co
        p = world_to_camera_view(scene, cam, co)
        uv.data[loop.index].uv = (p.x, p.y)
    for a in list(me.color_attributes): me.color_attributes.remove(a)

bpy.data.objects.remove(water, do_unlink=True)
for o in list(scene.objects):
    o.select_set(o.type in ('MESH', 'EMPTY'))
bpy.ops.export_scene.gltf(filepath=f'{OUT}/shore.glb', export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='WEBP')
print('exported', f'{OUT}/shore.glb')

# previews from the boat: approaching, close, alongside (with a simple water plane)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
w2 = bpy.context.active_object; w2.scale = (400, 800, 1)
wmat = bpy.data.materials.new('W'); wmat.use_nodes = True
wmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(0x1f8fb0)[:3], 1)
w2.data.materials.append(wmat)
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
view = bpy.data.objects.new('View', bpy.data.cameras.new('View'))
scene.collection.objects.link(view)
view.data.lens = 18 / math.tan(math.radians(40))
scene.camera = view
for name, y, yaw in (('far', -140, 0), ('near', -30, 0), ('along', 80, -35)):
    view.location = (0, y, 3)
    d = Vector((math.sin(math.radians(yaw)), math.cos(math.radians(yaw)), -0.04))
    view.rotation_mode = 'QUATERNION'
    view.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    scene.render.filepath = f'{OUT}/preview-{name}.png'
    bpy.ops.render.render(write_still=True)
print('previews written')
