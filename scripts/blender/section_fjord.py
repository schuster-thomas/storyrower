# StoryRower – authored river section "Fjord Morning".
#
# Composes a 200 m stretch of Icelandic river from CC0 Poly Haven scans (cliff walls, boulders,
# mossy shore stones) on a sculpted terrain with real grass/moss/rock textures, lit by a morning
# sky HDRI. The terrain lighting (sun, sky, bounce light, shadows of the cliffs) is baked into a
# texture; the scans keep their own textures and are lit live in the game. Exports a GLB plus a
# JSON with sun direction and placements for live vegetation.
#
#   blender --background --factory-startup --python scripts/blender/section_fjord.py -- <outdir> [--preview] [--samples N] [--tex N]
#
# Coordinates: Blender is Z-up. The river runs along +Y (= -Z in three.js), centred on X = 0.
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/sections')
PREVIEW = '--preview' in ARGS
def arg(name, default):
    return int(ARGS[ARGS.index(name) + 1]) if name in ARGS else default
SAMPLES = arg('--samples', 128)
TEX = arg('--tex', 2048)
os.makedirs(OUT, exist_ok=True)
PH = os.path.abspath('assets/raw/polyhaven')

LENGTH = 200.0
RIVER_HALF = 9.0
WIDTH = 95.0
HDRI = f'{PH}/hdris/qwantani_morning_puresky/qwantani_morning_puresky.hdr'
SUN_AZ_WANTED = Vector((0.85, -0.35, 0)).normalized()     # sun from the right, slightly behind: lights the cliff face

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def n2(x, y, s=1.0, seed=0.0):
    return noise.noise(Vector((x * s, y * s, seed)))

# ---------------------------------------------------------------- terrain height
WATERFALLS = [72.0, 132.0]

def cliff_line(y):
    return 14.0 + n2(0, y, 0.035, 3.1) * 3.0

def height(x, y):
    d = abs(x) - RIVER_HALF
    bank = smooth(-1.5, 2.5, d) * 1.1 - 0.5
    bed = -1.4 * smooth(-0.5, -6.0, d)
    edge = smooth(0, 22, y) * smooth(LENGTH, LENGTH - 22, y)
    h = bank + bed
    if x < 0:
        c = cliff_line(y)
        # steep backing wall behind the scanned cliff pieces, plateau on top
        rise = smooth(c + 1, c + 7, d) * (26.0 + n2(x, y, 0.05, 7.0) * 4.0)
        for wy in WATERFALLS:
            rise -= math.exp(-((y - wy) / 5.0) ** 2) * 9.0 * smooth(c, c + 10, d)
        plateau = smooth(c + 8, c + 45, d) * (n2(x, y, 0.03, 11.0) * 5.0 + 3.0)
        h += (rise + plateau) * edge
        h += smooth(1, 6, d) * n2(x, y, 0.25, 5.0) * 0.35
    else:
        hills = (n2(x, y, 0.025, 1.0) * 0.6 + n2(x, y, 0.07, 2.0) * 0.4 + 0.6) * 9.0 * smooth(10, 55, d)
        h += hills * (0.35 + 0.65 * edge)
        h += smooth(0, 4, d) * n2(x, y, 0.3, 4.0) * 0.3
    return h

# ---------------------------------------------------------------- scene, GPU, colour management
bpy.ops.wm.read_factory_settings(use_empty=True)
prefs = bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = backend
        prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices: d.use = d.type == backend
            break
    except Exception:
        pass
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'AgX'
for look in ('AgX - Punchy', 'Punchy'):
    try:
        sc.view_settings.look = look
        break
    except Exception:
        pass

