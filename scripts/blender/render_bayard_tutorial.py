"""
Bake the Bayard Station Valve House tutorial media.

Writes (into this repo's public/tutorial/):
  spawn.jpg   — 360 still at the front-elevation spawn
  gutter.jpg  — 360 still looking up at the gutter vegetation
  walk.mp4    — 2D clip walking from spawn-left around to the gutter view

The app already runs without these files (it feathers your Sketchfab stills
into fog). Drop the baked files in public/tutorial/ to replace the stand-ins.

Usage (Blender 4.x / 5.x, EEVEE):

  Double-click scripts/blender/run_tutorial_render.bat
  or from this repo:

  blender --background --python scripts/blender/render_bayard_tutorial.py -- ^
    --obj "C:\\Users\\lukea\\Downloads\\bayard-station-valve-house\\source\\model.zip" ^
    --out public/tutorial

If model.zip is still zipped, unzip it so --obj points at model.obj (and the
two JPEGs sit next to it).

After the first run, open the saved .blend and nudge:
  CameraSpawn, CameraWalkStart, CameraGutter
so the walk clip's first frame matches the guided turn in the app.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import zipfile


def _argv_after_dashes(argv: list[str]) -> list[str]:
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--obj",
        default=os.path.expandvars(
            r"%USERPROFILE%\Downloads\bayard-station-valve-house\source\model.zip"
        ),
        help="Path to model.obj or the Sketchfab model.zip that contains it",
    )
    p.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "tutorial"),
    )
    p.add_argument("--blend-out", default="")
    p.add_argument("--resolution", type=int, default=2048, help="Equirect width (height is half)")
    p.add_argument("--walk-frames", type=int, default=168)
    p.add_argument("--fps", type=int, default=24)
    return p.parse_args(_argv_after_dashes(sys.argv))


def ensure_obj(path: str, work: str) -> str:
    path = os.path.abspath(path)
    if path.lower().endswith(".obj") and os.path.isfile(path):
        return path
    if path.lower().endswith(".zip") and os.path.isfile(path):
        os.makedirs(work, exist_ok=True)
        with zipfile.ZipFile(path) as z:
            z.extractall(work)
        obj = os.path.join(work, "model.obj")
        if not os.path.isfile(obj):
            raise SystemExit(f"No model.obj inside {path}")
        return obj
    raise SystemExit(f"Could not find OBJ or zip at {path}")


def encode_walk_ffmpeg(walk_dir: str, walk_mp4: str, fps: int) -> bool:
    import shutil
    import subprocess

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    pattern = os.path.join(walk_dir, "walk_%04d.png")
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


def log(msg: str) -> None:
    print(msg, flush=True)


def configure_world(bpy, fog_density: float = 0.035) -> None:
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("TutorialWorld")
        bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.72, 0.74, 0.76, 1.0)
    bg.inputs["Strength"].default_value = 0.85
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    # EEVEE mist: hide the torn photogrammetry skirt.
    scene = bpy.context.scene
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr, value in (
            ("use_gtao", True),
            ("gtao_quality", 0.5),
            ("use_raytracing", False),
            ("use_soft_shadows", True),
        ):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass

    for cam in bpy.data.cameras:
        if hasattr(cam, "show_mist"):
            cam.show_mist = True

    mist = getattr(scene.world, "mist_settings", None)
    if mist is not None:
        try:
            mist.use_mist = True
            mist.start = 8.0
            mist.depth = 42.0
            mist.falloff = "QUADRATIC"
        except Exception:
            pass


def add_ground(bpy, z: float) -> None:
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, z))
    plane = bpy.context.object
    plane.name = "TutorialGround"
    mat = bpy.data.materials.new("TutorialGroundMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.22, 0.21, 0.2, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.92
    plane.data.materials.append(mat)


def add_camera(bpy, name: str, loc, rot, panoramic: bool) -> object:
    data = bpy.data.cameras.new(name)
    if panoramic:
        data.type = "PANO"
        for pano_type in ("EQUIRECTANGULAR", "EQUIRECT"):
            try:
                data.panorama_type = pano_type
                break
            except Exception:
                continue
        data.clip_start = 0.1
        data.clip_end = 250.0
    else:
        data.type = "PERSP"
        data.lens = 24
        data.clip_start = 0.1
        data.clip_end = 250.0
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def import_obj(bpy, obj_path: str) -> None:
    # Blender 4.x: wm.obj_import ; older: import_scene.obj
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=obj_path)
    else:
        bpy.ops.import_scene.obj(filepath=obj_path)


def main() -> None:
    args = parse_args()
    import bpy

    work = os.path.join(os.path.abspath(args.out), "_extract")
    obj_path = ensure_obj(args.obj, work)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_obj(bpy, obj_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("Import produced no meshes.")

    # Sketchfab OBJ is often Y-up; rotate into Blender Z-up if it looks sideways.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    import mathutils

    min_c = mathutils.Vector((math.inf, math.inf, math.inf))
    max_c = mathutils.Vector((-math.inf, -math.inf, -math.inf))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(corner)
            min_c.x, min_c.y, min_c.z = min(min_c.x, w.x), min(min_c.y, w.y), min(min_c.z, w.z)
            max_c.x, max_c.y, max_c.z = max(max_c.x, w.x), max(max_c.y, w.y), max(max_c.z, w.z)
    centre = (min_c + max_c) * 0.5
    size = max_c - min_c

    add_ground(bpy, min_c.z - 0.05)
    configure_world(bpy)

    # Default cameras: stand off the longest horizontal side, then arc left.
    stand = max(size.x, size.y) * 0.65
    spawn_loc = (centre.x, centre.y - stand, centre.z + size.z * 0.12)
    walk_loc = (centre.x - stand * 0.55, centre.y - stand * 0.35, centre.z + size.z * 0.18)
    gutter_loc = (centre.x - size.x * 0.15, centre.y - size.y * 0.08, centre.z + size.z * 0.42)

    def look_at(loc, target):
        direction = mathutils.Vector(target) - mathutils.Vector(loc)
        return direction.to_track_quat("-Z", "Y").to_euler()

    facade = (centre.x, centre.y, centre.z + size.z * 0.05)
    gutter_tgt = (
        centre.x - size.x * 0.12,
        centre.y + size.y * 0.02,
        centre.z + size.z * 0.55,
    )

    cam_spawn = add_camera(bpy, "CameraSpawn", spawn_loc, look_at(spawn_loc, facade), True)
    cam_walk0 = add_camera(
        bpy, "CameraWalkStart", walk_loc, look_at(walk_loc, facade), False
    )
    cam_gutter = add_camera(
        bpy, "CameraGutter", gutter_loc, look_at(gutter_loc, gutter_tgt), True
    )
    cam_walk = add_camera(bpy, "CameraWalk", spawn_loc, look_at(spawn_loc, facade), False)

    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    log(f"Render engine: {scene.render.engine}")
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution // 2
    scene.render.filepath = os.path.join(out_dir, "spawn.jpg")
    scene.camera = cam_spawn
    log("Rendering spawn.jpg")
    bpy.ops.render.render(write_still=True)

    scene.render.filepath = os.path.join(out_dir, "gutter.jpg")
    scene.camera = cam_gutter
    log("Rendering gutter.jpg")
    bpy.ops.render.render(write_still=True)

    # Walk: 2D perspective, spawn → walk-start → gutter.
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = args.walk_frames
    scene.camera = cam_walk

    def key(obj, frame, loc, rot):
        obj.location = loc
        obj.rotation_euler = rot
        obj.keyframe_insert("location", frame=frame)
        obj.keyframe_insert("rotation_euler", frame=frame)

    f0, f1, f2 = 1, args.walk_frames // 3, args.walk_frames
    key(cam_walk, f0, spawn_loc, look_at(spawn_loc, facade))
    key(cam_walk, f1, walk_loc, look_at(walk_loc, facade))
    key(cam_walk, f2, gutter_loc, look_at(gutter_loc, gutter_tgt))
    try:
        for fc in cam_walk.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
    except Exception as exc:
        log(f"Could not set bezier interpolation ({exc}); using defaults")

    walk_mp4 = os.path.join(out_dir, "walk.mp4")
    encoded = False
    try:
        scene.render.image_settings.file_format = "FFMPEG"
        ff = scene.render.ffmpeg
        ff.format = "MPEG4"
        ff.codec = "H264"
        try:
            ff.constant_rate_factor = "MEDIUM"
        except Exception:
            pass
        scene.render.filepath = walk_mp4
        log(f"Rendering walk.mp4 ({args.walk_frames} frames @ {args.fps} fps)")
        bpy.ops.render.render(animation=True)
        encoded = os.path.isfile(walk_mp4)
    except Exception as exc:
        log(f"Direct mp4 encode failed ({exc}); falling back to PNG frames")

    walk_dir = os.path.join(out_dir, "_walk_frames")
    if not encoded:
        os.makedirs(walk_dir, exist_ok=True)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(walk_dir, "walk_")
        log("Rendering walk PNG sequence")
        bpy.ops.render.render(animation=True)
        encoded = encode_walk_ffmpeg(walk_dir, walk_mp4, args.fps)

    blend = args.blend_out or os.path.join(out_dir, "bayard_tutorial.blend")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
    done = os.path.join(out_dir, "RENDER_DONE.txt")
    with open(done, "w", encoding="utf-8") as f:
        f.write(f"spawn.jpg, gutter.jpg, blend={blend}\n")
        f.write(f"walk.mp4={'yes' if encoded else 'NO — encode PNG frames with ffmpeg'}\n")
    log("Wrote stills, " + ("walk.mp4, " if encoded else "walk frames, ") + str(blend))
    if not encoded:
        log("Encode walk.mp4 with ffmpeg, e.g.")
        log(
            f'  ffmpeg -y -framerate {args.fps} -i "{walk_dir}/walk_%04d.png" '
            f'-c:v libx264 -pix_fmt yuv420p "{walk_mp4}"'
        )
    log("DONE")


if __name__ == "__main__":
    main()
