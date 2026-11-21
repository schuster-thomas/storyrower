# StoryRower – painted river-bank sections (matte-painting approach).
#
# 1. blockout:  builds one 120 m stretch of river bank as simple coloured geometry and renders it
#               from a painting camera across the river (→ <out>/blockout.png)
# 2. paint-over: scripts/painted/paint.mjs <kind> lets the image model paint over that render
# 3. project:   --paint <image> projects the painting back onto the geometry through the same
#               camera (UVs = camera projection), exports <out>/section.glb and renders previews
#               from the boat's point of view
#
#   blender --background --factory-startup --python scripts/blender/painted_shore.py -- <outdir> --kind cliffs|glacier|garden|city [--paint painted.png]
#   (garden and city are the banks of "Tokyo Super Row": a Japanese garden behind a granite wall on the
#   left, a promenade with high-rises on the right – the city is mirrored onto the right bank like the glacier)
#
# Coordinates: Blender Z-up, the river runs along +Y (= -Z in three.js). Every section is built as
# the LEFT bank (inland = -X); the game mirrors the glacier to the right bank. Sections alternate
# normal / mirrored along the river, so neighbours meet without a seam; the bank lines are symmetric
# about every multiple of LENGTH (same functions in src/game/scene/Fjord.ts).
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/painted/cliffs')
PAINT = os.path.abspath(ARGS[ARGS.index('--paint') + 1]) if '--paint' in ARGS else None
KIND = ARGS[ARGS.index('--kind') + 1] if '--kind' in ARGS else 'cliffs'
# variant b: a second section of the same bank, so the river does not repeat every 240 m. It has
# exactly the same profile as variant a at y = 0, so the game can chain a, a mirrored, b, b mirrored
VARIANT = ARGS[ARGS.index('--variant') + 1] if '--variant' in ARGS else 'a'
os.makedirs(OUT, exist_ok=True)

LENGTH = 120.0
DEPTH = 230.0             # how far inland the terrain goes
# distance from the boat's lane to the waterline (left bank: cliffs, right bank: glacier front)
BASE = {'cliffs': 14.0, 'glacier': 16.0, 'garden': 14.0, 'city': 16.0}[KIND]

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
FALL_Y = 76.0 if VARIANT == 'a' else 64.0     # the waterfall
ROCK_Y = 34.0 if VARIANT == 'a' else 16.0     # the puffin rock (a) / a sea stack (b) in the water
LUPINES = (8.0, 60.0)     # lupine field along the lower bench

LEDGE = 3.6               # width of the ledge at the foot of the cliffs
LEDGE_LIFT = float(os.environ.get('LEDGE_LIFT', '0.3'))   # per painting: how far the painted ledge sits above the geometry's

def band_d(y):
    return 34 + 6 * n1(0, y, 0.03, 4.0)

def cliffs_tall(y):
    """0 = low open shore with grassy slopes, 1 = tall basalt cliffs – so the valley is not walled
    in everywhere. a: open first half, cliffs with the waterfall in the second half;
    b: open at both ends, an amphitheatre of basalt columns around a broad waterfall in the middle"""
    if VARIANT == 'a':
        return smooth(44.0, 62.0, y)
    return smooth(26.0, 40.0, y) * (1.0 - smooth(96.0, 112.0, y))

def recess(y):
    """b: the cliffs step back around the waterfall into a horseshoe (amphitheatre)"""
    return 0.0 if VARIANT == 'a' else 9.0 * math.exp(-((y - FALL_Y) / 11.0) ** 2)

