"""
Warm sun + style previews (watercolor compositor, cell-shade compositor).

  blender --background --python scripts/blender/apply_watercolor.py
"""
from __future__ import annotations

import math
import os
import random
import sys

import bpy
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLEND = os.path.join(ROOT, "public", "tutorial", "bayard_tutorial.blend")
OUT_WATER = os.path.join(ROOT, "public", "tutorial", "walk_preview", "watercolor_front.jpg")
OUT_CELL = os.path.join(ROOT, "public", "tutorial", "walk_preview", "cell_front.jpg")
OUT_BEAUTY = os.path.join(ROOT, "public", "tutorial", "walk_preview", "cell_beauty.png")
OUT_DEPTH = os.path.join(ROOT, "public", "tutorial", "walk_preview", "cell_depth.png")
PAPER = os.path.join(ROOT, "public", "tutorial", "watercolor_paper.png")

# Hand-picked from the front still (sRGB 0-1). Keep this under 25.
CELL_PALETTE = (
    (0.765, 0.720, 0.604),  # sky
    (0.659, 0.596, 0.471),  # sky haze
    (0.769, 0.384, 0.235),  # brick light
    (0.659, 0.235, 0.196),  # brick mid
    (0.361, 0.149, 0.125),  # brick shadow
    (0.180, 0.086, 0.078),  # brick deep
    (0.902, 0.878, 0.824),  # trim light
    (0.627, 0.596, 0.549),  # trim mid
    (0.478, 0.455, 0.424),  # stone
    (0.290, 0.275, 0.267),  # stone shadow
    (0.196, 0.220, 0.243),  # window glass
    (0.086, 0.086, 0.086),  # window void
    (0.541, 0.525, 0.510),  # asphalt light
    (0.353, 0.345, 0.337),  # asphalt
    (0.180, 0.180, 0.188),  # asphalt dark
    (0.784, 0.353, 0.157),  # rust light
    (0.541, 0.188, 0.094),  # rust
    (0.941, 0.925, 0.894),  # scrap white
    (0.235, 0.353, 0.196),  # foliage
    (0.141, 0.188, 0.118),  # foliage dark
)
INK = (0.071, 0.055, 0.047)


def log(msg: str) -> None:
    print(msg, flush=True)


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


def mesh_centre() -> mathutils.Vector:
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "TutorialGround"]
    min_c = mathutils.Vector((math.inf, math.inf, math.inf))
    max_c = mathutils.Vector((-math.inf, -math.inf, -math.inf))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(corner)
            min_c.x, min_c.y, min_c.z = min(min_c.x, w.x), min(min_c.y, w.y), min(min_c.z, w.z)
            max_c.x, max_c.y, max_c.z = max(max_c.x, w.x), max(max_c.y, w.y), max(max_c.z, w.z)
    return (min_c + max_c) * 0.5


def set_in(node, name: str, value) -> bool:
    if name not in node.inputs:
        return False
    sock = node.inputs[name]
    try:
        sock.default_value = value
        return True
    except Exception as exc:
        log(f"  could not set {node.name}.{name}={value!r}: {exc}")
        return False


def out_sock(node, *names):
    for name in names:
        color = [s for s in node.outputs if s.name == name and "Color" in s.bl_idname]
        if color:
            return color[0]
        if name in node.outputs:
            return node.outputs[name]
    color = [s for s in node.outputs if "Color" in s.bl_idname]
    return color[0] if color else (node.outputs[0] if node.outputs else None)


def in_sock(node, *names):
    for name in names:
        color = [s for s in node.inputs if s.name == name and "Color" in s.bl_idname]
        if color:
            return color[0]
        fac = [s for s in node.inputs if s.name == name]
        if fac:
            return fac[0]
    return None


def dump_node(node) -> None:
    ins = [(i.name, i.bl_idname) for i in node.inputs]
    outs = [(o.name, o.bl_idname) for o in node.outputs]
    log(f"  {node.bl_idname} in={ins} out={outs}")