# ---------------------------------------------------------------- sky HDRI, rotated so the sun sits ahead-right
world = bpy.data.worlds.new('Sky'); sc.world = world
world.use_nodes = True
wn = world.node_tree.nodes; wn.clear(); wl = world.node_tree.links.new
env = wn.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
img = env.image
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
vy, ux = np.unravel_index(np.argmax(lum), lum.shape)
u, v = (ux + 0.5) / w, (vy + 0.5) / h
# Blender equirect: u = -atan2(y, x) / 2pi + 0.5, v = atan2(z, hypot(x, y)) / pi + 0.5
az_s, el = -(u - 0.5) * 2 * math.pi, (v - 0.5) * math.pi
az_d = math.atan2(SUN_AZ_WANTED.y, SUN_AZ_WANTED.x)
phi = az_s - az_d   # mapping rotates the lookup direction: R(phi) * wanted = hdri sun
SUN_DIR = Vector((math.cos(el) * SUN_AZ_WANTED.x, math.cos(el) * SUN_AZ_WANTED.y, math.sin(el))).normalized()
print(f'HDRI sun elevation {math.degrees(el):.1f}°, rotating sky by {math.degrees(phi):.1f}°')
tc = wn.new('ShaderNodeTexCoord'); mp = wn.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, 0, phi)
wl(tc.outputs['Generated'], mp.inputs['Vector']); wl(mp.outputs['Vector'], env.inputs['Vector'])
bg = wn.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.3
outw = wn.new('ShaderNodeOutputWorld')
wl(env.outputs['Color'], bg.inputs['Color']); wl(bg.outputs['Background'], outw.inputs['Surface'])

# ---------------------------------------------------------------- terrain mesh
xs_side = []
x = RIVER_HALF - 3.0
while x < WIDTH:
    xs_side.append(x)
    x += 0.7 if x < RIVER_HALF + 28 else (1.6 if x < RIVER_HALF + 50 else 4.0)
xs_side.append(WIDTH)
xs = [-x for x in reversed(xs_side)] + xs_side
ys = [i * 1.0 for i in range(int(LENGTH) + 1)]
bm = bmesh.new()
grid = [[bm.verts.new((x, y, height(x, y))) for x in xs] for y in ys]
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        if xs[i] < 0 < xs[i + 1]:
            continue
        bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
mesh = bpy.data.meshes.new('Terrain'); bm.to_mesh(mesh); bm.free()
terrain = bpy.data.objects.new('Terrain', mesh); sc.collection.objects.link(terrain)
for p in mesh.polygons: p.use_smooth = True

# Terrain material: scanned grass / moss / rock textures blended by slope, height and noise
def tex_path(tid, kind):
    for ext in ('jpg', 'png'):
        p = f'{PH}/textures/{tid}/{tid}_{kind}.{ext}'
        if os.path.exists(p): return p
    raise FileNotFoundError(tid + kind)

mat = bpy.data.materials.new('TerrainMat'); mat.use_nodes = True
nt = mat.node_tree; N = nt.nodes; N.clear(); L = nt.links.new
outm = N.new('ShaderNodeOutputMaterial')
bsdf = N.new('ShaderNodeBsdfPrincipled'); bsdf.inputs['Roughness'].default_value = 0.9
L(bsdf.outputs[0], outm.inputs['Surface'])
geo = N.new('ShaderNodeNewGeometry')
coords = N.new('ShaderNodeTexCoord')
sep_n = N.new('ShaderNodeSeparateXYZ'); L(geo.outputs['Normal'], sep_n.inputs[0])
sep_p = N.new('ShaderNodeSeparateXYZ'); L(geo.outputs['Position'], sep_p.inputs[0])

def mapped(scale):
    m = N.new('ShaderNodeMapping'); m.inputs['Scale'].default_value = (scale, scale, scale)
    L(coords.outputs['Object'], m.inputs['Vector']); return m.outputs['Vector']
def image(tid, kind, scale, box=False, data=False):
    t = N.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(tex_path(tid, kind))
    if data: t.image.colorspace_settings.name = 'Non-Color'
    if box: t.projection = 'BOX'; t.projection_blend = 0.35
    L(mapped(scale), t.inputs['Vector']); return t