def cliffs_height(d, y):
    d = d - recess(y)
    if d < 0:
        return -3.0 + d * 0.05
    tall = cliffs_tall(y)
    cliff = (3.0 + 4.5 * tall) + 2.5 * n1(0, y, 0.06, 1.0) * (0.4 + 0.6 * tall) + 2.0 * column(y, 3.5, 1) * tall   # basalt columns ~3.5 m wide
    notch = 3.0 * math.exp(-((y - FALL_Y) / 3.5) ** 2)
    # a low grassy rock ledge at the water (lupines, puffins – what you see from the boat), except
    # where the waterfall comes down: there the cliff drops straight into the river
    ledge_w = LEDGE * (1 - math.exp(-((y - FALL_Y) / 5.0) ** 2))
    ledge = (0.7 + 0.35 * n1(0, y, 0.15, 6.0)) * smooth(0.0, 0.6, d)
    d = max(0.0, d - ledge_w)
    h = ledge + (cliff - notch - ledge) * smooth(0.0, 1.0, d) if d > 0 else ledge
    bd = band_d(y)
    h += max(0.0, d - 1.0) * 0.10
    h += (16 - 4 * math.exp(-((y - FALL_Y) / 4.0) ** 2)) * (0.25 + 0.75 * tall) * smooth(bd, bd + 3 + 10 * (1 - tall), d)
    h += max(0.0, d - bd - 3) * 0.3 * (0.6 + 0.4 * tall) * (0.8 + 0.4 * n1(d, y, 0.012, 7.0))
    h += n1(d, y, 0.08, 2.0) * 2.0 * smooth(3, 14, d)
    return h

COL = {
    'rock': lin(0x55545a), 'rockLight': lin(0x6c6a70), 'moss': lin(0x6fa63c), 'grass': lin(0x8dbb4c),
    'snow': lin(0xf2f5f8), 'lupine': lin(0x8a5cc8), 'fall': lin(0xf4fbff), 'wet': lin(0x34363a),
    'ice': lin(0x5cc4ec), 'iceDeep': lin(0x2a78c4), 'iceTop': lin(0xe8f4fa), 'moraine': lin(0x5a5652), 'crevasse': lin(0x1f4f8a),
}

def cliffs_colour(cx, cy, cz, ny, d):
    d = d - recess(cy)
    # waterfall and lupines are NOT painted: they are real 3D elements in the game (a painted
    # waterfall or flower field always looks flat). The painting only shows the wet rock gully.
    if abs(cy - FALL_Y) < 2.2 and ny < 0.55 and cz > 0.5 and (d < 2.5 or abs(d - band_d(cy) - 1.5) < 3):
        return COL['wet']
    if cz < 0.6:
        return COL['wet']
    if ny > 0.6:
        if cz > 55 + 20 * n1(cx, cy, 0.03, 9.0):
            return COL['snow']
        if cz < 2.5 and d < LEDGE + 0.2:     # the ledge at the water (the lupines on it are 3D)
            return COL['grass'] if n1(cx, cy, 0.25, 3.0) > -0.3 else COL['moss']
        return COL['grass'] if n1(cx, cy, 0.1, 5.0) > 0 else COL['moss']
    return COL['rockLight'] if column(cy, 3.5, 1) > 0.5 else COL['rock']

# ---------------------------------------------------------------- glacier (built as left bank, shown on the right)
def glacier_height(d, y):
    if d < 0:
        return -3.0 + d * 0.05
    # ice cliff split into serac towers of different heights, crevassed ice field behind
    tower = column(y, 5.0, 2)
    # a low ice ramp along part of each section, so the glacier is not one long wall
    tall = 1.0 - (smooth(62.0, 78.0, y) * (1.0 - smooth(104.0, 118.0, y)) if VARIANT == 'a'
                  else smooth(16.0, 28.0, y) * (1.0 - smooth(50.0, 62.0, y)))
    front = (2.5 + 5.5 * tall) + 3 * n1(0, y, 0.05, 1.7) * (0.5 + 0.5 * tall) + 6 * tower * (0.3 + 0.7 * tall)
    h = front * smooth(0.0, 0.8, d)
    blocks = column(y + 2.5 * math.floor(d / 7), 7.0, 3) * 6 * (1 - smooth(25, 90, d))
    h += blocks * smooth(1, 4, d)
    h += max(0.0, d - 2) * 0.22 + n1(d, y, 0.02, 4.0) * 8 * smooth(30, 120, d)
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

