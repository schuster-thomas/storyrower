# Executed by boat.py (shares its globals): puts the rigged rower (Tripo3D, Mixamo bone names) on
# the sliding seat, hangs hands on the oar grips and feet on the stretcher with IK, leans the body
# through the stroke and bakes everything into plain bone keys for the glTF export.
import bpy, math
from mathutils import Matrix, Quaternion, Vector

HEIGHT = 1.80
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=ROWER)
imported = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in imported if o.type == 'ARMATURE')
body = next(o for o in imported if o.type == 'MESH' and o.vertex_groups)
for o in imported:
    if o not in (arm, body) and o.parent != arm:
        bpy.data.objects.remove(o, do_unlink=True)
body.name = 'Rower'
arm.name = 'RowerRig'

# Tripo models are 1 m tall and face +X. Scale to a real person and turn to face the stern (-Y).
P = 'mixamorig:'
s = HEIGHT / max(1e-6, body.dimensions.z)
hips_z = arm.data.bones[P + 'Hips'].head_local.z * s
arm.parent = seat
arm.scale = (s, s, s)
arm.rotation_mode = 'XYZ'                      # the glTF importer leaves objects in quaternion mode
arm.rotation_euler = (0, 0, -math.pi / 2)
arm.location = (0, 0.02, 0.10 - hips_z)          # pelvis just above the seat pad

# Lighter material for the game: base colour only (the stylised look needs no normal/ORM maps)
for m in body.data.materials:
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for name in ('Normal', 'Roughness', 'Metallic'):
        for l in list(bsdf.inputs[name].links):
            nt.links.remove(l)
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.0
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and not n.outputs['Color'].links:
            nt.nodes.remove(n)
        elif n.type == 'NORMAL_MAP' or n.type == 'SEPARATE_COLOR':
            nt.nodes.remove(n)

bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones

def ik(bone, target, pole, chain=2, pole_angle=-math.pi / 2):
    c = pb[bone].constraints.new('IK')
    c.target = target
    c.pole_target = pole
    c.pole_angle = pole_angle
    c.chain_count = chain
    c.use_tail = True
    return c

# Character left side ends up at +X (after the turn), so the left hand holds the +X oar.
# The fists close around the handle: the wrist sits on the rower's side of the grip, the fist
# points through the grip and away from the body, knuckles up. In the oar's local space the rower
# is on +Y of the right oar and on -Y of the left one (its base yaw is π).
HAND_SCALE = float(os.environ.get('HAND_SCALE', '0.9'))
# The auto-rig rolls left and right bones differently, so every arm and knee gets its own IK pole
# angle, searched below (env ELBOW_LEFT, KNEE_RIGHT … override it).
chains = []   # (kind, prefix, side, constraint)
hold = -INBOARD + 0.07
# Mixamo names: Left = the character's left (+X once turned to face the stern). SWAP=1 is a debug switch.
SWAP = os.environ.get('SWAP') == '1'
for side, prefix in (((1, 'Right'), (-1, 'Left')) if SWAP else ((1, 'Left'), (-1, 'Right'))):
    pivot = oars[side][0]
    hand = pb[P + prefix + 'Hand']
    hand.scale = (HAND_SCALE,) * 3
    reach = hand.bone.length * s * HAND_SCALE * 0.55        # wrist to the middle of the fist
    wrist = empty(f'Wrist{side}', pivot, (hold, side * reach, 0.025))
    through = empty(f'Through{side}', pivot, (hold, -side * 0.12, -0.03))
    elbow = empty(f'ElbowPole{side}', seat, (side * 1.0, 0.1, 0.45))   # out to the side: stable with straight arms
    chains.append(('ELBOW', prefix, side, ik(P + prefix + 'ForeArm', wrist, elbow)))
    t = hand.constraints.new('DAMPED_TRACK')
    t.target = through
    t.track_axis = 'TRACK_Y'
    ankle = empty(f'Ankle{side}', boat, (side * 0.11, FEET_Y, 0.16))
    knee = empty(f'KneePole{side}', boat, (side * 0.16, FEET_Y + 0.1, 1.4))
    chains.append(('KNEE', prefix, side, ik(P + prefix + 'Leg', ankle, knee)))
    # feet flat on the stretcher plate: toes towards the stern and up along the plate
    toe = empty(f'Toe{side}', boat, (side * 0.12, FEET_Y - 0.3, 0.40))
    t = pb[P + prefix + 'Foot'].constraints.new('DAMPED_TRACK')
    t.target = toe
    t.track_axis = 'TRACK_Y'

# Body swing: lean from the hips (+ = towards the stern), the head stays level
axis = (arm.matrix_world.inverted().to_3x3() @ Vector((1, 0, 0))).normalized()
for phase, lean in LEAN:
    f = round(phase * FRAMES)
    scene.frame_set(f)
    for name, share in (('Hips', 0.7), ('Spine1', 0.3), ('Neck', -0.45)):
        b = pb[P + name]
        b.rotation_mode = 'QUATERNION'
        b.rotation_quaternion = Quaternion((b.bone.matrix_local.to_3x3().inverted() @ axis), lean * share)
        b.keyframe_insert('rotation_quaternion', frame=f)

# Pole angles: elbows as far out to the side as possible (and not up), knees up over the feet
SAMPLE = [0, 10, 21, 40]
def world(name):
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return ev.matrix_world @ ev.pose.bones[P + name].head
def score(kind, prefix, side):
    total = 0.0
    for f in SAMPLE:
        scene.frame_set(f)
        if kind == 'ELBOW':
            e, sh = world(prefix + 'ForeArm'), world(prefix + 'Arm')
            total += side * (e.x - sh.x) - 0.5 * max(0.0, e.z - sh.z)
        else:
            k, hip = world(prefix + 'Leg'), world(prefix + 'UpLeg')
            total += k.z - 2 * abs(k.x - hip.x)
    return total
for kind, prefix, side, c in chains:
    env = os.environ.get(f'{kind}_{prefix.upper()}')
    if env is not None:
        c.pole_angle = math.radians(float(env))
        continue
    best = None
    for deg in range(-180, 180, 15):
        c.pole_angle = math.radians(deg)
        sc = score(kind, prefix, side)
        if best is None or sc > best[0]: best = (sc, deg)
    c.pole_angle = math.radians(best[1])
    print(f'pole {kind} {prefix}: {best[1]} deg')

# Bake IK into plain keys and drop the helpers
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith(('ElbowPole', 'Ankle', 'KneePole', 'Wrist', 'Through', 'Toe')):
        bpy.data.objects.remove(o, do_unlink=True)
print('rower baked')