def mix(fac, a, b, kind='RGBA'):
    m = N.new('ShaderNodeMix'); m.data_type = kind
    L(fac, m.inputs['Factor'])
    ia, ib = (6, 7) if kind == 'RGBA' else (4, 5)
    L(a, m.inputs[ia]); L(b, m.inputs[ib]); return m.outputs[2 if kind == 'RGBA' else 1]
def ramp(src, a, b):
    r = N.new('ShaderNodeMapRange'); L(src, r.inputs['Value'])
    r.inputs['From Min'].default_value = a; r.inputs['From Max'].default_value = b
    r.interpolation_type = 'SMOOTHSTEP'; return r.outputs[0]
def noise_tex(scale):
    t = N.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = scale; t.inputs['Detail'].default_value = 4
    L(coords.outputs['Object'], t.inputs['Vector']); return t.outputs['Fac']
def tint(col, rgb, amount):
    c = N.new('ShaderNodeRGB'); c.outputs[0].default_value = (*rgb, 1)
    m = N.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = 'MULTIPLY'
    m.inputs['Factor'].default_value = amount; L(col, m.inputs[6]); L(c.outputs[0], m.inputs[7]); return m.outputs[2]

grass_c = image('sparse_grass', 'Diffuse', 0.3); grass_n = image('sparse_grass', 'nor_gl', 0.3, data=True)
gr2_c = image('aerial_grass_rock', 'Diffuse', 0.12); gr2_n = image('aerial_grass_rock', 'nor_gl', 0.12, data=True)
moss_c = image('mossy_rock', 'Diffuse', 0.18, box=True); moss_n = image('mossy_rock', 'nor_gl', 0.18, box=True, data=True)
rock_c = image('rock_face', 'Diffuse', 0.08, box=True); rock_n = image('rock_face', 'nor_gl', 0.08, box=True, data=True)

# greener, fresher grass (Icelandic summer) and a few lupine-tinted patches
grass = tint(grass_c.outputs['Color'], (0.45, 1.0, 0.25), 0.85)
grass = mix(ramp(noise_tex(0.05), 0.55, 0.75), grass, tint(gr2_c.outputs['Color'], (0.8, 1.0, 0.6), 0.4))
lupine = ramp(noise_tex(0.11), 0.66, 0.72)
grass = mix(lupine, grass, tint(grass_c.outputs['Color'], (0.75, 0.45, 1.0), 0.85))
near_water = ramp(sep_p.outputs['Z'], 1.0, -0.2)
ground = mix(near_water, grass, moss_c.outputs['Color'])
steep = ramp(sep_n.outputs['Z'], 0.7, 0.5)
very_steep = ramp(sep_n.outputs['Z'], 0.45, 0.25)
rock = mix(ramp(noise_tex(0.08), 0.4, 0.6), moss_c.outputs['Color'], rock_c.outputs['Color'])
col = mix(steep, ground, rock)
col = mix(very_steep, col, rock_c.outputs['Color'])
L(col, bsdf.inputs['Base Color'])
# normals follow the same masks
nrm = mix(steep, grass_n.outputs['Color'], moss_n.outputs['Color'])
nrm = mix(very_steep, nrm, rock_n.outputs['Color'])
nmap = N.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.8
L(nrm, nmap.inputs['Color']); L(nmap.outputs['Normal'], bsdf.inputs['Normal'])
terrain.data.materials.append(mat)

# ---------------------------------------------------------------- scanned cliffs and rocks
def load_scan(mid, target_tris):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{PH}/models/{mid}/{mid}.gltf')
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if tris > target_tris:
            mod = o.modifiers.new('decimate', 'DECIMATE'); mod.ratio = target_tris / tris
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
        o.name = mid
        o.data.name = mid
        sc.collection.objects.unlink(o) if o.name in sc.collection.objects else None
        for c in o.users_collection: c.objects.unlink(o)
    return objs