# ---------------------------------------------------------------- Tokyo: Japanese garden (left bank)
# Flat hint colours, each one a thing the painter has to recognise (see scripts/painted/paint.mjs).
COL.update({
    'stone': lin(0xb9ae98), 'stoneWet': lin(0x5a564c), 'lawn': lin(0x8cc85a), 'gravel': lin(0xe6dcc0),
    'azalea': lin(0xff4fa8), 'pine': lin(0x2c6a3a), 'blossom': lin(0xffb8d4), 'house': lin(0xc98a4a), 'roof': lin(0x434a5c),
    'forest': lin(0x4f8f4a), 'water2': lin(0x2a8fb0),
    'paving': lin(0xe2ddd2), 'street': lin(0x77777a), 'verge': lin(0x7fbf55), 'rail': lin(0xf0f0f0),
    'glass': lin(0x6fa8dc), 'office': lin(0xf4f4f2), 'flats': lin(0xd9b98c), 'teal': lin(0x5cc4b0), 'roofTop': lin(0x5a5e66),
})
G_WALL = 1.8           # top of the granite wall above the water (src/game/scene/tokyo – keep in sync)
C_WALL = 2.4           # top of the city embankment

def garden_layout():
    """bushes, pines, a tea house and cherry-blossom groves – nothing within 7 m of the section
    ends, so a, a mirrored, b, b mirrored meet without a seam"""
    r = random.Random(11 if VARIANT == 'a' else 23)
    f = []
    y = 9.0
    while y < LENGTH - 9:      # azalea bushes along the wall
        f.append(('azalea', y, r.uniform(1.6, 3.2), r.uniform(1.4, 2.4), r.uniform(1.0, 1.8)))
        y += r.uniform(5, 11)
    y = 12.0
    while y < LENGTH - 12:     # pruned pines behind the gravel path
        f.append(('pine', y, r.uniform(10, 14), r.uniform(2.5, 3.6), r.uniform(3.5, 5.5)))
        y += r.uniform(16, 30)
    house_y = r.uniform(30, 90)
    y = 10.0
    while y < LENGTH - 10:     # the cherry grove: big pink canopies in two rows
        if abs(y - house_y) > 12:
            f.append(('blossom', y, r.uniform(16, 24), r.uniform(6, 9), r.uniform(9, 13)))
        f.append(('blossom', y + r.uniform(-4, 4), r.uniform(30, 44), r.uniform(7, 11), r.uniform(11, 15)))
        y += r.uniform(9, 15)
    return f, house_y
GARDEN, HOUSE_Y = garden_layout() if KIND == 'garden' else ([], 0.0)

def garden_feature(d, y):
    """(height, what is there) at d metres inland"""
    if d < 0:
        return -3.0 + d * 0.05, 'stoneWet'
    if d < 0.45:               # the granite wall, straight up out of the water
        return G_WALL * smooth(0.0, 0.45, d), 'stone'
    h = G_WALL + 0.1 + 0.25 * n1(d, y, 0.2, 3.0) * smooth(1, 4, d)
    tag = 'gravel' if 7.0 < d < 9.5 else 'lawn'
    # rolling hills behind the garden, partly blossoming
    hill = smooth(50, 130, d) * (14 + 12 * n1(0, y, 0.02, 5.0)) + smooth(130, 230, d) * (12 + 14 * n1(0, y, 0.015, 8.0))
    if hill > 0.5:
        h += hill
        tag = 'blossom' if n1(d, y, 0.04, 2.0) > 0.25 else 'forest'
    # the tea house: a wooden box with a hipped roof
    hd, hy = d - 16.0, y - HOUSE_Y
    if abs(hy) < 5.5 and abs(hd) < 4.0:
        roof = 2.4 * min(1 - abs(hy) / 5.5, 1 - abs(hd) / 4.0) * 1.6
        if abs(hy) < 4.6 and abs(hd) < 3.2:
            return G_WALL + 3.4 + min(2.4, roof), 'roof' if roof > 0.5 else 'house'
        return G_WALL + 3.0 + min(0.6, roof * 0.3), 'roof'
    for kind, fy, fd, rad, top in GARDEN:
        dist = math.hypot(d - fd, (y - fy) * (0.8 if kind == 'blossom' else 1.0))
        if dist < rad:
            dome = G_WALL + top * math.sqrt(1 - (dist / rad) ** 2) + 0.4 * n1(d, y, 0.5, 4.0)
            if dome > h:
                h, tag = dome, kind
    return h, tag

def garden_height(d, y):
    return garden_feature(d, y)[0]

def garden_colour(cx, cy, cz, ny, d):
    h, tag = garden_feature(d, cy)
    if d < 0.6 or tag in ('stone', 'stoneWet'):
        return COL['stoneWet'] if cz < 0.25 else COL['stone']
    if tag == 'lawn' and ny < 0.5:
        return COL['stone']
    return COL[tag]

