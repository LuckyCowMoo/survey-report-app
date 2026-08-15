"""
High-quality watercolor + thin depth edges for panos, walk, and extra stills.

  blender --background --python scripts/blender/render_hq_style.py
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

ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
BLEND = os.path.join(ROOT, "public", "tutorial", "bayard_tutorial.blend")
OUT = os.path.join(ROOT, "public", "tutorial")
PREVIEW = os.path.join(OUT, "walk_preview")
NODE_COUNT = 6
WALK_SECONDS = 7.5
VIEW_VFOV = 1.15
WALK_FOV = 1.55


def log(msg: str) -> None:
    print(msg, flush=True)


def catmull(p0, p1, p2, p3, t: float) -> mathutils.Vector:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def sample_path(pts, u: float) -> mathutils.Vector:
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


def walk_pts():
    spawn = bpy.data.objects["CameraSpawn"]
    gutter = bpy.data.objects["CameraGutter"]
    pts = []
    for i in range(1, NODE_COUNT + 1):
        obj = bpy.data.objects.get(f"WalkNode{i}")
        if obj is None:
            raise SystemExit(f"Missing WalkNode{i}")
        pts.append(obj.location.copy())
    log("Nodes: " + ", ".join(f"N{i+1}=({p.x:.1f},{p.y:.1f},{p.z:.1f})" for i, p in enumerate(pts)))
    _ = spawn, gutter
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
        log("ffmpeg not found; leaving PNG frames")
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
            "-crf",
            "18",
            walk_mp4,
        ],
        check=False,
    )
    return r.returncode == 0 and os.path.isfile(walk_mp4)


def enable_gpu() -> str:
    scene = bpy.context.scene
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except (KeyError, AttributeError):
        scene.cycles.device = "CPU"
        return "CPU"
    for dtype in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = dtype
            prefs.get_devices()
            used = False
            for d in prefs.devices:
                gpu = getattr(d, "type", "") != "CPU"
                d.use = gpu
                if gpu:
                    used = True
                    log(f"GPU: {d.name} ({d.type})")
            if used:
                scene.cycles.device = "GPU"
                return dtype
        except Exception as exc:
            log(f"{dtype} unavailable ({exc})")
    scene.cycles.device = "CPU"
    return "CPU"


def setup_eevee() -> None:
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    log(f"Engine {scene.render.engine}")


def render_to(path: str, label: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.context.scene.render.filepath = path
    log(f"Render {label} -> {path}")
    bpy.ops.render.render(write_still=True)


def make_front_cam(spawn):
    name = "CameraStyleTest"
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.cameras.new(name)
    data.type = "PERSP"
    data.lens = 28
    data.clip_start = 0.2
    data.clip_end = 250.0
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = spawn.location.copy()
    obj.rotation_euler = spawn.rotation_euler.copy()
    return obj


def stills(spawn) -> None:
    scene = bpy.context.scene
    cam = make_front_cam(spawn)
    scene.camera = cam
    setup_eevee()
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 95
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    render_to(os.path.join(PREVIEW, "watercolor_front.jpg"), "watercolor+depth still")

    scene.render.image_settings.file_format = "PNG"
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = False
    saved = scene.compositing_node_group
    scene.compositing_node_group = None
    beauty = os.path.join(PREVIEW, "cell_beauty.png")
    render_to(beauty, "beauty")

    scene.compositing_node_group = style.build_depth_only()
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    scene.view_settings.exposure = 0.0
    depth_path = os.path.join(PREVIEW, "cell_depth.png")
    render_to(depth_path, "depth")
    scene.view_settings.exposure = 0.8

    beauty_rgb = style.load_rgb(beauty)
    depth_rgb = style.load_rgb(depth_path)[:, :, 0]
    style.write_cell8(beauty_rgb, depth_rgb, os.path.join(PREVIEW, "cell8_front.jpg"))
    style.write_lineart(depth_rgb, os.path.join(PREVIEW, "lineart_front.jpg"))

    scene.compositing_node_group = saved
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True


def panos() -> None:
    scene = bpy.context.scene
    device = enable_gpu()
    log(f"Cycles device: {device}")
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 95
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    for name, filename in (("CameraSpawn", "spawn.jpg"), ("CameraGutter", "gutter.jpg")):
        cam = bpy.data.objects[name]
        data = cam.data
        data.type = "PANO"
        for pano_type in ("EQUIRECTANGULAR", "EQUIRECT"):
            try:
                data.panorama_type = pano_type
                break
            except Exception:
                continue
        data.clip_start = 0.05
        data.clip_end = 250.0
        scene.camera = cam
        render_to(os.path.join(OUT, filename), f"pano {filename}")


def walk_clip() -> None:
    pts = walk_pts()
    walk = bpy.data.objects["CameraWalk"]
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
    fps = 24
    frame_count = int(round(WALK_SECONDS * fps))
    for i in range(frame_count):
        u = i / max(1, frame_count - 1)
        s = hold_ease(u)
        loc = sample_path(pts, s)
        rot = style.look_basis(-forward_at(s), world_up)
        frame = i + 1
        walk.location = loc
        walk.rotation_euler = rot
        walk.keyframe_insert("location", frame=frame)
        walk.keyframe_insert("rotation_euler", frame=frame)

    setup_eevee()
    scene = bpy.context.scene
    data = walk.data
    data.type = "PERSP"
    data.sensor_fit = "HORIZONTAL"
    data.angle = WALK_FOV
    data.clip_start = 0.2
    data.clip_end = 250.0
    scene.camera = walk
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1080
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frame_count
    scene.render.image_settings.file_format = "PNG"
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    frames_dir = os.path.join(OUT, "_walk_frames")
    os.makedirs(frames_dir, exist_ok=True)
    for name in os.listdir(frames_dir):
        if name.startswith("walk_") and name.endswith(".png"):
            os.remove(os.path.join(frames_dir, name))
    scene.render.filepath = os.path.join(frames_dir, "walk_")
    log(f"Walk {frame_count} frames 1080x1080 watercolor FOV={WALK_FOV}")
    bpy.ops.render.render(animation=True)
    mp4 = os.path.join(OUT, "walk.mp4")
    ok = encode_ffmpeg(frames_dir, mp4, fps)
    log("Walk " + (mp4 if ok else frames_dir))


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    spawn = bpy.data.objects["CameraSpawn"]
    style.apply_style_to_scene(spawn)
    stills(spawn)
    panos()
    walk_clip()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    done = os.path.join(OUT, "RENDER_DONE.txt")
    with open(done, "w", encoding="utf-8") as f:
        f.write("HQ watercolor (no outlines)\n")
        f.write("spawn.jpg gutter.jpg walk.mp4\n")
        f.write("walk_preview/watercolor_front.jpg cell8_front.jpg lineart_front.jpg\n")
    log("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