lib = {mid: load_scan(mid, t) for mid, t in [('mountainside', 14000), ('rock_face_01', 9000), ('boulder_01', 4000), ('rock_moss_set_01', 6000)]}
placed = []
def put(mid, x, y, z, scale, rot_z, idx=0):
    src = lib[mid][idx % len(lib[mid])]
    o = bpy.data.objects.new(f'{mid}.{len(placed)}', src.data)   # linked duplicate → shared mesh in glTF
    o.location = (x, y, z); o.scale = (scale, scale, scale); o.rotation_euler = (0, 0, rot_z)
    sc.collection.objects.link(o); placed.append(o)
    return o

rs = [7]
def rnd():
    rs[0] = (rs[0] * 1103515245 + 12345) & 0x7fffffff
    return rs[0] / 0x7fffffff

# Cliff wall on the left: scanned rock faces turned towards the river, gaps for the waterfalls
y = 6.0
while y < LENGTH - 6:
    if any(abs(y - wy) < 15 for wy in WATERFALLS):
        y += 6; continue
    c = cliff_line(y)
    mid = 'mountainside' if rnd() < 0.65 else 'rock_face_01'
    s = (4.2 + rnd() * 1.2) if mid == 'mountainside' else (7.0 + rnd() * 2.0)
    x = -(RIVER_HALF + c + 0.5 + rnd() * 1.5)   # in front of the backing wall, covering it
    put(mid, x, y, height(x, y) - 1.5, s, math.radians(90 + (rnd() - 0.5) * 30))
    y += (7 + rnd() * 4) * (s / 4.0)
# Boulders on the meadow and the left bank
for _ in range(9):
    sd = 1 if rnd() < 0.7 else -1
    xx = sd * (RIVER_HALF + 4 + rnd() * (30 if sd > 0 else 8)); yy = 10 + rnd() * (LENGTH - 20)
    put('boulder_01', xx, yy, height(xx, yy) - 0.3, 1.6 + rnd() * 2.2, rnd() * 6.28)
# Mossy stones along both shores
for k in range(26):
    sd = -1 if k % 2 else 1
    xx = sd * (RIVER_HALF - 0.3 + rnd() * 1.6); yy = rnd() * LENGTH
    put('rock_moss_set_01', xx, yy, height(xx, yy) - 0.25, 0.8 + rnd() * 0.6, rnd() * 6.28, idx=k)

# ---------------------------------------------------------------- waterfalls (animated in the game)
fall_mat = bpy.data.materials.new('Waterfall'); fall_mat.use_nodes = True
fp = fall_mat.node_tree.nodes['Principled BSDF']; fp.inputs['Base Color'].default_value = (0.92, 0.97, 1.0, 1)
fp.inputs['Emission Color'].default_value = (0.8, 0.9, 1.0, 1); fp.inputs['Emission Strength'].default_value = 0.3
for k, wy in enumerate(WATERFALLS):
    c = cliff_line(wy)
    top = height(-(RIVER_HALF + c + 12), wy) - 1.0
    xx = -(RIVER_HALF + c + 1.0)
    bpy.ops.mesh.primitive_plane_add(size=1)
    f = bpy.context.object; f.name = f'Waterfall_{k + 1}'
    f.scale = (top + 1.5, 5.5, 1); f.rotation_euler = (0, math.radians(90), 0)
    f.location = (xx, wy, (top - 1.0) / 2)
    f.data.materials.append(fall_mat)

# ---------------------------------------------------------------- live vegetation placements
def slope(x, y):
    return abs(height(x + 1, y) - height(x - 1, y)) + abs(height(x, y + 1) - height(x, y - 1))
placements = []
def place(kind, x, y, s, sink=0.05):
    if slope(x, y) > 1.4: return
    placements.append({'m': kind, 'p': [round(x, 2), round(height(x, y) - sink, 2), round(y, 2)], 'r': round(rnd() * 6.283, 2), 's': round(s, 2)})