def make_paper(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    w, h = 1920, 1080
    rng = random.Random(7)
    pixels = [0.0] * (w * h * 4)
    for y in range(h):
        for x in range(w):
            n1 = rng.random()
            n2 = (x * 12.9898 + y * 78.233) % 1.0
            grain = 0.78 + 0.16 * n1 + 0.06 * n2
            fibre = 0.04 * math.sin(x * 0.11) * math.sin(y * 0.07)
            v = max(0.55, min(0.98, grain + fibre))
            i = (y * w + x) * 4
            pixels[i] = v * 0.98
            pixels[i + 1] = v * 0.96
            pixels[i + 2] = v * 0.90
            pixels[i + 3] = 1.0
    img = bpy.data.images.new("WatercolorPaper", width=w, height=h)
    img.pixels = pixels
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    log(f"Wrote paper {path}")
    return path


def add_warm_sun(centre: mathutils.Vector, spawn) -> None:
    old = bpy.data.objects.get("WarmSun")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.lights.new("WarmSun", "SUN")
    data.color = (1.0, 0.78, 0.52)
    data.energy = 5.5
    if hasattr(data, "angle"):
        data.angle = math.radians(3.5)
    if hasattr(data, "use_shadow"):
        data.use_shadow = True
    obj = bpy.data.objects.new("WarmSun", data)
    bpy.context.collection.objects.link(obj)
    offset = spawn.location - centre
    offset.z = 0.0
    if offset.length < 1:
        offset = mathutils.Vector((0.0, 18.0, 0.0))
    offset.normalize()
    obj.location = centre + offset * 8.0 + mathutils.Vector((0.0, 0.0, 22.0))
    obj.rotation_euler = look_basis(centre - obj.location, mathutils.Vector((0.0, 0.0, 1.0)))
    log(f"WarmSun at {tuple(round(c, 1) for c in obj.location)}")


def mix_node(tree, blend: str, loc):
    mx = tree.nodes.new("ShaderNodeMix")
    mx.location = loc
    try:
        mx.data_type = "RGBA"
    except Exception:
        pass
    try:
        mx.blend_type = blend
    except Exception:
        pass
    set_in(mx, "Blend Type", blend)
    return mx


def link(tree, src_node, src_names, dst_node, dst_names) -> None:
    src = out_sock(src_node, *src_names)
    dst = in_sock(dst_node, *dst_names)
    if src is None or dst is None:
        log(f"missing link {src_node.name} {src_names} -> {dst_node.name} {dst_names}")
        return
    try:
        tree.links.new(src, dst)
    except Exception as exc:
        log(f"link {src_node.name} -> {dst_node.name}: {exc}")


def new_comp(name: str):
    tree = bpy.data.node_groups.new(name, "CompositorNodeTree")
    try:
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    except Exception as exc:
        log(f"interface socket: {exc}")
    return tree


def build_watercolor(paper_path: str):
    tree = new_comp("WatercolorComp")
    n = tree.nodes.new

    rl = n("CompositorNodeRLayers")
    rl.location = (-900, 0)

    kuw = n("CompositorNodeKuwahara")
    kuw.location = (-620, 80)
    dump_node(kuw)
    set_in(kuw, "Size", 8.0)
    set_in(kuw, "Type", "Anisotropic")
    set_in(kuw, "Uniformity", 4)
    set_in(kuw, "Sharpness", 0.55)
    set_in(kuw, "Eccentricity", 1.2)

    filt = n("CompositorNodeFilter")
    filt.location = (-620, -220)
    set_in(filt, "Type", "Sobel")
    set_in(filt, "Factor", 1.0)

    ramp = n("ShaderNodeValToRGB")
    ramp.location = (-400, -220)
    if hasattr(ramp, "color_ramp"):
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        ramp.color_ramp.elements[1].position = 0.72
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)

    outline = mix_node(tree, "MIX", (-160, 40))
    paper_mix = mix_node(tree, "MULTIPLY", (80, 80))
    set_in(paper_mix, "Factor", 0.40)
    b_sock = in_sock(outline, "B", "Color2")
    if b_sock is not None:
        b_sock.default_value = (0.18, 0.12, 0.08, 1.0)

    img = n("CompositorNodeImage")
    img.location = (-400, 280)
    img.image = bpy.data.images.load(paper_path)
    paper_scale = n("CompositorNodeScale")
    paper_scale.location = (-180, 280)
    set_in(paper_scale, "Type", "Render Size")
    set_in(paper_scale, "Frame Type", "Stretch")

    cc = n("CompositorNodeColorCorrection")
    cc.location = (300, 40)
    # First good still was sat 1.22 and a bit washed; nudge only.
    set_in(cc, "Saturation", 1.24)
    set_in(cc, "Gamma", 0.92)
    set_in(cc, "Gain", 1.16)
    set_in(cc, "Contrast", 0.96)
    set_in(cc, "Offset", 0.02)

    out = n("NodeGroupOutput")
    out.location = (520, 40)

    link(tree, rl, ("Image",), kuw, ("Image",))
    link(tree, kuw, ("Image",), filt, ("Image",))
    link(tree, kuw, ("Image",), outline, ("A", "Color1"))
    link(tree, filt, ("Image",), ramp, ("Fac", "Factor"))
    link(tree, ramp, ("Color", "Image"), outline, ("Factor", "Fac"))
    link(tree, outline, ("Result", "Color", "Image"), paper_mix, ("A", "Color1"))
    link(tree, img, ("Image",), paper_scale, ("Image",))
    link(tree, paper_scale, ("Image",), paper_mix, ("B", "Color2"))
    link(tree, paper_mix, ("Result", "Color", "Image"), cc, ("Image",))
    link(tree, cc, ("Image",), out, ("Image",))
    log("Watercolor compositor set")
    return tree


