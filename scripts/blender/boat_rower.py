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
# Overhand grip as in docs/art/stroke-front.jpg: the hand stays rigidly in line with the forearm
# (flat wrist), the arm IK puts the middle of the fist on the handle end (targets keyed per frame
# below), and a twist of the hand about the forearm turns the palm down.
HAND_SCALE = float(os.environ.get('HAND_SCALE', '0.8'))
FIST = float(os.environ.get('FIST', '0.5'))          # where along the hand bone the handle sits
# The auto-rig rolls left and right bones differently, so every arm and knee gets its own IK pole
# angle, searched below (env ELBOW_LEFT, KNEE_RIGHT … override it).
chains = []   # (kind, prefix, side, constraint)
hands = {}    # prefix → (side, IK target, hand length)
hold = -INBOARD + 0.07
# Mixamo names: Left = the character's left (+X once turned to face the stern). SWAP=1 is a debug switch.
SWAP = os.environ.get('SWAP') == '1'
for side, prefix in (((1, 'Right'), (-1, 'Left')) if SWAP else ((1, 'Left'), (-1, 'Right'))):
    pivot = oars[side][0]
    hand = pb[P + prefix + 'Hand']
    hand.scale = (HAND_SCALE,) * 3
    hand.rotation_mode = 'QUATERNION'
    hand_len = hand.bone.length * s * HAND_SCALE
    tip = empty(f'Wrist{side}')                                        # end of the fist, keyed per frame
    elbow = empty(f'ElbowPole{side}', seat, (side * 1.0, 0.1, 0.45))   # out to the side: stable with straight arms
    chains.append(('ELBOW', prefix, side, ik(P + prefix + 'Hand', tip, elbow, chain=3)))
    hand.lock_ik_x = hand.lock_ik_y = hand.lock_ik_z = True           # flat wrist
    hands[prefix] = (side, tip, hand_len)
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

# Fist targets: the end of the hand lies (1 - FIST) hand lengths beyond the grip along the hand,
# so the middle of the fist sits on the handle, slightly above its axis (fingers wrap over it).
# First guess: hand pointing from the shoulder to the grip; refined below with the solved hands.
GRIP_Z = float(os.environ.get('GRIP_Z', '-0.05'))   # the fist mesh sits above its bone: lower the bone so the fist wraps the handle
def grip_world(side):
    return oars[side][0].matrix_world @ Vector((hold, 0, GRIP_Z))
def key_targets(direction):
    for f in range(FRAMES + 1):
        scene.frame_set(f)
        dirs = {p: direction(p) for p in hands}
        for p, (side, tip, length) in hands.items():
            tip.location = grip_world(side) + dirs[p] * (1 - FIST) * length
            tip.keyframe_insert('location', frame=f)
def evaluated(name):
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return ev, ev.pose.bones[P + name]
def from_shoulder(p):
    ev, b = evaluated(p + 'Arm')
    return (grip_world(hands[p][0]) - ev.matrix_world @ b.head).normalized()
def along_hand(p):
    ev, b = evaluated(p + 'Hand')
    return (ev.matrix_world @ b.tail - ev.matrix_world @ b.head).normalized()
key_targets(from_shoulder)

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

for _ in range(2):
    key_targets(along_hand)

# Hand twist: the curled fingers sit on the palm side of the hand bone, so the offset of the hand's
# vertices from the bone axis tells where the palm faces. Turn each hand until the palm faces down.
def palm_local(prefix):
    bone = arm.data.bones[P + prefix + 'Hand']
    group = body.vertex_groups[P + prefix + 'Hand'].index
    to_bone = (arm.matrix_world @ bone.matrix_local).inverted()
    pts = [to_bone @ (body.matrix_world @ v.co) for v in body.data.vertices
           if any(g.group == group and g.weight > 0.5 for g in v.groups)]
    c = sum(pts, Vector()) / len(pts)
    return Vector((c.x, 0, c.z)).normalized()
for p in hands:
    palm = palm_local(p)
    hand = pb[P + p + 'Hand']
    best = None
    for deg in range(-180, 180, 15):
        hand.rotation_quaternion = Quaternion((0, 1, 0), math.radians(deg))
        sc = 0.0
        for f in SAMPLE:
            scene.frame_set(f)
            ev, b = evaluated(p + 'Hand')
            sc -= (ev.matrix_world.to_3x3() @ b.matrix.to_3x3() @ palm).normalized().z
        if best is None or sc > best[0]: best = (sc, deg)
    hand.rotation_quaternion = Quaternion((0, 1, 0), math.radians(best[1]))
    print(f'hand twist {p}: {best[1]} deg (palm down {best[0] / len(SAMPLE):.2f})')

if os.environ.get('DEBUG_HANDS'):
    dg = bpy.context.evaluated_depsgraph_get()
    for f in range(0, FRAMES + 1, 3):
        scene.frame_set(f)
        ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        for side, prefix in ((1, 'Left'), (-1, 'Right')):
            b = ev.pose.bones[P + prefix + 'Hand']
            h, t = ev.matrix_world @ b.head, ev.matrix_world @ b.tail
            tip = scene.objects[f'Wrist{side}'].matrix_world.translation
            grip = oars[side][0].matrix_world @ Vector((hold, 0, 0))
            fmt = lambda v: '(' + ', '.join(f'{x:+.2f}' for x in v) + ')'
            print(f'HANDS f{f} {prefix}: miss {(t - tip).length * 100:.0f} cm wrist {fmt(h)} tail {fmt(t)} target {fmt(tip)} grip {fmt(grip)} len {(t-h).length:.2f}')

# Bake IK into plain keys and drop the helpers
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith(('ElbowPole', 'Ankle', 'KneePole', 'Wrist', 'Through', 'Toe')):
        bpy.data.objects.remove(o, do_unlink=True)
print('rower baked')
