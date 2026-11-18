# StoryRower – painted props in the water: icebergs and rocks (matte painting from all sides).
#
# Builds four icebergs or four rocks as coloured geometry (hint colours like the river banks) and
# renders them from five directions – four sides and one from above – each time lined up in a row
# across that view, so no object hides another:
#   1. blockout:  <out>/blockout-<view>.png   (views: w, e, n, s, top)
#   2. paint-over: scripts/painted/props.mjs <kind> paints every view in the game's style, then
#                 props.mjs <kind> fill fills the paintings' backgrounds with the objects' edge colours
#   3. project:   --paint projects the paintings back: every face takes the view that sees it most
#                 squarely (and unhidden), exports <out>/props.glb (objects Ice_A…D / Rock_A…D)
#
#   blender --background --factory-startup --python scripts/blender/props.py -- <outdir> --kind ice|rocks [--paint]
#
# Coordinates: Blender Z-up, the waterline at z = 0, every object at the origin when exported.
import bpy, bmesh, math, os, sys
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/raw/painted/ice')
KIND = ARGS[ARGS.index('--kind') + 1] if '--kind' in ARGS else 'ice'
PAINT = '--paint' in ARGS
os.makedirs(OUT, exist_ok=True)

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def n3(v, s=1.0, seed=0.0):
    return noise.noise(Vector((v.x * s + seed * 17.0, v.y * s - seed * 9.0, v.z * s + seed * 5.0)))

def lin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]

scene = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)   # incl. the start-up cube

