# A stand-up paddler for "Mauritius Shark Madness": a Tripo3D figure on its board, rigged by Tripo
# (Mixamo bones, scripts/tripo/rig.mjs), made into one looping paddle stroke with both hands on the
# paddle all the time.
#   blender --background --factory-startup --python scripts/blender/paddler.py -- <rigged.glb> <out.glb> <right|left>
# (scripts/mauritius/paddlers.mjs runs this for both paddlers and compresses the result.)
#
# - Tripo tilts and bends the board: a curve z = a + b·s + c·s² + d·t is fitted to its underside
#   (s along the board, t across) and every vertex and bone is shifted down by it – the board lies
#   flat, the person stays upright (a purely vertical shear, normals turned with it).
# - The board belongs to the Root bone (Tripo weights it to the toes, sometimes to a hand).
# - Turned to face -Y (= +Z in glTF), the hips over the origin, the board's underside at z = 0, and
#   scaled to HEIGHT.
# - The paddle is skinned to its own bone. Per frame the blade's centre follows the basic forward
#   stroke (in far ahead, pulled straight back along the board to the feet, out, forward above the
#   water); the T-grip is placed within reach of the top hand's shoulder, the lower hand on the
#   shaft within reach of its shoulder, and both arms reach them with IK. The upper body bends
#   forward and turns the paddle side's shoulder forward for the catch and straightens up in the pull.
# - Everything is baked into plain bone keys; an empty "Blade" on the paddle bone marks the blade's
#   centre for the game's splashes.
import bpy, math, os, sys
import numpy as np
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, SIDE = os.path.abspath(args[0]), os.path.abspath(args[1]), args[2]
HEIGHT = float(os.environ.get('HEIGHT', '1.8'))   # head top above the board's underside (m)
# how far the lower arm reaches out (share of shoulder to wrist): a clearly bent elbow – near a
# straight arm the IK flips the elbow from frame to frame
LOW_REACH = float(os.environ.get('LOW_REACH', '0.7'))
FPS = 30
STROKE = 2.2                                      # seconds per stroke
FRAMES = round(FPS * STROKE)
GRIP_TO_BLADE = 1.75                              # T-grip to the blade's centre (m)
BLADE = (0.2, 0.44, 0.022)                        # width, length, thickness (m)
P = 'mixamorig:'

# Where the blade's centre goes (as in src/game/scene/mauritius/Visitors.ts before): phase 0–1, out
# from the board's edge, height above the board's underside (the water is at about 0.06), ahead of
# the hips – metres. Catmull–Rom through these, round the loop.
BLADE_PATH = [
    (0.0, 0.10, 0.12, 0.95),     # dipping in, far ahead
    (0.1, 0.08, -0.24, 0.85),    # the catch: buried ahead of the feet
    (0.55, 0.10, -0.24, -0.10),  # pulled straight back to the feet
    (0.65, 0.32, 0.16, -0.28),   # out of the water just behind them
    (0.83, 0.70, 0.22, 0.40),    # recovery: forward low over the water, swung wide out to the side
]

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

def blade_path(k):
    n = len(BLADE_PATH)
    i = n - 1
    while i > 0 and BLADE_PATH[i][0] > k: i -= 1
    k0 = BLADE_PATH[i][0]; k1 = BLADE_PATH[i + 1][0] if i + 1 < n else 1.0
    u = (k - k0) / (k1 - k0)
    key = lambda j, m: BLADE_PATH[(j + n) % n][m]
    def cr(m):
        a, b, c, d = key(i - 1, m), key(i, m), key(i + 1, m), key(i + 2, m)
        return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u)
    return cr(1), cr(2), cr(3)

def body_motion(k):
    """(forward bend, shoulder turn) in radians: reach at the catch, upright through the pull."""
    if k < 0.1: return 0.42, 0.3
    if k < 0.55:
        t = smooth((k - 0.1) / 0.45); return 0.42 + (0.05 - 0.42) * t, 0.3 * (1 - t)
    if k < 0.65: return 0.05, 0.0
    t = smooth((k - 0.65) / 0.35); return 0.05 + (0.42 - 0.05) * t, 0.3 * t