# ---------------------------------------------------------------- Tokyo: city (built as left bank, shown on the right)
def city_layout():
    """rows of high-rises: (y centre, length along the river, d from the bank, depth, height, style)"""
    r = random.Random(5 if VARIANT == 'a' else 17)
    out = []
    for d0, d1, h0, h1 in ((12.0, 15.0, 22.0, 42.0), (36.0, 46.0, 40.0, 68.0), (80.0, 100.0, 60.0, 95.0)):
        y = 6.0 + r.uniform(0, 4)
        while True:
            w = r.uniform(12, 24)
            if y + w > LENGTH - 6:
                break
            out.append((y + w / 2, w, r.uniform(d0, d1), r.uniform(14, 22), r.uniform(h0, h1), r.choice(['glass', 'office', 'flats', 'teal'])))
            y += w + r.uniform(3, 8)
    return out
CITY = city_layout() if KIND == 'city' else []

def city_height(d, y):
    if d < 0:
        return -3.0 + d * 0.05
    if d < 0.45:
        return C_WALL * smooth(0.0, 0.45, d)
    return C_WALL + 0.02

def city_colour(cx, cy, cz, ny, d):
    if d < 0.6 or ny < 0.5:
        return COL['stoneWet'] if cz < 0.25 else COL['stone']
    if d < 9.0:
        return COL['paving']
    if d < 11.0:
        return COL['verge']
    return COL['street']

def buildings():
    """one box per building; the face towards the river shows its style, the others a darker shade"""
    objs = []
    for i, (yc, w, d0, depth, hgt, style) in enumerate(CITY):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x = -bank(yc) - d0 - depth / 2 + v.co.x * depth
            v.co.y = yc + v.co.y * w
            v.co.z = C_WALL + (v.co.z + 0.5) * hgt
        me = bpy.data.meshes.new(f'Bldg_{i}')
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(f'Bldg_{i}', me)
        o['style'] = style
        scene.collection.objects.link(o)
        objs.append(o)
    return objs

# ---------------------------------------------------------------- Tokyo: geometry fitted to the painting
# The image model keeps a blockout's layout only roughly, so for the Tokyo banks the projected
# geometry is raised to the silhouette of the painting instead (skyline.json, scripts/painted/align.mjs):
# the wall and lawn / promenade at the water, then a slope (garden) or a straight facade (city) up to
# exactly the painted skyline – every painted crown and roof lands on geometry of its height.
SKY_D = {'garden': 24.0, 'city': 14.0}.get(KIND, 0.0)   # how far inland the painted silhouette stands
SKY_Z = None                                             # height of the skyline per metre of river (set below)

def fitted_height(d, y):
    if d < 0:
        return -3.0 + d * 0.05
    wall = G_WALL if KIND == 'garden' else C_WALL
    if d < 0.45:
        return wall * smooth(0.0, 0.45, d)
    i = max(0, min(len(SKY_Z) - 2, int(y)))
    top = SKY_Z[i] + (SKY_Z[i + 1] - SKY_Z[i]) * (y - i)
    if KIND == 'city':
        # promenade, then one facade straight up to the painted rooftops
        return wall + 0.02 if d < SKY_D - 0.6 else max(wall, top) + (0.0 if d < SKY_D + 40 else -2.0)
    base = wall + 0.1
    # the lawn at the water, then crowns, roofs and hills rising to the painted silhouette
    return base + (max(base, top) - base) * smooth(4.0, SKY_D, d)

HEIGHT = {'cliffs': cliffs_height, 'glacier': glacier_height, 'garden': garden_height, 'city': city_height}
COLOUR = {'cliffs': cliffs_colour, 'glacier': glacier_colour, 'garden': garden_colour, 'city': city_colour}
height = HEIGHT[KIND]
face_colour = COLOUR[KIND]

# ---------------------------------------------------------------- build
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

