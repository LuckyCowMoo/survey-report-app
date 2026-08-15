"""
Bake an eye-level walk clip along WalkNode1..WalkNode6 in the .blend.

Preview (default, 144p, laptop folder):
  blender --background --python scripts/blender/render_walk_from_blend.py -- --preview

Full phone clip:
  blender --background --python scripts/blender/render_walk_from_blend.py -- --final
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys

import bpy
import mathutils

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import tutorial_style as style

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLEND = os.path.join(ROOT, "public", "tutorial", "bayard_tutorial.blend")
OUT = os.path.join(ROOT, "public", "tutorial")
PREVIEW_DIR = os.path.join(OUT, "walk_preview")
NODE_COUNT = 6
WALK_SECONDS = 7.5
# Viewfinder EquirectViewfinder uFov is vertical, ~1.15 rad.
VIEW_VFOV = 1.15
# Square walk is cover-cropped on the phone; extra FOV is overscan.
WALK_FOV = 1.20


def log(msg: str) -> None:
    print(msg, flush=True)


def is_preview() -> bool:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    return "--final" not in argv


def catmull(p0, p1, p2, p3, t: float) -> mathutils.Vector:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def sample_path(pts: list[mathutils.Vector], u: float) -> mathutils.Vector:
    nseg = len(pts) - 1
    u = max(0.0, min(0.9999, u))
    f = u * nseg
    i = int(f)
    t = f - i
    p0 = pts[i - 1] if i > 0 else pts[i]
    p1 = pts[i]
    p2 = pts[i + 1]
    p3 = pts[i + 2] if i + 2 < len(pts) else pts[i + 1]
    return catmull(p0, p1, p2, p3, t)


def hold_ease(u: float, hold: float = 0.06) -> float:
    if u <= hold:
        return 0.0
    if u >= 1.0 - hold:
        return 1.0
    v = (u - hold) / (1.0 - 2.0 * hold)
    return v * v * (3.0 - 2.0 * v)


def slerp_eul(a: mathutils.Euler, b: mathutils.Euler, t: float) -> mathutils.Euler:
    qa = a.to_quaternion()
    qb = b.to_quaternion()
    if qa.dot(qb) < 0:
        qb = -qb
    return qa.slerp(qb, max(0.0, min(1.0, t))).to_euler(a.order)


def look_basis(fwd: mathutils.Vector, up_hint: mathutils.Vector) -> mathutils.Euler:
    fwd = fwd.normalized()
    up_hint = up_hint.normalized()
    right = up_hint.cross(fwd)
    if right.length < 0.05:
        right = mathutils.Vector((1.0, 0.0, 0.0)).cross(fwd)
    right.normalize()
    up = fwd.cross(right)
    up.normalize()
    m = mathutils.Matrix.Identity(4)
    m.col[0][0:3] = right
    m.col[1][0:3] = up
    m.col[2][0:3] = -fwd
    return m.to_euler("XYZ")


def node_name(i: int) -> str:
    return f"WalkNode{i}"


def ensure_walk_nodes(spawn, gutter) -> list[mathutils.Vector]:
    coll = bpy.data.collections.get("WalkPath")
    if coll is None:
        coll = bpy.data.collections.new("WalkPath")
        bpy.context.scene.collection.children.link(coll)

    created = False
    nodes = []
    sp = spawn.location
    gt = gutter.location
    for i in range(1, NODE_COUNT + 1):
        name = node_name(i)
        obj = bpy.data.objects.get(name)
        if obj is None:
            created = True
            obj = bpy.data.objects.new(name, None)
            obj.empty_display_type = "PLAIN_AXES"
            obj.empty_display_size = 2.8
            obj.show_name = True
            t = (i - 1) / (NODE_COUNT - 1)
            obj.location = sp.lerp(gt, t)
            coll.objects.link(obj)
        nodes.append(obj)

    pts = [o.location.copy() for o in nodes]
    if created:
        log("Created WalkNode1..WalkNode6 (straight spawn→gutter). Move them, save, re-preview.")
    else:
        log("Using existing WalkNode1..WalkNode6")
    log("Nodes: " + ", ".join(f"{node_name(i+1)}=({p.x:.1f},{p.y:.1f},{p.z:.1f})" for i, p in enumerate(pts)))
    return pts


def find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    local = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe")
    if os.path.isfile(local):
        return local
    pkg = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
    if os.path.isdir(pkg):
        for root, _dirs, files in os.walk(pkg):
            if "ffmpeg.exe" in files:
                return os.path.join(root, "ffmpeg.exe")
    return None


def encode_ffmpeg(frames_dir: str, walk_mp4: str, fps: int) -> bool:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        log("ffmpeg not on PATH; leaving PNG frames")
        return False
    pattern = os.path.join(frames_dir, "walk_%04d.png")
    r = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-framerate",
            str(fps),
            "-i",
            pattern,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            walk_mp4,
        ],
        check=False,
    )
    return r.returncode == 0 and os.path.isfile(walk_mp4)


def disable_mist() -> None:
    scene = bpy.context.scene
    world = scene.world
    if world is not None:
        mist = getattr(world, "mist_settings", None)
        if mist is not None:
            mist.use_mist = False
        if world.use_nodes and world.node_tree:
            for node in world.node_tree.nodes:
                if node.type == "BACKGROUND":
                    node.inputs["Strength"].default_value = 0.85
                    node.inputs["Color"].default_value = (0.62, 0.74, 0.90, 1.0)
    for cam in bpy.data.cameras:
        if hasattr(cam, "show_mist"):
            cam.show_mist = False
    eevee = getattr(scene, "eevee", None)
    if eevee is not None and hasattr(eevee, "use_volumetric"):
        eevee.use_volumetric = False
    log("Mist off")


def setup_eevee_walk(cam_obj, width: int, height: int, fps: int, frame_count: int, frames_dir: str) -> None:
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    log(f"Walk engine: {scene.render.engine} {width}x{height} {frame_count}f @{fps}fps")
    data = cam_obj.data
    data.type = "PERSP"
    data.sensor_fit = "HORIZONTAL"
    data.angle = WALK_FOV
    data.clip_start = 0.2
    data.clip_end = 2000.0
    scene.camera = cam_obj
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    style.set_kuwahara_size(0.0 if min(width, height) < 900 else max(1.4, 4.0 * (min(width, height) / 1080.0)))
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frame_count
    scene.render.image_settings.file_format = "PNG"
    os.makedirs(frames_dir, exist_ok=True)
    for name in os.listdir(frames_dir):
        if name.startswith("walk_") and name.endswith(".png"):
            os.remove(os.path.join(frames_dir, name))
    scene.render.filepath = os.path.join(frames_dir, "walk_")
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass


def render_watercolor_still(spawn) -> None:
    scene = bpy.context.scene
    name = "CameraStyleTest"
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.cameras.new(name)
    data.type = "PERSP"
    data.lens = 28
    data.clip_start = 0.2
    data.clip_end = 250.0
    cam = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(cam)
    cam.location = spawn.location.copy()
    cam.rotation_euler = spawn.rotation_euler.copy()
    saved = scene.camera
    scene.camera = cam
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    path = os.path.join(PREVIEW_DIR, "watercolor_front.jpg")
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene.render.filepath = path
    log(f"Watercolor still -> {path}")
    bpy.ops.render.render(write_still=True)
    scene.camera = saved


def main() -> None:
    preview = is_preview()
    if not os.path.isfile(BLEND):
        raise SystemExit(f"Missing {BLEND}")
    bpy.ops.wm.open_mainfile(filepath=BLEND)

    spawn = bpy.data.objects["CameraSpawn"]
    gutter = bpy.data.objects["CameraGutter"]
    walk = bpy.data.objects["CameraWalk"]
    pts = ensure_walk_nodes(spawn, gutter)
    style.apply_style_to_scene(spawn)
    mat_restore = style.albedo_as_emission()
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            bpy.context.scene.render.engine = engine
            break
        except Exception:
            continue
    render_watercolor_still(spawn)

    world_up = mathutils.Vector((0.0, 0.0, 1.0))

    def forward_at(s: float) -> mathutils.Vector:
        loc = sample_path(pts, s)
        loc_next = sample_path(pts, min(0.9999, s + 0.04))
        tangent = loc_next - loc
        tangent.z = 0.0
        if tangent.length < 0.05:
            tangent = pts[-1] - pts[-2]
            tangent.z = 0.0
        if tangent.length < 0.05:
            return mathutils.Vector((0.0, -1.0, 0.0))
        return tangent.normalized()

    if walk.animation_data:
        walk.animation_data_clear()

    pitch_down = mathutils.Quaternion((1.0, 0.0, 0.0), math.radians(-9.0))
    spawn_q = spawn.matrix_world.to_quaternion() @ pitch_down
    gutter_q = gutter.matrix_world.to_quaternion() @ pitch_down
    walk.rotation_mode = "QUATERNION"
    fps = 12 if preview else 24
    frame_count = int(round(WALK_SECONDS * fps))
    for i in range(frame_count):
        u = i / max(1, frame_count - 1)
        s = hold_ease(u)
        loc = sample_path(pts, s)
        path_q = look_basis(forward_at(s), world_up).to_quaternion()
        if spawn_q.dot(path_q) < 0:
            path_q = -path_q
        if u < 0.22:
            t = u / 0.22
            t = t * t * (3.0 - 2.0 * t)
            q = spawn_q.slerp(path_q, t)
        elif u > 0.82:
            t = (u - 0.82) / 0.18
            t = t * t * (3.0 - 2.0 * t)
            gq = gutter_q
            if path_q.dot(gq) < 0:
                gq = -gq
            q = path_q.slerp(gq, t)
        else:
            q = path_q
        frame = i + 1
        walk.location = loc
        walk.rotation_quaternion = q
        walk.keyframe_insert("location", frame=frame)
        walk.keyframe_insert("rotation_quaternion", frame=frame)

    bpy.context.scene.frame_set(1)
    zneg = mathutils.Vector((0.0, 0.0, -1.0))
    fwd1 = walk.matrix_world.to_3x3() @ zneg
    spn = spawn.matrix_world.to_3x3() @ zneg
    log(f"frame1 fwd {tuple(round(c, 3) for c in fwd1)} spawn fwd {tuple(round(c, 3) for c in spn)}")

    if preview:
        width, height = 512, 512
        frames_dir = os.path.join(PREVIEW_DIR, "frames")
        mp4 = os.path.join(PREVIEW_DIR, "walk.mp4")
    else:
        width, height = 1080, 1080
        frames_dir = os.path.join(OUT, "_walk_frames")
        mp4 = os.path.join(OUT, "walk.mp4")

    setup_eevee_walk(walk, width, height, fps, frame_count, frames_dir)
    log(f"Rendering {frame_count} walk frames")
    bpy.ops.render.render(animation=True)
    style.restore_materials(mat_restore)
    encoded = encode_ffmpeg(frames_dir, mp4, fps)
    log("Wrote " + (mp4 if encoded else frames_dir))
    log("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