# ---------- import ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, FRAMES
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
for o in list(scene.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
# Tripo leaves a few microns of offset on the armature (the mesh is its child): drop it
assert (arm.matrix_world.translation.length < 1e-3 and arm.matrix_world.to_3x3().is_identity
        and (arm.matrix_world.inverted() @ body.matrix_world).is_identity), 'expected identity transforms'
arm.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()
body.name, arm.name = 'Paddler', 'PaddlerRig'
me = body.data

# lighter material for the game: base colour only (as the rower)
for m in me.materials:
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for name in ('Normal', 'Roughness', 'Metallic'):
        for l in list(bsdf.inputs[name].links): nt.links.remove(l)
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.0
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and not n.outputs['Color'].links: nt.nodes.remove(n)
        elif n.type in ('NORMAL_MAP', 'SEPARATE_COLOR'): nt.nodes.remove(n)

# ---------- level the board ----------
pts = np.array([v.co[:] for v in me.vertices])
z0 = pts[:, 2].min(); H0 = pts[:, 2].max() - z0
CELL = 0.03 * H0
cells = {}
for p in pts:
    key = (math.floor(p[0] / CELL), math.floor(p[1] / CELL))
    if key not in cells or p[2] < cells[key][2]: cells[key] = p
under = np.array([p for p in cells.values() if p[2] - z0 < 0.5 * H0])
def long_axis(q):
    q = q[:, :2] - q[:, :2].mean(0)
    w, v = np.linalg.eigh(q.T @ q)
    return v[:, 1]
ux, uy = long_axis(under)
def st(q): return q[:, 0] * ux + q[:, 1] * uy, -q[:, 0] * uy + q[:, 1] * ux
fit = np.zeros(4)
def curve(q, k=None):
    k = fit if k is None else k
    s, t = st(q); return k[0] + k[1] * s + k[2] * s * s + k[3] * t
for tol in (np.inf, 0.12 * H0, 0.06 * H0, 0.03 * H0):
    under = under[np.abs(under[:, 2] - curve(under)) < tol]
    s, t = st(under)
    fit = np.linalg.lstsq(np.stack([np.ones_like(s), s, s * s, t], 1), under[:, 2], rcond=None)[0]
gap = np.abs(under[:, 2] - curve(under)).max()
print(f'LEVEL underside cells {len(under)}, slope {fit[1]:.3f}, bend {fit[2]:.3f}, roll {fit[3]:.3f}, largest gap {gap / H0:.3f} H')
def f_grad(x, y):
    s = x * ux + y * uy
    ds = fit[1] + 2 * fit[2] * s
    return ds * ux - fit[3] * uy, ds * uy + fit[3] * ux
lev = pts.copy()
lev[:, 2] -= curve(pts)

# facing: the hands are in front of the hips
bones = arm.data.bones
hips = bones[P + 'Hips'].head_local
hand_y = (bones[P + 'LeftHand'].head_local.y + bones[P + 'RightHand'].head_local.y) / 2
turn = math.pi if hand_y > hips.y else 0.0       # face -Y
R = Matrix.Rotation(turn, 4, 'Z')
person = lev[:, 2]
scale = HEIGHT / person.max()
centre = Vector((hips.x, hips.y, 0.0))
M = Matrix.Scale(scale, 4) @ R @ Matrix.Translation(-centre)
R3 = R.to_3x3()

# vertices and their custom normals (shear: normals by the inverse transpose, then the turn)
corner_normals = [Vector(cn.vector) for cn in me.corner_normals]
for v, p in zip(me.vertices, lev):
    v.co = M @ Vector(p)
new_normals = []
for loop, n in zip(me.loops, corner_normals):
    x, y, _ = pts[loop.vertex_index]
    gx, gy = f_grad(x, y)
    new_normals.append((R3 @ Vector((n.x + gx * n.z, n.y + gy * n.z, n.z))).normalized())
me.normals_split_custom_set(new_normals)
me.update()

# bones: the same shift and turn (the roll follows the bone's turned z axis)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in arm.data.edit_bones:
    z_axis = R3 @ eb.z_axis
    h, t = eb.head.copy(), eb.tail.copy()
    def lv(p):
        q = np.array([[p.x, p.y, p.z]]); return M @ Vector((p.x, p.y, p.z - curve(q)[0]))
    eb.head, eb.tail = lv(h), lv(t)
    eb.align_roll(z_axis)
# the paddle's bone: grip at the head, the shaft down along the bone, blade face towards -Y
GRIP0 = Vector((0, 0, 1.4))
pbone = arm.data.edit_bones.new('Paddle')
pbone.head, pbone.tail = GRIP0, GRIP0 + Vector((0, 0, -0.3))
pbone.align_roll(Vector((0, -1, 0)))
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- the board belongs to the Root bone ----------
root_g = body.vertex_groups.get('Root') or body.vertex_groups.new(name='Root')
groups = {g.index: g.name for g in body.vertex_groups}
board_n = 0
beam = 0.0
for v in me.vertices:
    zl = v.co.z
    names = [groups[g.group] for g in v.groups if g.weight > 0.01]
    upper = any(n.endswith(('Hand', 'Arm', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Shoulder')) for n in names)
    if zl < 0.06 * HEIGHT or (upper and zl < 0.12 * HEIGHT):
        for g in list(v.groups): body.vertex_groups[g.group].remove([v.index])
        root_g.add([v.index], 1.0, 'REPLACE')
        board_n += 1
        if zl < 0.05 * HEIGHT and abs(v.co.y) < 0.3: beam = max(beam, abs(v.co.x))
print(f'BOARD {board_n} vertices on the Root bone, half width at the feet {beam:.2f} m')

# ---------- the paddle (skinned to its bone) ----------
def material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m
import bmesh
bm = bmesh.new()
shaft_len = GRIP_TO_BLADE - BLADE[1] / 2
r = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.016, radius2=0.016, depth=shaft_len)
bmesh.ops.translate(bm, verts=r['verts'], vec=GRIP0 + Vector((0, 0, -shaft_len / 2)))
for f in bm.faces: f.material_index = 0
grip = bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, verts=grip['verts'], vec=(0.12, 0.03, 0.03))
bmesh.ops.translate(bm, verts=grip['verts'], vec=GRIP0 + Vector((0, 0, 0.01)))
blade = bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, verts=blade['verts'], vec=(BLADE[0], BLADE[2], BLADE[1]))
bmesh.ops.translate(bm, verts=blade['verts'], vec=GRIP0 + Vector((0, 0, -GRIP_TO_BLADE)))
blade_faces = {f for f in bm.faces if all(v in set(blade['verts']) for v in f.verts)}
for f in bm.faces: f.material_index = 1 if f in blade_faces else 0
pm = bpy.data.meshes.new('Paddle')
bm.to_mesh(pm); bm.free()
pm.materials.append(material('PaddleShaft', (0.017, 0.019, 0.027), 0.45))
pm.materials.append(material('PaddleBlade', (0.012, 0.115, 0.67), 0.4))
paddle = bpy.data.objects.new('Paddle', pm)
scene.collection.objects.link(paddle)
paddle.vertex_groups.new(name='Paddle').add(list(range(len(pm.vertices))), 1.0, 'REPLACE')
body.vertex_groups.new(name='Paddle')
bpy.ops.object.select_all(action='DESELECT')
paddle.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()

# blade marker for the game's splashes
marker = bpy.data.objects.new('Blade', None)
scene.collection.objects.link(marker)
marker.parent = arm
marker.parent_type = 'BONE'
marker.parent_bone = 'Paddle'
bpy.context.view_layer.update()
marker.matrix_world = Matrix.Translation(GRIP0 + Vector((0, 0, -GRIP_TO_BLADE)))

# ---------- the stroke ----------
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
paddle_side = -1 if SIDE == 'right' else 1        # facing -Y the person's right is -X
LAT = Vector((paddle_side, 0, 0))
FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
low_p, top_p = ('Right', 'Left') if SIDE == 'right' else ('Left', 'Right')
def fist_local(p):
    """The fist's centre in the hand bone's rest space: the middle of the vertices that follow the
    hand (Tripo's hand bones run far past the fingers, so a point along the bone would miss)."""
    bone = arm.data.bones[P + p + 'Hand']
    gi = body.vertex_groups[P + p + 'Hand'].index
    to_bone = bone.matrix_local.inverted()
    # (Tripo weights some fists mostly to the forearm – the hand is never turned against it here, so
    # every vertex the hand bone pulls on at all counts, by its weight)
    pts = [(to_bone @ v.co, g.weight) for v in me.vertices for g in v.groups if g.group == gi and g.weight > 0.15]
    print(f'FIST {p}: {len(pts)} vertices')
    return sum((c * w for c, w in pts), Vector()) / sum(w for _, w in pts)
me = body.data
FISTS = {p: fist_local(p) for p in (low_p, top_p)}
reach = {}
for p in (low_p, top_p):
    b = [arm.data.bones[P + p + n] for n in ('Arm', 'ForeArm')]
    reach[p] = (b[0].length + b[1].length, FISTS[p].length)
print(f'ARMS {low_p} (lower) {reach[low_p][0]:.2f} m + fist {reach[low_p][1]:.2f}, {top_p} (top) {reach[top_p][0]:.2f} m + fist {reach[top_p][1]:.2f}')

def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e

chains = {}
for p in (low_p, top_p):
    side = -1 if p == 'Right' else 1
    tip = empty(f'Wrist{p}')
    sh = arm.data.bones[P + p + 'Arm'].head_local
    pole = empty(f'Pole{p}', sh + Vector((side * 0.45, 0.35, -0.5)))
    c = pb[P + p + 'ForeArm'].constraints.new('IK')
    c.target, c.pole_target, c.chain_count, c.use_tail = tip, pole, 2, True
    chains[p] = (tip, c, side)

def world_head(name):
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return ev.matrix_world @ ev.pose.bones[name].head
def world_tail(name):
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return ev.matrix_world @ ev.pose.bones[name].tail

def rot(bone, axis, angle):
    return Quaternion((arm.data.bones[bone].matrix_local.to_3x3().inverted() @ axis).normalized(), angle)

targets = {}     # frame → (grip, lower hand point, paddle direction)
low_at = {}      # frame → the lower hand's distance down the shaft from the grip
for f in range(FRAMES + 1):
    k = (f / FRAMES) % 1.0
    scene.frame_set(f)
    bend, turn_ = body_motion(k)
    for name, share in (('Spine', 0.4), ('Spine1', 0.3), ('Spine2', 0.3)):
        b = pb[P + name]
        b.rotation_quaternion = rot(P + name, Vector((1, 0, 0)), bend * share) @ rot(P + name, UP, -paddle_side * turn_ * share)
        b.keyframe_insert('rotation_quaternion', frame=f)
    nk = pb[P + 'Neck']
    nk.rotation_quaternion = rot(P + 'Neck', Vector((1, 0, 0)), -0.6 * bend)
    nk.keyframe_insert('rotation_quaternion', frame=f)
    bpy.context.view_layer.update()
    s_top, s_low = world_head(P + top_p + 'Arm'), world_head(P + low_p + 'Arm')
    out, bz, ahead = blade_path(k)
    B = LAT * (beam + out) + Vector((0, 0, bz)) + FWD * ahead
    # the T-grip: in front of the top shoulder, within its reach, GRIP_TO_BLADE from the blade
    r_top = reach[top_p][0] * 0.95 + reach[top_p][1]
    want = s_top + FWD * 0.3 + LAT * 0.12 - UP * 0.1
    G = B + (want - B).normalized() * GRIP_TO_BLADE
    for _ in range(20):
        d = (G - s_top).length
        if d <= r_top: break
        G = B + ((s_top + (G - s_top) * (r_top / d)) - B).normalized() * GRIP_TO_BLADE
    D = (B - G).normalized()
    # the lower hand: on the shaft, a comfortably bent arm's length from its shoulder – the first
    # place going down the shaft from the grip (at least 30 cm below it) where that sphere is crossed,
    # or the closest approach when it doesn't reach. One consistent choice: anything else flips
    # between frames and the arm shakes.
    r_low = reach[low_p][0] * LOW_REACH + reach[low_p][1]
    b = D.dot(G - s_low)
    disc = b * b - ((G - s_low).length_squared - r_low * r_low)
    if disc > 0:
        roots = [d for d in (-b - math.sqrt(disc), -b + math.sqrt(disc)) if d >= 0.3]
        d = roots[0] if roots else 0.3
    else:
        d = -b
    low_at[f] = max(0.3, min(1.0, d))
    targets[f] = (G, None, D)
    # the paddle bone: y along the shaft, z (the blade's face) towards the stroke
    z = (FWD - D * FWD.dot(D)).normalized()
    x = D.cross(z)
    m = Matrix((x, D, z)).transposed().to_4x4()
    m.translation = G
    pp = pb['Paddle']
    pp.matrix = arm.matrix_world.inverted() @ m
    bpy.context.view_layer.update()
    pp.keyframe_insert('location', frame=f)
    pp.keyframe_insert('rotation_quaternion', frame=f)
# the lower hand slides smoothly along the shaft (a running mean round the loop)
smoothed = [sum(low_at[(f + j) % FRAMES] for j in range(-4, 5)) / 9 for f in range(FRAMES)]
for f in range(FRAMES + 1):
    G, _, D = targets[f]
    targets[f] = (G, G + D * smoothed[f % FRAMES], D)

def fist_world(p):
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return ev.matrix_world @ ev.pose.bones[P + p + 'Hand'].matrix @ FISTS[p]
def key_wrists():
    """Wrist targets: first a guess (the fist's distance before the grip, from the shoulder), then
    moved per frame by what the fist's centre still misses, until it sits on its point."""
    for f in range(FRAMES + 1):
        scene.frame_set(f)
        G, H, D = targets[f]
        for p, fist in ((top_p, G), (low_p, H)):
            tip = chains[p][0]
            tip.location = fist - (fist - world_head(P + p + 'Arm')).normalized() * reach[p][1]
            tip.keyframe_insert('location', frame=f)
def settle_wrists(rounds=6):
    for f in range(FRAMES + 1):
        G, H, D = targets[f]
        for _ in range(rounds):
            scene.frame_set(f)
            for p, fist in ((top_p, G), (low_p, H)):
                tip = chains[p][0]
                tip.location = tip.location + (fist - fist_world(p))
                tip.keyframe_insert('location', frame=f)
key_wrists()

# pole angles: elbows down and a little out to the side (searched, the rig's rolls differ)
SAMPLE = [0, FRAMES // 4, FRAMES // 2, 3 * FRAMES // 4]
for p, (tip, c, side) in chains.items():
    best = None
    for deg in range(-180, 180, 15):
        c.pole_angle = math.radians(deg)
        sc = 0.0
        for f in SAMPLE:
            scene.frame_set(f)
            e, sh = world_head(P + p + 'ForeArm'), world_head(P + p + 'Arm')
            sc += -(e.z - sh.z) + 0.4 * side * (e.x - sh.x)
        if best is None or sc > best[0]: best = (sc, deg)
    c.pole_angle = math.radians(best[1])
    print(f'POLE {p}: {best[1]} deg')
settle_wrists()

# how well the hands hold the paddle: the fist's centre from its point (top: the T-grip, lower: the shaft)
# …and whether an arm shakes: the largest step of each elbow from one frame to the next
worst = {p: 0.0 for p in chains}
step = {p: 0.0 for p in chains}
last = {}
for f in range(FRAMES + 1):
    scene.frame_set(f)
    G, H, D = targets[f]
    for p, fist in ((top_p, G), (low_p, H)):
        worst[p] = max(worst[p], (fist_world(p) - fist).length)
        e = world_head(P + p + 'ForeArm')
        if p in last: step[p] = max(step[p], (e - last[p]).length)
        if os.environ.get('DEBUG_ARMS') and p in last:
            sh = world_head(P + p + 'Arm')
            print(f'ARM f{f} {p}: elbow step {(e - last[p]).length * 100:.1f} cm, shoulder→fist {(fist - sh).length:.2f} m of {sum(reach[p]):.2f}, fist off {(fist_world(p) - fist).length * 100:.1f} cm')
        last[p] = e
for p in chains: print(f'HOLD {p}: fist centre at most {worst[p] * 100:.1f} cm off its place on the paddle, elbow moves at most {step[p] * 100:.1f} cm per frame')

# bake IK into plain keys, drop the helpers
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith(('Wrist', 'Pole')): bpy.data.objects.remove(o, do_unlink=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_animations=True, export_animation_mode='SCENE',
    export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=False,
    export_apply=False, export_yup=True, export_skins=True, export_def_bones=False)
if os.environ.get('PREVIEW'):
    bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'))
print(f'PADDLER baked {FRAMES} frames → {OUT}')