def terrain(y0=0.0, y1=LENGTH, cols=72):
    """the bank from y0 to y1; the blockout render uses a much longer stretch, so the painting shows
    land from edge to edge instead of an island with sky at both ends"""
    bm = bmesh.new()
    # inland × along (dense near the water, coarse inland); the garden has small bushes: finer
    ROWS, COLS = (110, cols * 2) if KIND == 'garden' else (64, cols)
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
        if VARIANT == 'a':   # a low mossy boulder
            v.co.x *= 4.5; v.co.y *= 3.5; v.co.z = (v.co.z * 3.0 if v.co.z > 0 else v.co.z * 1.5) + n1(v.co.x, v.co.y, 0.6, 6.0) * 0.5
        else:                # a basalt sea stack with a green cap
            v.co.x *= 2.6; v.co.y *= 2.4; v.co.z = (v.co.z * 7.5 if v.co.z > 0 else v.co.z * 1.5) + n1(v.co.x, v.co.y, 0.6, 6.0) * 0.4
    me = bpy.data.meshes.new('PuffinRock')
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('PuffinRock', me)
    o.location = (-bank(ROCK_Y) + 6, ROCK_Y, -0.4)
    scene.collection.objects.link(o)
    return o

def paint_hints(o, is_rock=False, style=None):
    me = o.data
    attr = me.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
    mw = o.matrix_world
    for p in me.polygons:
        c = mw @ p.center
        n = (mw.to_3x3() @ p.normal).normalized()
        if style:
            # a building: roof on top, the style colour on every wall
            col = COL['roofTop'] if n.z > 0.5 else COL[style]
        elif is_rock:
            col = COL['moss'] if n.z > 0.55 and c.z > 1.2 else COL['rock']
        else:
            col = face_colour(c.x, c.y, c.z, abs(n.z), -c.x - bank(c.y))
        for li in p.loop_indices:
            attr.data[li].color = col
    for p in me.polygons: p.use_smooth = False

if PAINT and KIND in ('garden', 'city'):
    import json
    sk = json.load(open(os.path.join(os.path.dirname(PAINT), 'skyline.json')))
    # the side painting camera (same as PaintCam below)
    _D, _Z, _T = 52.0, 8.0, {'city': 9.0, 'garden': 9.0}[KIND]
    cam0 = bpy.data.objects.new('SkyCam', bpy.data.cameras.new('SkyCam'))
    scene.collection.objects.link(cam0)
    cam0.location = (_D - BASE, LENGTH / 2, _Z)
    cam0.rotation_mode = 'QUATERNION'
    cam0.rotation_quaternion = (Vector((-BASE - 40, LENGTH / 2, _Z + (_D + 40) * math.tan(math.radians(_T)))) - Vector(cam0.location)).to_track_quat('-Z', 'Y')
    cam0.data.sensor_fit = 'HORIZONTAL'
    cam0.data.lens = 18 / math.tan(math.atan((LENGTH / 2 + 4) / _D))
    scene.camera = cam0
    scene.render.resolution_x, scene.render.resolution_y = 3072, 1024
    bpy.context.view_layer.update()
    SKY_Z = []
    for yi in range(int(LENGTH) + 2):
        y = float(min(yi, LENGTH))
        x = -bank(y) - SKY_D
        u = world_to_camera_view(scene, cam0, Vector((x, y, 10.0))).x
        col = max(0, min(sk['width'] - 1, int(u * sk['width'])))
        v_sky = 1.0 - sk['rows'][col] / sk['height']             # 0 = bottom of the picture
        lo, hi = 0.0, 140.0
        for _ in range(30):                                       # the height whose image sits on the skyline
            mid = (lo + hi) / 2
            if world_to_camera_view(scene, cam0, Vector((x, y, mid))).y < v_sky: lo = mid
            else: hi = mid
        SKY_Z.append(lo)
    bpy.data.objects.remove(cam0, do_unlink=True)
    height = fitted_height
    print('skyline heights: min %.1f, max %.1f m' % (min(SKY_Z), max(SKY_Z)))
    # where the quake can break pieces off the city: markers on the facade every 12 m (scale z = height)
    if KIND == 'city':
        for k, ys in enumerate(range(8, int(LENGTH) - 6, 12)):
            if SKY_Z[ys] < 16: continue
            e = bpy.data.objects.new(f'Spot_{k}', None)
            scene.collection.objects.link(e)
            e.location = (-bank(ys) - SKY_D, float(ys), C_WALL)
            e.scale = (1.0, 1.0, SKY_Z[ys] - C_WALL)

