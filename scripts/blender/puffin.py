# StoryRower – puffins from Tripo3D (scripts/tripo/tripo.mjs image assets/raw/puffin/ref-*.png):
# joins the generated model, turns it so the beak points forward (+Y here = −Z in three.js), scales
# it to game size and puts the origin where the game expects it, then renders previews.
#   standing: origin between the feet, height STAND_H   (the game turns the head, bobs, hops)
#   flying:   origin at the body centre, wingspan SPAN   (the game flaps the wings in the shader)
#
#   blender --background --factory-startup --python scripts/blender/puffin.py -- <in.glb> <out.glb> --pose standing|flying [--yaw deg]
import bpy, math, os, sys
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1])
POSE = ARGS[ARGS.index('--pose') + 1] if '--pose' in ARGS else 'standing'
YAW = float(ARGS[ARGS.index('--yaw') + 1]) if '--yaw' in ARGS else 0.0
# stylised: about twice a real puffin, so they read from the boat
STAND_H = 0.7
SPAN = 1.5

for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects: o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# drop the importer's parents/empties, keep the world transform
mw = obj.matrix_world.copy()
obj.parent = None
obj.matrix_world = mw
for o in list(bpy.context.scene.objects):
    if o is not obj: bpy.data.objects.remove(o, do_unlink=True)
obj.data.transform(obj.matrix_world)
obj.matrix_world = Matrix.Identity(4)
obj.data.transform(Matrix.Rotation(math.radians(YAW), 4, 'Z'))
obj.name = obj.data.name = f'Puffin_{POSE}'

vs = [v.co for v in obj.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
size = hi - lo
if POSE == 'standing':
    s = STAND_H / size.z
    origin = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
else:
    s = SPAN / size.x
    origin = (lo + hi) / 2
obj.data.transform(Matrix.Translation(-origin))
obj.data.transform(Matrix.Scale(s, 4))
print(f'{POSE}: size {tuple(round(x * s, 3) for x in size)} (x span, y length, z height)')

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=False, export_yup=True,
                          export_apply=True, export_image_format='WEBP', export_animations=False)
print('exported', DST)

# previews: front (looking along −Y at the beak), side, top
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 600, 600
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = max(size) * s * 1.3
scene.camera = cam
centre = Vector((0, 0, size.z * s / 2 if POSE == 'standing' else 0))
for name, d in (('front', Vector((0, 1, 0))), ('side', Vector((1, 0, 0))), ('top', Vector((0, 0.01, 1)))):
    cam.location = centre + d * 10
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (centre - cam.location).to_track_quat('-Z', 'Y')
    scene.render.filepath = os.path.join(os.path.dirname(DST), f'{POSE}-{name}.png')
    bpy.ops.render.render(write_still=True)
print('previews rendered')
