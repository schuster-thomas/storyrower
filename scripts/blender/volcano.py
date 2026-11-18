# StoryRower – the volcano at the end of the valley (matte painting with a lava mask).
#
# Builds an Icelandic stratovolcano as coloured geometry – crater, ridges and gullies, snow, moss on
# the lower slopes and a few grooves of old lava running down from the crater – and renders it from
# the river:
#   <out>/blockout.png  hint colours on a flat magenta background → scripts/painted/paint.mjs volcano
#   <out>/mask.png      data for the lava shader, pixel-aligned with the blockout:
#                         R = lava channel (1 in the middle of a groove, soft falloff to the sides)
#                         G = how far down the channel (0 at the crater rim, 1 where it ends)
#                         B = crater (1 inside the crater, where the glow sits)
# The game shows the painting on a plane and lets the lava flow down the channels with the story
# (src/game/scene/Volcano.ts). The volcano is 700–780 m away, so a plane is enough: the camera
# never moves far enough sideways for parallax.
#
#   blender --background --factory-startup --python scripts/blender/volcano.py -- assets/raw/painted/volcano
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/painted/volcano')
os.makedirs(OUT, exist_ok=True)

R = 260.0          # base radius
H = 150.0          # height of the rim
RC = 26.0          # crater radius
CRATER_DEPTH = 16.0
UC = RC / R

# camera on the river: 600 m away, eye 13 m above the volcano's foot (the game camera sits ~3 m
# above the water, the foot lies ~10 m below it); the horizon sits 10 % above the image bottom
DIST, EYE = 600.0, 13.0
RES = (3072, 1024)
HALF_W = R + 30.0                      # half the image width at the volcano's axis
HFOV = 2 * math.atan(HALF_W / DIST)
HORIZON = 0.10

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def n1(x, y, s=1.0, seed=0.0):
    return noise.noise(Vector((x * s, y * s, seed)))

def lin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [srgb_to_lin(x) for x in c]

def srgb_to_lin(x):
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]

# ---------------------------------------------------------------- lava channels
# theta = angle around the cone, -90° faces the camera. Each channel starts at the crater rim (or
# branches off another one) and runs down to u_end (fraction of the base radius).
FRONT = -math.pi / 2
def ch(theta0, u0, u1, wig, drift, seed):
    return dict(theta0=theta0, u0=u0, u1=u1, wig=wig, drift=drift, seed=seed)
CHANNELS = [
    ch(FRONT - 0.20, UC, 0.98, 0.07, -0.10, 1.0),
    ch(FRONT + 0.05, UC, 1.00, 0.06, 0.06, 2.0),
    ch(FRONT + 0.32, UC, 0.86, 0.08, 0.16, 3.0),
    ch(FRONT - 0.55, UC, 0.74, 0.06, -0.14, 4.0),
    ch(FRONT + 0.70, UC, 0.68, 0.05, 0.12, 5.0),
]
# a branch splitting off the second channel halfway down
def centre(c, u):
    return c['theta0'] + c['drift'] * (u - c['u0']) / (1 - UC) + c['wig'] * math.sin((u - c['u0']) * 9.0 + c['seed'] * 1.7) * smooth(c['u0'], c['u0'] + 0.15, u)
BRANCH_U = 0.52
CHANNELS.append(ch(centre(CHANNELS[1], BRANCH_U), BRANCH_U, 0.96, 0.05, 0.22, 6.0))

def channel_at(theta, u):
    """strongest channel at this point: (weight 0–1, distance down the channel 0–1)"""
    r = u * R
    best = (0.0, 0.0)
    for c in CHANNELS:
        if u < c['u0'] - 0.02 or u > c['u1'] + 0.02:
            continue
        dt = (theta - centre(c, u) + math.pi) % (2 * math.pi) - math.pi
        dist = abs(dt) * r
        width = 3.5 + 9.0 * (u - UC) / (1 - UC)
        w = math.exp(-(dist / width) ** 2)
        # starts at the rim / branch point, ends with a rounded tongue
        w *= smooth(c['u0'] - 0.01, c['u0'] + 0.02, u) * (1 - smooth(c['u1'] - 0.04, c['u1'], u))
        if w > best[0]:
            # every channel measures from the crater, so a branch continues its parent's flow
            best = (w, (u - UC) / (c['u1'] - UC))
    return best

# ---------------------------------------------------------------- the cone
def height(theta, u):
    if u < UC:
        k = u / UC
        return H - CRATER_DEPTH * (1 - k * k) + 2.0 * smooth(0.85, 1.0, k)
    t = (1 - u) / (1 - UC)
    z = H * t ** 1.55 + 2.0 * smooth(UC + 0.03, UC, u)
    # radial ridges and gullies, strongest on the middle slopes
    amp = 9.0 * math.sin(math.pi * min(1.0, (u - UC) / (1 - UC))) ** 0.8
    ridge = n1(math.cos(theta) * 3.2, math.sin(theta) * 3.2, 1.0, u * 1.4)
    z += amp * ridge
    w, _ = channel_at(theta, u)
    z -= 4.5 * w      # the old lava grooves
    return max(0.0, z)