# ---------------------------------------------------------------- shapes
def blob(name, subdiv, shape):
    """an icosphere pushed into shape by `shape(v)` → new position; faceted on purpose"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        v.co = shape(v.co.copy())
    # nothing far below the water is ever seen
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if max(v.co.z for v in f.verts) < -0.7], context='FACES')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # shaping can turn faces; the projection needs them pointing out
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o

def jag(v, amount, s, seed):
    """push along the direction from the centre: jagged, angular ice / rock"""
    d = Vector((v.x, v.y, v.z * 0.6)).normalized() if v.length > 1e-4 else Vector((0, 0, 1))
    return v + d * (n3(v, s, seed) * amount)

def columns(name, specs):
    """basalt sea stack: a cluster of hexagonal columns with slanted tops"""
    bm = bmesh.new()
    for (x, y, r, h, slant) in specs:
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6, radius1=r, radius2=r, depth=h + 1.0)
        for v in res['verts']:
            v.co.z += (h + 1.0) / 2 - 1.0
            if v.co.z > h - 0.2:
                v.co.z = h + v.co.x * slant
            v.co.x += x; v.co.y += y
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o

def ice_tabular(v):
    v = Vector((v.x * 3.2, v.y * 2.2, v.z * 2.2 + 0.5))
    top = 1.5 + n3(v, 0.6, 1.0) * 0.12      # a flat table with steep walls
    if v.z > top: v.z = top
    v = jag(v, 0.35, 0.9, 2.0)
    # vertical grooves down the walls
    a = math.atan2(v.y, v.x)
    v.x += math.cos(a) * math.sin(a * 9 + v.z * 0.5) * 0.12
    v.y += math.sin(a) * math.sin(a * 9 + v.z * 0.5) * 0.12
    return v

def ice_pinnacle(v):
    v = Vector((v.x * 1.7, v.y * 1.5, v.z * 2.2 + 1.0))
    # a second, lower peak beside the main one
    if v.z > 1.2:
        v.z += 1.0 * math.exp(-((v.x - 0.6) ** 2 + v.y ** 2) / 0.5) - 0.4 * max(0.0, v.x + 0.3)
    return jag(v, 0.45, 0.8, 3.0)

def ice_chunk(v):
    v = Vector((v.x * 1.6, v.y * 1.2, v.z * 1.0 + 0.3))
    return jag(v, 0.3, 1.1, 4.0)

def ice_small(v):
    v = Vector((v.x * 0.9, v.y * 0.7, v.z * 0.55 + 0.15))
    return jag(v, 0.15, 1.6, 5.0)

def rock_puffin(v):
    """low, broad rock with a flat-ish mossy top for the puffins"""
    v = Vector((v.x * 2.6, v.y * 2.0, v.z * 1.8 + 0.3))
    top = 1.5 + n3(v, 0.7, 6.0) * 0.12
    if v.z > top: v.z = top + (v.z - top) * 0.15
    return jag(v, 0.35, 0.8, 7.0)

def rock_boulder(v):
    v = Vector((v.x * 1.4, v.y * 1.1, v.z * 0.95 + 0.2))
    return jag(v, 0.25, 1.0, 8.0)

def rock_ledge(v):
    v = Vector((v.x * 2.2, v.y * 1.4, v.z * 0.6 + 0.1))
    top = 0.45 + n3(v, 1.0, 9.0) * 0.08
    if v.z > top: v.z = top
    return jag(v, 0.2, 0.9, 9.5)

if KIND == 'ice':
    OBJS = [blob('Ice_A', 3, ice_tabular), blob('Ice_B', 3, ice_pinnacle), blob('Ice_C', 3, ice_chunk), blob('Ice_D', 2, ice_small)]
else:
    OBJS = [
        blob('Rock_A', 3, rock_puffin),
        columns('Rock_B', [(0, 0, 0.75, 7.2, 0.25), (1.05, 0.35, 0.6, 6.1, -0.3), (-0.95, 0.4, 0.62, 5.6, 0.35),
                           (0.3, -0.95, 0.58, 4.9, 0.2), (-0.5, -0.8, 0.5, 3.6, -0.25), (0.9, -0.7, 0.45, 2.4, 0.3),
                           (-1.4, -0.2, 0.42, 1.6, 0.2)]),
        blob('Rock_C', 3, rock_boulder),
        blob('Rock_D', 3, rock_ledge),
    ]

# ---------------------------------------------------------------- hint colours
COL = {
    'snow': lin(0xf4f8fb), 'ice': lin(0x9fd8ef), 'ice_deep': lin(0x3f8fd0), 'crack': lin(0x1f5fa8),
    'waterline': lin(0x5cc8cf), 'under': lin(0x2a8fa8),
    'basalt': lin(0x3a3a40), 'basalt_lit': lin(0x5c5c64), 'moss': lin(0x6f9a3c), 'wet': lin(0x1c1c20), 'lichen': lin(0xc8c39a),
}

def hint(o):
    me = o.data
    attr = me.color_attributes.new('Hint', 'FLOAT_COLOR', 'CORNER')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            k = n3(co, 1.3, 11.0)
            if KIND == 'ice':
                c = mix(COL['ice'], COL['ice_deep'], smooth(0.05, 0.45, k))
                c = mix(c, COL['crack'], smooth(0.45, 0.6, k) * smooth(0.6, 0.2, n.z))
                c = mix(c, COL['snow'], smooth(0.45, 0.75, n.z) * smooth(0.2, 0.5, co.z))
                c = mix(c, COL['waterline'], smooth(0.35, 0.05, co.z))
                c = mix(c, COL['under'], smooth(0.0, -0.3, co.z))
            else:
                c = mix(COL['basalt'], COL['basalt_lit'], smooth(0.0, 0.4, k))
                c = mix(c, COL['moss'], smooth(0.45, 0.75, n.z + 0.15 * k) * smooth(0.3, 0.6, co.z))
                c = mix(c, COL['lichen'], smooth(0.55, 0.65, n3(co, 3.0, 12.0)) * 0.6 * smooth(0.5, 0.9, co.z))
                c = mix(c, COL['wet'], smooth(0.45, 0.1, co.z))
            attr.data[li].color = (*c, 1.0)
    me.color_attributes.active_color = attr

for o in OBJS: hint(o)

# ---------------------------------------------------------------- views
# side views look at the row from 15° above (the boat sees the props from a few metres up),
# the top view from 60° for the flat tops
VIEWS = {
    'w': (Vector((1, 0, 0)), 15),     # camera east of the row, looking west (−x)
    'e': (Vector((-1, 0, 0)), 15),
    'n': (Vector((0, -1, 0)), 15),    # camera south, looking north (+y)
    's': (Vector((0, 1, 0)), 15),
    'top': (Vector((0, -1, 0)), 60),
}
RES = (3072, 1024)
sizes = []
for o in OBJS:
    bb = [Vector(c) for c in o.bound_box]
    sizes.append((max(b.x for b in bb) - min(b.x for b in bb), max(b.y for b in bb) - min(b.y for b in bb),
                  max(b.z for b in bb), min(b.z for b in bb)))
GAP = 1.5

def layout(view):
    """object positions for this view: in a row across the viewing direction"""
    d, _ = VIEWS[view]
    across = Vector((-d.y, d.x, 0))
    widths = [max(s[0], s[1]) for s in sizes]
    total = sum(widths) + GAP * (len(widths) - 1)
    pos, at = [], -total / 2
    for w in widths:
        pos.append(across * (at + w / 2))
        at += w + GAP
    return pos, total

cams = {}
for view, (d, elev) in VIEWS.items():
    pos, total = layout(view)
    c = bpy.data.objects.new(f'Cam_{view}', bpy.data.cameras.new(f'Cam_{view}'))
    scene.collection.objects.link(c)
    c.data.type = 'ORTHO'
    c.data.sensor_fit = 'HORIZONTAL'
    top = max(s[2] for s in sizes)
    c.data.ortho_scale = max(total * 1.08, (top + 1.5) * 3.0 / max(0.4, math.cos(math.radians(elev))))
    look = Vector((0, 0, top * 0.42))
    back = -Vector((d.x, d.y, 0)).normalized() if view != 'top' else Vector((0, -1, 0))
    dist = 60.0
    c.location = look + back * dist * math.cos(math.radians(elev)) + Vector((0, 0, dist * math.sin(math.radians(elev))))
    c.rotation_mode = 'QUATERNION'
    c.rotation_quaternion = (look - c.location).to_track_quat('-Z', 'Y')
    c.data.clip_end = 500
    cams[view] = (c, pos)

bpy.context.view_layer.update()   # camera matrices, before anything reads them

def place(view):
    for o, p in zip(OBJS, cams[view][1]): o.location = p
    bpy.context.view_layer.update()

scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.background_type = 'VIEWPORT'
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('Sky')

if not PAINT:
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.background_color = (1.0, 0.0, 1.0)
    for view in VIEWS:
        place(view)
        scene.camera = cams[view][0]
        scene.render.filepath = f'{OUT}/blockout-{view}.png'
        bpy.ops.render.render(write_still=True)
    print('blockouts rendered')
    sys.exit(0)

# ---------------------------------------------------------------- projection
mats = {}
for view in VIEWS:
    # the background of the painting filled with the objects' edge colours (props.mjs fill)
    f = f'{OUT}/painted-{view}.fill.png'
    img = bpy.data.images.load(f if os.path.exists(f) else f'{OUT}/painted-{view}.png')
    m = bpy.data.materials.new(f'Painted_{view}')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'EXTEND'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    mats[view] = m
names = list(VIEWS)
usage = {v: 0 for v in names}
for o in OBJS:
    me = o.data
    me.materials.clear()
    for v in names: me.materials.append(mats[v])
    # self-occlusion in object space (each object only translates between the views)
    bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])
    best = [(-1.0, 'w')] * len(me.polygons)
    # faces no view sees unhidden (undersides, deep notches) at least take the view they face most
    for view in names:
        c, _ = cams[view]
        d = (c.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
        for i, p in enumerate(me.polygons):
            facing = p.normal.dot(-d) - 2.0
            if facing > best[i][0]: best[i] = (facing, view)
    for view in names:
        c, _ = cams[view]
        d = (c.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()   # ortho: one direction
        for i, p in enumerate(me.polygons):
            facing = p.normal.dot(-d)
            if facing < 0.05: continue
            hit = bvh.ray_cast(p.center + p.normal * 0.02, -d, 200.0)
            if hit[0] is not None: continue
            score = facing
            if score > best[i][0]: best[i] = (score, view)
    print(o.name, {v: sum(1 for b in best if b[1] == v) for v in names}, 'unseen', sum(1 for b in best if b[0] < 0))
    if os.environ.get('DEBUG_PROPS') and o is OBJS[0]:
        for i in range(0, len(me.polygons), 40):
            p = me.polygons[i]
            print('  face', i, 'n', tuple(round(x, 2) for x in p.normal), 'c', tuple(round(x, 2) for x in p.center), 'best', best[i])
    uv = me.uv_layers.new(name='UVMap')
    for view in names:
        place(view)
        c, _ = cams[view]
        mw = o.matrix_world
        for i, p in enumerate(me.polygons):
            if best[i][1] != view: continue
            p.material_index = names.index(view)
            usage[view] += 1
            for li in p.loop_indices:
                q = world_to_camera_view(scene, c, mw @ me.vertices[me.loops[li].vertex_index].co)
                uv.data[li].uv = (q.x, q.y)
    for a in list(me.color_attributes): me.color_attributes.remove(a)
print('faces per view:', usage)

for o in OBJS: o.location = (0, 0, 0)
for o in list(scene.objects): o.select_set(o.type == 'MESH')
bpy.ops.export_scene.gltf(filepath=f'{OUT}/props.glb', export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='WEBP')
print('exported', f'{OUT}/props.glb')

# preview: the props as the boat passes them
scene.display.shading.color_type = 'TEXTURE'
scene.display.shading.background_color = (0.62, 0.83, 0.94)
for k, o in enumerate(OBJS): o.location = ((k - 1.5) * 7.0, 0, 0)
v = bpy.data.objects.new('View', bpy.data.cameras.new('View'))
scene.collection.objects.link(v)
v.data.lens = 18 / math.tan(math.radians(35))
scene.camera = v
scene.render.resolution_x, scene.render.resolution_y = 1600, 700
for name, loc in (('preview-a', (6, -22, 3)), ('preview-b', (-8, 18, 4))):
    v.location = loc
    v.rotation_mode = 'QUATERNION'
    v.rotation_quaternion = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat('-Z', 'Y')
    scene.render.filepath = f'{OUT}/{name}.png'
    bpy.ops.render.render(write_still=True)
print('previews rendered')