bank_obj = terrain() if PAINT else terrain(-260.0, LENGTH + 260.0, 360)
paint_hints(bank_obj)
projected = [bank_obj]
if KIND == 'city' and not PAINT:
    for b in buildings():
        paint_hints(b, style=b['style'])
        projected.append(b)
if KIND == 'cliffs':
    rock_obj = rock()
    paint_hints(rock_obj, is_rock=True)
    projected.append(rock_obj)

    # waterfall markers for the animated overlay: centre of the falling sheet, scale = (width, 1, height)
    def fall_marker(name, d0, d1):
        r = recess(FALL_Y)
        top = height(d1 + r, FALL_Y); bottom = max(0.0, height(d0 + r, FALL_Y))
        e = bpy.data.objects.new(name, None)
        scene.collection.objects.link(e)
        e.location = (-bank(FALL_Y) - r - (d0 + d1) / 2 + 0.5, FALL_Y, (top + bottom) / 2)
        e.scale = (6.0 if VARIANT == 'a' else 9.0, 1.0, top - bottom + 0.8)   # a bold sheet, it is a key feature from the boat
    fall_marker('Fall_Lower', -0.5, 1.0)
    fall_marker('Fall_Upper', band_d(FALL_Y) - 0.5, band_d(FALL_Y) + 3.5)

# water plane (blockout render only)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
water = bpy.context.active_object
water.scale = (400, 800, 1)
wa = water.data.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
for li in range(len(water.data.loops)): wa.data[li].color = lin(0x2a8fb0)

# painting cameras: one across the river looking at the whole section (it may stand inside the far
# bank – only this bank is rendered), and two on the river looking along it, for the faces that
# point up- or downstream (the side camera sees those edge-on, which smeared the painting)
DIST, CAM_Z, TILT = 52.0, 8.0, {'city': 9.0, 'garden': 9.0}.get(KIND, 6.5)
ALONG_Z = {'city': 22.0, 'garden': 9.0}.get(KIND, 11.0)   # height the cameras along the river look at
def make_cam(name, loc, look, res, hfov):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(c)
    c.location = loc
    c.rotation_mode = 'QUATERNION'
    c.rotation_quaternion = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y')
    c.data.sensor_fit = 'HORIZONTAL'
    c.data.lens = 18 / math.tan(hfov / 2)
    c.data.clip_end = 2000
    c['res'] = res
    return c
CAMS = {
    'side': make_cam('PaintCam', (DIST - BASE, LENGTH / 2, CAM_Z),
                     (-BASE - 40, LENGTH / 2, CAM_Z + (DIST + 40) * math.tan(math.radians(TILT))),
                     (3072, 1024), 2 * math.atan((LENGTH / 2 + 4) / DIST)),
    'up': make_cam('PaintCamUp', (-4.0, -32.0, 4.0), (-BASE - 14, 52.0, ALONG_Z), (1536, 1024), math.radians(64)),
    'down': make_cam('PaintCamDown', (-4.0, LENGTH + 32.0, 4.0), (-BASE - 14, LENGTH - 52.0, ALONG_Z), (1536, 1024), math.radians(64)),
}
cam = CAMS['side']
def use_cam(c):
    scene.camera = c
    scene.render.resolution_x, scene.render.resolution_y = c['res'][0], c['res'][1]
scene.render.resolution_percentage = 100

world = bpy.data.worlds.new('Sky'); scene.world = world
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.background_type = 'VIEWPORT'
scene.display.shading.background_color = lin(0x9fd4ef)[:3]
bpy.context.view_layer.update()

if not PAINT:
    scene.display.shading.color_type = 'VERTEX'
    for name, c in CAMS.items():
        use_cam(c)
        scene.render.filepath = f'{OUT}/blockout.png' if name == 'side' else f'{OUT}/blockout-{name}.png'
        bpy.ops.render.render(write_still=True)
    print('blockouts rendered')
    sys.exit(0)

# ---------------------------------------------------------------- project the paintings
import numpy as np
from mathutils.bvhtree import BVHTree
paint_files = {'side': PAINT}
for name in ('up', 'down'):
    f = os.path.join(os.path.dirname(PAINT), f'painted-{name}.png')
    # the Tokyo geometry follows the side painting; the views along the river would not match it
    if os.path.exists(f) and KIND not in ('garden', 'city'): paint_files[name] = f
