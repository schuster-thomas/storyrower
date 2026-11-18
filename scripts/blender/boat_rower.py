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
    tip = empty(f'Wrist{side}')                                        # wrist position, keyed per frame
    elbow = empty(f'ElbowPole{side}', seat, (side * 1.0, 0.1, 0.45))   # out to the side: stable with straight arms
    # the IK only places the wrist; the hand hangs off the forearm (twist and tilt are keyed below)
    chains.append(('ELBOW', prefix, side, ik(P + prefix + 'ForeArm', tip, elbow)))
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

# Wrist targets, first guess: the wrist FIST hand lengths before the grip along the hand (pointing
# from the shoulder to the grip, then along the solved hand). The precise grip is set further down.
GRIP_Z = float(os.environ.get('GRIP_Z', '-0.05'))
def grip_world(side):
    return oars[side][0].matrix_world @ Vector((hold, 0, GRIP_Z))
def key_targets(direction):
    for f in range(FRAMES + 1):
        scene.frame_set(f)
        dirs = {p: direction(p) for p in hands}
        for p, (side, tip, length) in hands.items():
            tip.location = grip_world(side) - dirs[p] * FIST * length
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
def fist_local(prefix):
    """Fist shape in the hand bone's rest space: centre, palm normal, knuckle axis, half width.
    A fist is wider across the knuckles than from palm to back, so the main axis of its vertices
    across the bone is the knuckle row and the thin axis the palm normal (pointing to the side the
    curled fingers bulge to)."""
    bone = arm.data.bones[P + prefix + 'Hand']
    group = body.vertex_groups[P + prefix + 'Hand'].index
    to_bone = (arm.matrix_world @ bone.matrix_local).inverted()
    pts = [to_bone @ (body.matrix_world @ v.co) for v in body.data.vertices
           if any(g.group == group and g.weight > 0.5 for g in v.groups)]
    c = sum(pts, Vector()) / len(pts)
    cxx = sum((v.x - c.x) ** 2 for v in pts); czz = sum((v.z - c.z) ** 2 for v in pts)
    cxz = sum((v.x - c.x) * (v.z - c.z) for v in pts)
    th = 0.5 * math.atan2(2 * cxz, cxx - czz)
    knuckle = Vector((math.cos(th), 0, math.sin(th)))
    palm = Vector((0, 1, 0)).cross(knuckle).normalized()
    # the fingers curl to the palm side: more of the hand's volume lies there below the knuckles
    bulge = sum((v - c).dot(palm) ** 3 for v in pts)
    if bulge < 0: palm = -palm
    ext = [v.dot(knuckle) for v in pts]; thick = [v.dot(palm) for v in pts]
    print(f'fist {prefix}: width {(max(ext) - min(ext)) * s * HAND_SCALE * 100:.1f} cm, thickness {(max(thick) - min(thick)) * s * HAND_SCALE * 100:.1f} cm')
    return c, palm, knuckle, (max(ext) - min(ext)) / 2
FISTS = {p: fist_local(p) for p in hands}
def palm_local(prefix):
    return FISTS[prefix][1]
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

# Precise grip. The fist is measured from the mesh: its centre, its width and the knuckle axis (the
# line the handle runs along in an overhand grip). Per frame the hand may tilt sideways at the
# wrist (up to MAX_TILT, a natural range) so the handle runs across the fist, then the IK target is
# corrected until the centre of the fist sits on the handle axis, just far enough in that the end
# of the handle shows on the thumb side as in docs/art/stroke-front.jpg.
MAX_TILT = math.radians(float(os.environ.get('MAX_TILT', '20')))
GRIP_OUT = float(os.environ.get('GRIP_OUT', '0.012'))
TILT_SIGN = float(os.environ.get('TILT_SIGN', '1'))
TWIST = {p: pb[P + p + 'Hand'].rotation_quaternion.copy() for p in hands}
def fist_world(p):
    ev, b = evaluated(p + 'Hand')
    M = ev.matrix_world @ b.matrix
    c, palm, knuckle, half = FISTS[p]
    R = M.to_3x3()
    return M @ c, (R @ palm).normalized(), (R @ knuckle).normalized(), (R @ (knuckle * half)).length
def handle_axis(side):
    m = oars[side][0].matrix_world
    return m.translation, m.to_3x3().col[0].normalized()   # local +X points outboard
def wrap90(x):   # the knuckle row is an axis: k and -k are the same alignment
    return (x + math.pi / 2) % math.pi - math.pi / 2
worst = {p: 0.0 for p in hands}
twist = {p: TWIST[p].angle * (1 if TWIST[p].axis.y >= 0 else -1) for p in hands}
worst_tilt = {p: 0.0 for p in hands}
for f in range(FRAMES + 1):
    tilt = {p: 0.0 for p in hands}
    for it in range(6):
        scene.frame_set(f)
        for p, (side, tip, _) in hands.items():
            C, n, k, half = fist_world(p)
            O, a = handle_axis(side)
            hand = pb[P + p + 'Hand']
            if it < 4:
                ev, b = evaluated(p + 'Hand')
                y = (ev.matrix_world.to_3x3() @ b.matrix.to_3x3()).col[1].normalized()
                if it < 2:
                    # forearm rotation (pronation): turn the knuckle row onto the handle as seen along the hand
                    hy = (a - y * a.dot(y)).normalized()
                    twist[p] += wrap90(math.atan2(y.dot(k.cross(hy)), k.dot(hy)))
                else:
                    # small sideways wrist tilt for what is left (the handle is not square to the hand)
                    hn = (a - n * a.dot(n)).normalized()
                    tilt[p] = max(-MAX_TILT, min(MAX_TILT, tilt[p] + TILT_SIGN * wrap90(math.atan2(n.dot(k.cross(hn)), k.dot(hn)))))
                hand.rotation_quaternion = Quaternion((0, 1, 0), twist[p]) @ Quaternion(FISTS[p][1], tilt[p])
                hand.keyframe_insert('rotation_quaternion', frame=f)
            want = O + a * (-INBOARD + half + GRIP_OUT)
            tip.location = tip.location + (want - C)
            tip.keyframe_insert('location', frame=f)
        if it == 3:
            for p in hands: worst_tilt[p] = max(worst_tilt[p], abs(tilt[p]))
    scene.frame_set(f)
    for p, (side, _, _) in hands.items():
        C, n, k, _ = fist_world(p)
        O, a = handle_axis(side)
        h = (a - n * a.dot(n)).normalized()
        mis = math.degrees(math.atan2(n.dot(k.cross(h)), k.dot(h)))
        mis = (mis + 90) % 180 - 90
        off = (C - O) - a * (C - O).dot(a)          # distance of the fist centre from the handle axis
        worst[p] = max(worst[p], off.length)
        if os.environ.get('DEBUG_HANDS') and f % 6 == 0:
            print(f'GRIP f{f} {p}: fist centre {off.length * 100:.1f} cm off the handle, twist {math.degrees(twist[p]):.0f} deg, tilt {math.degrees(tilt[p]):.0f} deg, knuckles vs handle {mis:.0f} deg, palm {n.z:+.2f}')
for p in hands:
    print(f'grip {p}: fist width {FISTS[p][3] * 2 * s * HAND_SCALE * 100:.0f} cm, worst offset {worst[p] * 100:.1f} cm, largest wrist tilt {math.degrees(worst_tilt[p]):.0f} deg')

# Bake IK into plain keys and drop the helpers
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith(('ElbowPole', 'Ankle', 'KneePole', 'Wrist', 'Through', 'Toe')):
        bpy.data.objects.remove(o, do_unlink=True)
print('rower baked')
