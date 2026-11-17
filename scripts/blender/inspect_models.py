# Renders a quick thumbnail of each Poly Haven model and prints its size and orientation.
#   blender --background --factory-startup --python scripts/blender/inspect_models.py -- <outdir> id1 id2 ...
import bpy, os, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out, ids = os.path.abspath(args[0]), args[1:]
os.makedirs(out, exist_ok=True)

for mid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == 'OPTIX'
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'GPU'; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 480, 320
    path = os.path.abspath(f'assets/raw/polyhaven/models/{mid}/{mid}.gltf')
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in sc.objects if o.type == 'MESH']
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    tris = 0
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    size = hi - lo
    print(f'MODEL {mid}: meshes={len(objs)} tris={tris} size=({size.x:.1f}, {size.y:.1f}, {size.z:.1f}) min=({lo.x:.1f},{lo.y:.1f},{lo.z:.1f})')
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.75, 0.9, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3
    sun.rotation_euler = (0.7, 0.3, 0.8); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    ctr = (lo + hi) / 2; r = max(size) * 1.1
    cam.location = ctr + Vector((r * 0.9, -r * 1.2, r * 0.5))
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out, f'{mid}.png')
    bpy.ops.render.render(write_still=True)