names = list(paint_files)
mats, pixels = [], {}
for name in names:
    img = bpy.data.images.load(paint_files[name])
    m = bpy.data.materials.new(f'Painted_{name}')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'EXTEND'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    mats.append(m)
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    pixels[name] = px.reshape(H, W, 4)
print('paintings:', ', '.join(names))

def sky(name, u, v):
    px = pixels[name]; H, W = px.shape[:2]
    r, g, b = px[min(H - 1, max(0, int(v * (H - 1)))), min(W - 1, max(0, int(u * (W - 1)))), :3]
    return b > 0.55 and b - r > 0.12 and g - r > 0.02

# the neighbouring stretches are in the paintings' foreground (they were in the blockout), so
# they count as occluders in the visibility test; they are not exported
occluders = [terrain(-260.0, 0.0, 144), terrain(LENGTH, LENGTH + 260.0, 144)]
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
def bvh_of(obj):
    mw = obj.matrix_world
    return BVHTree.FromPolygons([mw @ v.co for v in obj.data.vertices], [list(p.vertices) for p in obj.data.polygons])
occluder_bvh = [bvh_of(oc) for oc in occluders]
usage = {n: 0 for n in names}
for o in projected:
    me = o.data
    me.materials.clear()
    for m in mats: me.materials.append(m)
    mw = o.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    bvh = bvh_of(o)
    centres = [mw @ p.center for p in me.polygons]
    normals = [(nm @ p.normal).normalized() for p in me.polygons]
    # score every face for every painting: how squarely it faces that camera, if it is in view
    # and not hidden behind other terrain; the side painting wins ties (it has the most detail)
    best = [(-1.0, 'side')] * len(me.polygons)
    for name in names:
        c = CAMS[name]; use_cam(c)
        cl = c.matrix_world.translation
        for i, p in enumerate(me.polygons):
            ctr, n = centres[i], normals[i]
            to = cl - ctr; dist = to.length; d = to / dist
            facing = n.dot(d)
            if facing < 0.08: continue
            q = world_to_camera_view(scene, c, ctr)
            if not (0.0 < q.x < 1.0 and 0.0 < q.y < 1.0 and q.z > 0): continue
            hidden = False
            for tree in [bvh] + occluder_bvh:
                hit = tree.ray_cast(ctr + n * 0.05, d, dist)
                if hit[0] is not None and hit[3] < dist - 0.5: hidden = True; break
            if hidden: continue
            score = facing * (1.15 if name == 'side' else 1.0)
            if score > best[i][0]: best[i] = (score, name)
    uv = me.uv_layers.new(name='UVMap')
    for name in names:
        use_cam(CAMS[name])
        idx = names.index(name)
        for i, p in enumerate(me.polygons):
            if best[i][1] != name: continue
            p.material_index = idx
            usage[name] += 1
            for li in p.loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                # the top of the ledge at the water is seen almost edge-on by the side camera, so
                # its painted lupine/grass strip sits a little above it: sample there
                if name == 'side' and KIND == 'cliffs' and o is bank_obj and co.z > 0.3 and 0.05 < -co.x - bank(co.y) < LEDGE + 0.3:
                    co = co + Vector((0, 0, LEDGE_LIFT))
                q = world_to_camera_view(scene, CAMS[name], co)
                uv.data[li].uv = (q.x, q.y)
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    # cut the terrain at the painted skyline: faces whose painting shows sky rise above what was
    # painted and would be smeared with sky colour; the panorama shows behind instead.
    # Cliffs only – the glacier's blue ice would read as sky.
    if KIND in ('cliffs', 'garden') and o is bank_obj:
        sky_face = set()
        for i, p in enumerate(me.polygons):
            if centres[i].z <= 4.0: continue
            name = best[i][1]
            loops = list(p.loop_indices)
            hits = sum(1 for li in loops if sky(name, *uv.data[li].uv))
            mid = sum((uv.data[li].uv for li in loops), Vector((0, 0))) / len(loops)
            if hits * 2 >= len(loops) or sky(name, mid.x, mid.y): sky_face.add(i)
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in sky_face], context='FACES')
        bm.to_mesh(me); bm.free()
        print(f'cut {len(sky_face)} faces above the painted skyline')
print('faces per painting:', usage)
for oc in occluders: bpy.data.objects.remove(oc, do_unlink=True)
use_cam(cam)

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
