# Blender smoke test: GPU check, a tiny scene, a Cycles render and a glTF export.
#   blender --background --factory-startup --python scripts/blender/smoke_test.py -- <outdir>
import sys, os, bpy

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/raw/blender'
os.makedirs(out, exist_ok=True)

# GPU for Cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = backend
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == backend]
        if devs:
            for d in prefs.devices: d.use = d.type == backend
            print('GPU backend', backend, [d.name for d in devs])
            break
    except Exception as e:
        print('backend', backend, 'failed', e)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = 32
sc.render.resolution_x, sc.render.resolution_y = 480, 270
bpy.ops.mesh.primitive_plane_add(size=10)
bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 1))
bpy.ops.object.light_add(type='SUN', rotation=(0.8, 0.2, 0.5))
bpy.ops.object.camera_add(location=(6, -6, 4), rotation=(1.1, 0, 0.78))
sc.camera = bpy.context.object
sc.render.filepath = os.path.join(out, 'smoke.png')
bpy.ops.render.render(write_still=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'smoke.glb'), export_format='GLB')
print('OK', os.listdir(out))
