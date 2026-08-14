"""
Re-bake spawn.jpg and gutter.jpg from the saved .blend cameras.

Uses Cycles (EEVEE cannot render a real equirect photosphere).
Does not re-import the mesh or guess camera positions.

  blender --background --python scripts/blender/render_from_blend.py
"""
from __future__ import annotations

import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLEND = os.path.join(ROOT, "public", "tutorial", "bayard_tutorial.blend")
OUT = os.path.join(ROOT, "public", "tutorial")


def log(msg: str) -> None:
    print(msg, flush=True)


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


def retarget_walk_end() -> None:
    spawn = bpy.data.objects["CameraSpawn"]
    gutter = bpy.data.objects["CameraGutter"]
    walk = bpy.data.objects["CameraWalk"]
    scene = bpy.context.scene
    f0 = scene.frame_start or 1
    f2 = scene.frame_end or 168
    f1 = max(f0 + 1, f2 // 3)

    scene.frame_set(f0)
    walk.location = spawn.location.copy()
    walk.rotation_euler = spawn.rotation_euler.copy()
    walk.keyframe_insert("location", frame=f0)
    walk.keyframe_insert("rotation_euler", frame=f0)

    scene.frame_set(f2)
    walk.location = gutter.location.copy()
    walk.rotation_euler = gutter.rotation_euler.copy()
    walk.keyframe_insert("location", frame=f2)
    walk.keyframe_insert("rotation_euler", frame=f2)
    scene.frame_set(f0)
    log(f"Walk end retargeted to CameraGutter ({tuple(gutter.location)})")


def setup_cycles_pano() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.05
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 2
    scene.cycles.transparent_max_bounces = 4
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    for name in ("CameraSpawn", "CameraGutter"):
        cam = bpy.data.objects[name].data
        cam.type = "PANO"
        for pano_type in ("EQUIRECTANGULAR", "EQUIRECT"):
            try:
                cam.panorama_type = pano_type
                break
            except Exception:
                continue
        cam.clip_start = 0.05
        cam.clip_end = 250.0


def render_still(camera_name: str, filename: str) -> None:
    scene = bpy.context.scene
    scene.camera = bpy.data.objects[camera_name]
    path = os.path.join(OUT, filename)
    scene.render.filepath = path
    log(f"Rendering {filename} from {camera_name}")
    bpy.ops.render.render(write_still=True)
    log(f"Wrote {path}")


def main() -> None:
    if not os.path.isfile(BLEND):
        raise SystemExit(f"Missing {BLEND}")
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    device = enable_gpu()
    log(f"Cycles device: {device}")
    retarget_walk_end()
    setup_cycles_pano()
    render_still("CameraSpawn", "spawn.jpg")
    render_still("CameraGutter", "gutter.jpg")
    bpy.ops.wm.save_mainfile(filepath=BLEND)
    done = os.path.join(OUT, "RENDER_DONE.txt")
    with open(done, "w", encoding="utf-8") as f:
        f.write("spawn.jpg, gutter.jpg from saved cameras, engine=CYCLES\n")
        f.write("walk.mp4 not re-encoded this pass\n")
    log("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