COL = {
    'moss': lin(0x6f9a3c), 'moss_dark': lin(0x4f7a32), 'ochre': lin(0xb0703c), 'rust': lin(0x8a4a30),
    'ash': lin(0x4d4342), 'snow': lin(0xf2f4f7), 'groove': lin(0x241a18), 'crater': lin(0x5e2016),
}

def colour(theta, u, z):
    if u < UC:
        return COL['crater']
    k = (u - UC) / (1 - UC)
    n = n1(math.cos(theta) * 5, math.sin(theta) * 5, 1.0, 9.0 + u * 3)
    c = mix(COL['ash'], COL['rust'], smooth(0.08, 0.3, k))
    c = mix(c, COL['ochre'], smooth(0.25, 0.5, k) * (0.5 + 0.5 * n))
    c = mix(c, COL['moss'], smooth(0.55, 0.78, k + 0.08 * n))
    c = mix(c, COL['moss_dark'], smooth(0.85, 1.0, k) * 0.6)
    # snow in the upper gullies
    ridge = n1(math.cos(theta) * 3.2, math.sin(theta) * 3.2, 1.0, u * 1.4)
    snow = smooth(0.42, 0.18, k) * smooth(-0.05, -0.25, ridge) * smooth(0.1, 0.25, k)
    c = mix(c, COL['snow'], min(1.0, snow * 1.6))
    w, _ = channel_at(theta, u)
    return mix(c, COL['groove'], smooth(0.25, 0.7, w))

NT, NR = 420, 170
me = bpy.data.meshes.new('Volcano')
bm = bmesh.new()
grid = []
us = [UC * (i / 24) ** 0.8 for i in range(1, 25)] + [UC + (1 - UC) * (i / (NR - 24)) for i in range(1, NR - 24 + 1)]
centre_v = bm.verts.new((0, 0, H - CRATER_DEPTH))
for u in us:
    row = []
    for j in range(NT):
        th = -math.pi + 2 * math.pi * j / NT
        v = bm.verts.new((math.cos(th) * u * R, math.sin(th) * u * R, height(th, u)))
        row.append(v)
    grid.append(row)
for j in range(NT):
    bm.faces.new((centre_v, grid[0][j], grid[0][(j + 1) % NT]))
for i in range(len(grid) - 1):
    for j in range(NT):
        a, b = grid[i][j], grid[i][(j + 1) % NT]
        c, d = grid[i + 1][(j + 1) % NT], grid[i + 1][j]
        bm.faces.new((a, d, c, b))
bm.to_mesh(me); bm.free()
obj = bpy.data.objects.new('Volcano', me)
scene = bpy.context.scene
for o in list(scene.collection.objects): bpy.data.objects.remove(o, do_unlink=True)
scene.collection.objects.link(obj)

hint = me.color_attributes.new('Hint', 'FLOAT_COLOR', 'POINT')
mask = me.color_attributes.new('Mask', 'FLOAT_COLOR', 'POINT')
for v in me.vertices:
    x, y, z = v.co
    u = math.hypot(x, y) / R
    th = math.atan2(y, x)
    c = colour(th, u, z)
    hint.data[v.index].color = (*c, 1.0)
    w, d = channel_at(th, u)
    crater = 1.0 if u < UC * 0.92 else 0.0
    # stored so that the rendered pixel (sRGB-encoded) equals the data value
    mask.data[v.index].color = (srgb_to_lin(w), srgb_to_lin(min(1.0, d) if w > 0.02 else 0.0), srgb_to_lin(crater), 1.0)

# ---------------------------------------------------------------- camera and renders
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
cam.location = (0, -DIST, EYE)
cam.rotation_euler = (math.pi / 2, 0, 0)      # looking along +Y, level
cam.data.sensor_fit = 'HORIZONTAL'
cam.data.lens = 18 / math.tan(HFOV / 2)
cam.data.shift_y = (0.5 - HORIZON) * RES[1] / RES[0]
cam.data.clip_end = 5000
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'VERTEX'
scene.display.shading.background_type = 'VIEWPORT'
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('Sky')

def render(attr, bg, path):
    me.color_attributes.active_color = me.color_attributes[attr]
    scene.display.shading.background_color = bg
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

render('Hint', (1.0, 0.0, 1.0), f'{OUT}/blockout.png')
render('Mask', (0.0, 0.0, 0.0), f'{OUT}/mask.png')

# where things sit in the image (fractions from the bottom-left), for the game
def to_image(p):
    from bpy_extras.object_utils import world_to_camera_view
    q = world_to_camera_view(scene, cam, Vector(p))
    return [round(q.x, 4), round(q.y, 4)]
meta = {
    'size': RES,
    'crater': to_image((0, 0, H)),
    'craterLeft': to_image((-RC, 0, H)), 'craterRight': to_image((RC, 0, H)),
    'horizon': HORIZON,
    # metres per image width at the volcano's axis (to scale the plane in the game)
    'widthAtAxis': round(2 * HALF_W, 1), 'eye': EYE, 'distance': DIST,
}
with open(f'{OUT}/volcano.json', 'w') as f: json.dump(meta, f, indent=2)
print('rendered', meta)
