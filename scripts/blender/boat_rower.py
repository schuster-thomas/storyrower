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
    # …and keep the sole on the plate: without this the foot is free to spin about its own long
    # axis and turns with the shin as the knees bend. Lock the long axis (Y) and point the sole's
    # normal – the bone axis that points up in the rest pose – at a target above the plate.
    rest = (arm.matrix_world @ pb[P + prefix + 'Foot'].bone.matrix_local).to_3x3()
    up_axis = max((('TRACK_X', rest.col[0]), ('TRACK_NEGATIVE_X', -rest.col[0]),
                   ('TRACK_Z', rest.col[2]), ('TRACK_NEGATIVE_Z', -rest.col[2])),
                  key=lambda a: a[1].normalized().z)[0]
    # the plate rises from the heels towards the toes (ankle → toe); its normal points up and forward
    sole_up = empty(f'SoleUp{side}', boat, (side * 0.11, FEET_Y + 0.24 * 2.0, 0.16 + 0.3 * 2.0))
    lt = pb[P + prefix + 'Foot'].constraints.new('LOCKED_TRACK')
    lt.target = sole_up
    lt.lock_axis = 'LOCK_Y'
    lt.track_axis = up_axis

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

# The body moves the handles, as in real rowing: per frame the oar angle is solved so the grip is
# exactly ARM_EXT arm lengths in front of the shoulder – straight arms through the catch, the leg
# drive and the recovery, arms drawn in only around the finish (docs/art/stroke-side.jpg).
ARM_EXT = [(0, 1.0), (0.18, 1.0), (0.27, 0.82), (0.35, 0.52), (0.4, 0.72), (0.46, 1.0), (1.0, 1.0)]
def ext_at(ph):
    for (p0, v0), (p1, v1) in zip(ARM_EXT, ARM_EXT[1:]):
        if p0 <= ph <= p1:
            t = (ph - p0) / (p1 - p0); t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return 1.0
hold_dist = INBOARD - 0.07
def grip_at(side, sweep, pitch, z0):
    yaw = sweep if side > 0 else math.pi - sweep
    r = hold_dist
    return Vector((side * PIN_X - r * math.cos(pitch) * math.cos(yaw), PIN_Y - r * math.cos(pitch) * math.sin(yaw), z0 + r * math.sin(pitch)))
for p, (side, _, _) in hands.items():
    bones = [arm.data.bones[P + p + n] for n in ('Arm', 'ForeArm')]
    reach = sum(b.length for b in bones) * s + 0.09     # shoulder to the middle of the fist, arm straight
    pivot = oars[side][0]
    for f in range(FRAMES + 1):
        scene.frame_set(f)
        ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        sh = ev.matrix_world @ ev.pose.bones[P + p + 'Arm'].head
        want = reach * 0.98 * ext_at(f / FRAMES)
        pitch, z0 = pivot.rotation_euler[1], pivot.location.z
        d = lambda sw: (grip_at(side, sw, pitch, z0) - sh).length
        lo = min((k / 100 for k in range(-80, 111)), key=d)   # handle closest to the shoulder
        hi = 1.1
        if d(hi) < want:
            sw = hi
        elif d(lo) > want:
            sw = lo
        else:
            for _ in range(30):
                mid = (lo + hi) / 2
                if d(mid) < want: lo = mid
                else: hi = mid
            sw = (lo + hi) / 2
        pivot.rotation_euler[2] = sw if side > 0 else math.pi - sw
        pivot.keyframe_insert('rotation_euler', index=2, frame=f)
    print(f'oar {p}: sweep solved from the body (reach {reach:.2f} m)')

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
MAX_TILT = math.radians(float(os.environ.get('MAX_TILT', '10')))
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
gap = 9.0
for f in range(FRAMES + 1):
    scene.frame_set(f)
    cs = [fist_world(p)[0] for p in hands]
    gap = min(gap, (cs[0] - cs[1]).length)
elbows = []
for f in range(0, FRAMES + 1, 5):
    scene.frame_set(f)
    angs = []
    for p in hands:
        ev, up = evaluated(p + 'Arm'); _, lo = evaluated(p + 'ForeArm')
        u = (ev.matrix_world @ up.tail - ev.matrix_world @ up.head).normalized()
        l = (ev.matrix_world @ lo.tail - ev.matrix_world @ lo.head).normalized()
        angs.append(180 - math.degrees(u.angle(l)))
    elbows.append(f'{f}:{min(angs):.0f}')
print('elbow angle (180 = straight):', ' '.join(elbows))
print(f'fists: closest centres {gap * 100:.0f} cm apart (fist width {FISTS["Left"][3] * 2 * s * HAND_SCALE * 100:.0f} cm)')
for p in hands:
    print(f'grip {p}: fist width {FISTS[p][3] * 2 * s * HAND_SCALE * 100:.0f} cm, worst offset {worst[p] * 100:.1f} cm, largest wrist tilt {math.degrees(worst_tilt[p]):.0f} deg')

# Bake IK into plain keys and drop the helpers
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
# Forearm rotation (pronation) happens along the whole forearm, not in the wrist. The rig has no
# twist bone, so move TWIST_SHARE of each hand's twist into the forearm bone and take it back out of
# the hand: the hand ends up exactly where it was, but the wrist skin no longer gets pinched.
TWIST_SHARE = float(os.environ.get('TWIST_SHARE', '0.65'))
def twist_about(q, axis):
    v = Vector((q.x, q.y, q.z))
    t = Quaternion((q.w, *(axis * v.dot(axis)))).normalized()
    ang = 2 * math.atan2(Vector((t.x, t.y, t.z)).dot(axis), t.w)
    return (ang + math.pi) % (2 * math.pi) - math.pi
for p in hands:
    fore, hand = pb[P + p + 'ForeArm'], pb[P + p + 'Hand']
    rel = (fore.bone.matrix_local.inverted() @ hand.bone.matrix_local).to_3x3()
    fore_y_in_hand = (rel.inverted() @ Vector((0, 1, 0))).normalized()
    worst_wrist = 0.0
    for f in range(FRAMES + 1):
        scene.frame_set(f)
        hq = hand.rotation_quaternion.copy()
        alpha = TWIST_SHARE * twist_about(hq, Vector((0, 1, 0)))
        fore.rotation_mode = 'QUATERNION'
        fore.rotation_quaternion = fore.rotation_quaternion @ Quaternion((0, 1, 0), alpha)
        hand.rotation_quaternion = Quaternion(fore_y_in_hand, -alpha) @ hq
        fore.keyframe_insert('rotation_quaternion', frame=f)
        hand.keyframe_insert('rotation_quaternion', frame=f)
        worst_wrist = max(worst_wrist, abs(math.degrees(twist_about(hand.rotation_quaternion, Vector((0, 1, 0))))))
    print(f'twist {p}: wrist keeps at most {worst_wrist:.0f} deg')
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith(('ElbowPole', 'Ankle', 'KneePole', 'Wrist', 'Through', 'Toe', 'SoleUp')):
        bpy.data.objects.remove(o, do_unlink=True)
print('rower baked')