def build_depth_comp(near: float, far: float):
    tree = new_comp("CellDepthComp")
    n = tree.nodes.new
    rl = n("CompositorNodeRLayers")
    rl.location = (-400, 0)
    dump_node(rl)

    mapped = None
    for typ in ("ShaderNodeMapRange", "CompositorNodeNormalize"):
        try:
            mapped = n(typ)
            mapped.location = (-80, 40)
            log(f"  using {typ}")
            dump_node(mapped)
            break
        except Exception:
            continue
    if mapped is None:
        raise RuntimeError("no map/normalize node")
    set_in(mapped, "From Min", near)
    set_in(mapped, "From Max", far)
    set_in(mapped, "To Min", 0.0)
    set_in(mapped, "To Max", 1.0)
    set_in(mapped, "Value", 0.0)
    if hasattr(mapped, "clamp"):
        mapped.clamp = True
    if hasattr(mapped, "use_clamp"):
        mapped.use_clamp = True
    set_in(mapped, "Clamp", True)

    comb = n("CompositorNodeCombineColor")
    comb.location = (120, 0)

    out = n("NodeGroupOutput")
    out.location = (340, 0)
    depth_names = ("Depth", "Z", "Mist")
    linked = False
    for name in depth_names:
        if name in rl.outputs:
            link(tree, rl, (name,), mapped, ("Value", "From Min", "Image"))
            linked = True
            log(f"  depth from {name}")
            break
    if not linked:
        log("  WARNING: no Depth socket")
    for chan in ("Red", "Green", "Blue"):
        link(tree, mapped, ("Value", "Result", "Image"), comb, (chan,))
    link(tree, comb, ("Image",), out, ("Image",))
    log("Depth compositor set")
    return tree


def load_rgb(path: str):
    import numpy as np

    img = bpy.data.images.load(path)
    w, h = img.size
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    rgb = pix[:, :, :3]
    bpy.data.images.remove(img)
    return rgb


def box_blur(ch, radius: int):
    import numpy as np

    if radius <= 0:
        return ch
    out = ch.astype(np.float32)
    for _ in range(radius):
        pad = np.pad(out, 1, mode="edge")
        out = (
            pad[1:-1, 1:-1]
            + pad[:-2, 1:-1]
            + pad[2:, 1:-1]
            + pad[1:-1, :-2]
            + pad[1:-1, 2:]
        ) / 5.0
    return out


def dilate(mask, steps: int):
    import numpy as np

    out = mask.astype(np.uint8)
    for _ in range(steps):
        pad = np.pad(out, 1, mode="edge")
        out = np.maximum.reduce(
            [
                pad[1:-1, 1:-1],
                pad[:-2, 1:-1],
                pad[2:, 1:-1],
                pad[1:-1, :-2],
                pad[1:-1, 2:],
            ]
        )
    return out.astype(bool)