for _ in range(1100):
    sd = -1 if rnd() < 0.35 else 1
    xx = sd * (RIVER_HALF + 0.6 + rnd() ** 1.5 * (12 if sd < 0 else 40))
    place(['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Tall'][int(rnd() * 3)], xx, rnd() * LENGTH, 0.9 + rnd() * 0.9)
for _ in range(110):
    cx, cy = RIVER_HALF + 3 + rnd() * 30, rnd() * LENGTH
    if rnd() < 0.25: cx = -(RIVER_HALF + 1.5 + rnd() * 8)
    for _ in range(8): place('Lupine', cx + (rnd() - 0.5) * 4, cy + (rnd() - 0.5) * 4, 0.9 + rnd() * 0.6)
for _ in range(36): place('Flower_4_Group', RIVER_HALF + 2 + rnd() * 25, rnd() * LENGTH, 0.8 + rnd() * 0.5)
for k in range(5):
    sd = -1 if k % 2 else 1
    placements.append({'m': 'Iceberg_1' if k % 2 else 'Iceberg_2', 'p': [round(sd * (RIVER_HALF - 2.4 - rnd() * 1.4), 2), -0.7, round(20 + k * 38 + rnd() * 10, 2)], 'r': round(rnd() * 6.28, 2), 's': round(0.6 + rnd() * 0.5, 2)})

# ---------------------------------------------------------------- preview from the rower's point of view
if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); cam.data.lens = 22
    sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, 22, 3.6); cam.rotation_euler = (math.radians(84), 0, 0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, LENGTH / 2, 0))
    wtr = bpy.context.object; wtr.scale = (RIVER_HALF * 2 + 4, LENGTH, 1)
    wm = bpy.data.materials.new('WaterPreview'); wm.use_nodes = True
    p = wm.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.02, 0.12, 0.2, 1); p.inputs['Roughness'].default_value = 0.06
    wtr.data.materials.append(wm)
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.cycles.samples = 96
    sc.render.filepath = os.path.join(OUT, 'fjord_preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(wtr)
    sc.cycles.samples = SAMPLES

# ---------------------------------------------------------------- bake the terrain lighting
bpy.ops.object.select_all(action='DESELECT')
terrain.select_set(True); bpy.context.view_layer.objects.active = terrain
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
bpy.ops.object.mode_set(mode='OBJECT')
bake_img = bpy.data.images.new('TerrainBake', TEX, TEX)
bake_node = N.new('ShaderNodeTexImage'); bake_node.image = bake_img; N.active = bake_node
sc.render.bake.margin = 6
print('baking …')
bpy.ops.object.bake(type='COMBINED', pass_filter={'DIRECT', 'INDIRECT', 'DIFFUSE', 'GLOSSY', 'EMIT'})
bake_img.filepath_raw = os.path.join(OUT, 'fjord_terrain_bake.png'); bake_img.file_format = 'PNG'; bake_img.save()
baked = bpy.data.materials.new('Baked_Terrain'); baked.use_nodes = True
bt = baked.node_tree.nodes.new('ShaderNodeTexImage'); bt.image = bake_img
baked.node_tree.links.new(bt.outputs['Color'], baked.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
terrain.data.materials[0] = baked

# ---------------------------------------------------------------- export
for o in sc.objects:
    o.select_set(o.name == 'Terrain' or o.name.startswith('Waterfall_') or o in placed)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'fjord.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_image_format='JPEG', export_jpeg_quality=88)
with open(os.path.join(OUT, 'fjord.placements.json'), 'w') as f:
    json.dump({'length': LENGTH, 'riverHalf': RIVER_HALF, 'sunDir': [SUN_DIR.x, SUN_DIR.z, -SUN_DIR.y],
               'items': [{**it, 'p': [it['p'][0], it['p'][1], -it['p'][2]]} for it in placements]}, f)
print('exported', len(placed), 'scans,', len(placements), 'placements')