def apply_palette_and_depth_ink(beauty_path: str, depth_path: str, out_path: str) -> None:
    import numpy as np

    rgb = load_rgb(beauty_path)
    depth = load_rgb(depth_path)[:, :, 0]
    h, w, _ = rgb.shape
    pal = np.array(CELL_PALETTE, dtype=np.float32)

    flat = box_blur(rgb.mean(axis=2), 1)
    # Blur each channel slightly so brick grain collapses before snapping.
    smooth = np.stack([box_blur(rgb[:, :, c], 6) for c in range(3)], axis=2)

    delta = smooth[:, :, None, :] - pal[None, None, :, :]
    idx = (delta * delta).sum(axis=-1).argmin(axis=-1)

    # Majority filter so neighbouring bricks become one flat.
    n_pal = pal.shape[0]
    padded = np.pad(idx, 2, mode="edge")
    from numpy.lib.stride_tricks import sliding_window_view

    win = sliding_window_view(padded, (5, 5)).reshape(h, w, 25)
    counts = np.stack([(win == i).sum(axis=-1) for i in range(n_pal)], axis=0)
    idx = counts.argmax(axis=0)
    quantized = pal[idx]

    d = box_blur(depth, 3)
    gx = np.abs(np.pad(d[:, 1:] - d[:, :-1], ((0, 0), (0, 1)), mode="edge"))
    gy = np.abs(np.pad(d[1:, :] - d[:-1, :], ((0, 1), (0, 0)), mode="edge"))
    mag = np.sqrt(gx * gx + gy * gy)
    edges = mag > 0.016
    edges = dilate(edges, 3)

    ink = np.array(INK, dtype=np.float32)
    quantized[edges] = ink
    q8 = (np.clip(quantized, 0, 1) * 255.0).round().astype(np.int32)
    used = int(np.unique(q8.reshape(-1, 3), axis=0).shape[0])
    log(f"Cell palette size {len(pal)}, unique after snap {used}, edge px {int(edges.sum())}")

    pixels = np.ones((h, w, 4), dtype=np.float32)
    pixels[:, :, :3] = quantized
    img = bpy.data.images.new("CellPaletteOut", width=w, height=h, alpha=True)
    img.pixels = pixels.reshape(-1)
    img.filepath_raw = out_path
    img.file_format = "JPEG"
    img.save()
    bpy.data.images.remove(img)
    log(f"Wrote {out_path}")
    _ = flat


def make_front_camera(spawn) -> object:
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


def render_still(scene, path: str, label: str) -> None:
    scene.render.filepath = path
    log(f"Render {label} {scene.render.engine} -> {path}")
    bpy.ops.render.render(write_still=True)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for ng in list(bpy.data.node_groups):
        if ng.name.startswith("Watercolor") or ng.name.startswith("Cell"):
            bpy.data.node_groups.remove(ng)

    spawn = bpy.data.objects["CameraSpawn"]
    centre = mesh_centre()
    world = bpy.context.scene.world
    if world is not None:
        world.color = (0.42, 0.38, 0.32)
        if hasattr(world, "use_nodes") and world.use_nodes and world.node_tree:
            bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
            if bg is not None and "Strength" in bg.inputs:
                bg.inputs["Strength"].default_value = 0.7
            if bg is not None and "Color" in bg.inputs:
                bg.inputs["Color"].default_value = (0.55, 0.48, 0.38, 1.0)

    add_warm_sun(centre, spawn)
    paper = make_paper(PAPER)
    water = build_watercolor(paper)
    cam = make_front_camera(spawn)

    scene = bpy.context.scene
    scene.camera = cam
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    vl = scene.view_layers[0]
    if hasattr(vl, "use_pass_z"):
        vl.use_pass_z = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    os.makedirs(os.path.dirname(OUT_CELL), exist_ok=True)
    if hasattr(scene, "view_settings"):
        scene.view_settings.exposure = 0.8
        scene.view_settings.gamma = 1.0

    reuse = os.path.exists(OUT_BEAUTY) and os.path.exists(OUT_DEPTH)
    if not reuse:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        if hasattr(scene.render, "use_compositing"):
            scene.render.use_compositing = False
        scene.compositing_node_group = None
        render_still(scene, OUT_BEAUTY, "cell beauty")

        depth = build_depth_comp(0.4, 55.0)
        if hasattr(scene.render, "use_compositing"):
            scene.render.use_compositing = True
        scene.compositing_node_group = depth
        try:
            scene.view_settings.view_transform = "Standard"
        except Exception:
            pass
        scene.view_settings.exposure = 0.0
        render_still(scene, OUT_DEPTH, "cell depth")
    else:
        log("Reusing cell_beauty.png and cell_depth.png")

    apply_palette_and_depth_ink(OUT_BEAUTY, OUT_DEPTH, OUT_CELL)

    scene.compositing_node_group = water
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
