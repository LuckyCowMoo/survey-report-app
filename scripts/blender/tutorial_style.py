"""Shared tutorial look: warm sun, watercolor compositor, thin depth ink."""
from __future__ import annotations

import math
import os
import random

import bpy
import mathutils
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PAPER = os.path.join(ROOT, "public", "tutorial", "watercolor_paper.png")
INK = (0.071, 0.055, 0.047)

CELL8 = (
    (0.765, 0.720, 0.604),  # sky
    (0.659, 0.235, 0.196),  # brick
    (0.361, 0.149, 0.125),  # brick shadow
    (0.627, 0.596, 0.549),  # stone / trim
    (0.196, 0.220, 0.243),  # glass
    (0.353, 0.345, 0.337),  # asphalt
    (0.541, 0.188, 0.094),  # rust
    (0.235, 0.353, 0.196),  # foliage
)


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
    try:
        node.inputs[name].default_value = value
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


def make_paper(path: str = PAPER) -> str:
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
    return path


def add_warm_sun(centre, spawn) -> None:
    old = bpy.data.objects.get("WarmSun")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.lights.new("WarmSun", "SUN")
    data.color = (1.0, 0.78, 0.52)
    data.energy = 5.5
    if hasattr(data, "angle"):
        data.angle = math.radians(3.5)
    if hasattr(data, "use_shadow"):
        # Cascade shadows in EEVEE black out anything past ~20m and look like fog.
        data.use_shadow = False
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


def replace_world() -> None:
    scene = bpy.context.scene
    name = "WalkClearWorld"
    nw = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    scene.world = nw
    nt = nw.node_tree
    if nt is not None:
        nt.nodes.clear()
        bg = nt.nodes.new("ShaderNodeBackground")
        bg.inputs["Color"].default_value = (0.62, 0.74, 0.90, 1.0)
        bg.inputs["Strength"].default_value = 0.85
        out = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    mist = getattr(nw, "mist_settings", None)
    if mist is not None:
        mist.use_mist = False
        if hasattr(mist, "start"):
            mist.start = 10000.0
        if hasattr(mist, "depth"):
            mist.depth = 1.0
    log("World replaced (no volume, no mist)")


def hide_ground_plane() -> None:
    ground = bpy.data.objects.get("TutorialGround")
    if ground is not None:
        ground.hide_render = True
        ground.hide_set(True)
        log("Hid TutorialGround (was filling the view like fog)")


def clear_atmosphere() -> None:
    scene = bpy.context.scene
    vl = scene.view_layers[0]
    if hasattr(vl, "use_pass_mist"):
        vl.use_pass_mist = False
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        names = [a for a in dir(eevee) if not a.startswith("_")]
        foggy = [a for a in names if any(k in a.lower() for k in ("vol", "mist", "fog", "haze"))]
        log(f"EEVEE fog-related: {foggy}")
        for attr, val in (
            ("use_volumetric", False),
            ("use_volumetrics", False),
            ("use_volumetric_shadows", False),
            ("use_volume_shadows", False),
            ("use_bloom", False),
            ("use_gtao", False),
            ("use_raytracing", False),
            ("use_shadows", False),
            ("volumetric_tile_size", "16"),
        ):
            if hasattr(eevee, attr):
                try:
                    setattr(eevee, attr, val)
                except Exception:
                    pass
        if hasattr(eevee, "use_volume_custom_range"):
            try:
                eevee.use_volume_custom_range = True
            except Exception:
                pass
        if hasattr(eevee, "volumetric_start"):
            eevee.volumetric_start = 200.0
        if hasattr(eevee, "volumetric_end"):
            eevee.volumetric_end = 201.0
        if hasattr(eevee, "volumetric_samples"):
            try:
                eevee.volumetric_samples = 1
            except Exception:
                pass
    for cam in bpy.data.cameras:
        if hasattr(cam, "show_mist"):
            cam.show_mist = False
    for mat in bpy.data.materials:
        nt = getattr(mat, "node_tree", None)
        if nt is None:
            continue
        mout = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if mout is not None and "Volume" in mout.inputs:
            for lnk in list(mout.inputs["Volume"].links):
                nt.links.remove(lnk)
    for obj in bpy.data.objects:
        if obj.type == "VOLUME":
            obj.hide_render = True


def add_fill_light(centre, spawn) -> None:
    old = bpy.data.objects.get("FillSky")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.lights.new("FillSky", "SUN")
    data.color = (0.82, 0.88, 1.0)
    data.energy = 2.2
    if hasattr(data, "angle"):
        data.angle = math.radians(18.0)
    if hasattr(data, "use_shadow"):
        data.use_shadow = False
    obj = bpy.data.objects.new("FillSky", data)
    bpy.context.collection.objects.link(obj)
    # Opposite the key sun, a bit lower, so the far facade is not a black slab.
    offset = centre - spawn.location
    offset.z = 0.0
    if offset.length < 1:
        offset = mathutils.Vector((0.0, -18.0, 0.0))
    offset.normalize()
    obj.location = centre + offset * 6.0 + mathutils.Vector((0.0, 0.0, 14.0))
    obj.rotation_euler = look_basis(centre - obj.location, mathutils.Vector((0.0, 0.0, 1.0)))
    log(f"FillSky at {tuple(round(c, 1) for c in obj.location)}")


def set_kuwahara_size(size: float) -> None:
    tree = bpy.context.scene.compositing_node_group
    if tree is None:
        return
    kuw = next((n for n in tree.nodes if n.bl_idname == "CompositorNodeKuwahara"), None)
    rl = next((n for n in tree.nodes if n.bl_idname == "CompositorNodeRLayers"), None)
    paper_mix = next((n for n in tree.nodes if n.bl_idname == "ShaderNodeMix"), None)
    if kuw is None or rl is None or paper_mix is None:
        return
    mix_in = in_sock(paper_mix, "A", "Color1")
    if mix_in is None:
        return
    for lnk in list(mix_in.links):
        tree.links.remove(lnk)
    if size < 1.15:
        tree.links.new(out_sock(rl, "Image"), mix_in)
        log("Kuwahara bypassed (preview resolution)")
        return
    set_in(kuw, "Size", float(size))
    tree.links.new(out_sock(kuw, "Image"), mix_in)
    log(f"Kuwahara size {size}")


def build_watercolor(paper_path: str):
    """Kuwahara + paper. No ink / depth lines."""
    for ng in list(bpy.data.node_groups):
        if ng.name.startswith("Watercolor"):
            bpy.data.node_groups.remove(ng)

    tree = new_comp("WatercolorComp")
    n = tree.nodes.new
    rl = n("CompositorNodeRLayers")
    rl.location = (-700, 0)

    kuw = n("CompositorNodeKuwahara")
    kuw.location = (-420, 40)
    set_in(kuw, "Size", 5.0)
    set_in(kuw, "Type", "Anisotropic")
    set_in(kuw, "Uniformity", 4)
    set_in(kuw, "Sharpness", 0.55)
    set_in(kuw, "Eccentricity", 1.2)

    img = n("CompositorNodeImage")
    img.location = (-420, 240)
    img.image = bpy.data.images.load(paper_path)
    paper_scale = n("CompositorNodeScale")
    paper_scale.location = (-200, 240)
    set_in(paper_scale, "Type", "Render Size")
    set_in(paper_scale, "Frame Type", "Stretch")

    paper_mix = mix_node(tree, "MULTIPLY", (20, 40))
    set_in(paper_mix, "Factor", 0.18)

    cc = n("CompositorNodeColorCorrection")
    cc.location = (240, 40)
    set_in(cc, "Saturation", 1.16)
    set_in(cc, "Gamma", 1.0)
    set_in(cc, "Gain", 1.0)
    set_in(cc, "Contrast", 1.08)
    set_in(cc, "Offset", 0.0)

    out = n("NodeGroupOutput")
    out.location = (460, 40)

    link(tree, rl, ("Image",), kuw, ("Image",))
    link(tree, kuw, ("Image",), paper_mix, ("A", "Color1"))
    link(tree, img, ("Image",), paper_scale, ("Image",))
    link(tree, paper_scale, ("Image",), paper_mix, ("B", "Color2"))
    link(tree, paper_mix, ("Result", "Color"), cc, ("Image",))
    link(tree, cc, ("Image",), out, ("Image",))
    log("Watercolor compositor set (no outlines)")
    return tree


def albedo_as_emission() -> list:
    """Photogrammetry lighting is baked into the textures. EEVEE suns leave
    far faces unlit, which reads as grey distance fog. Drive emission from
    the existing base colour instead.
    """
    restores = []
    for mat in bpy.data.materials:
        if not getattr(mat, "use_nodes", False) or mat.node_tree is None:
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None or not out.inputs["Surface"].links:
            continue
        src_link = out.inputs["Surface"].links[0]
        src = src_link.from_socket
        from_node = src_link.from_node
        try:
            if from_node.get("is_albedo_emit"):
                continue
        except Exception:
            pass
        restores.append((nt, src, out))
        em = nt.nodes.new("ShaderNodeEmission")
        em["is_albedo_emit"] = True
        em.location = (from_node.location.x + 280, from_node.location.y)
        set_in(em, "Strength", 1.05)
        if from_node.type == "BSDF_PRINCIPLED" and "Base Color" in from_node.inputs:
            base = from_node.inputs["Base Color"]
            if base.links:
                nt.links.new(base.links[0].from_socket, em.inputs["Color"])
            else:
                em.inputs["Color"].default_value = base.default_value
        if mat.name == "TutorialGroundMat":
            em.inputs["Color"].default_value = (0.62, 0.58, 0.52, 1.0)
            set_in(em, "Strength", 1.35)
        em_out = em.outputs.get("Emission") or em.outputs[0]
        nt.links.new(em_out, out.inputs["Surface"])
        log(f"  albedo emission {mat.name}")
    return restores


def restore_materials(restores) -> None:
    for nt, src, out in restores:
        try:
            nt.links.new(src, out.inputs["Surface"])
        except Exception as exc:
            log(f"restore mat: {exc}")


def apply_style_to_scene(spawn) -> None:
    centre = mesh_centre()
    replace_world()
    hide_ground_plane()
    add_warm_sun(centre, spawn)
    add_fill_light(centre, spawn)
    paper = make_paper()
    tree = build_watercolor(paper)
    scene = bpy.context.scene
    scene.compositing_node_group = tree
    if hasattr(scene.render, "use_compositing"):
        scene.render.use_compositing = True
    if hasattr(scene, "view_settings"):
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0
    clear_atmosphere()


def box_blur(ch, radius: int):
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
    out = mask.astype(np.uint8)
    for _ in range(max(0, steps)):
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


def load_rgb(path: str):
    img = bpy.data.images.load(path)
    w, h = img.size
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    rgb = pix[:, :, :3].copy()
    bpy.data.images.remove(img)
    return rgb


def save_rgb(rgb, path: str, fmt: str = "JPEG") -> None:
    h, w, _ = rgb.shape
    pixels = np.ones((h, w, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(rgb, 0, 1)
    img = bpy.data.images.new("StyleOut", width=w, height=h, alpha=True)
    img.pixels = pixels.reshape(-1)
    img.filepath_raw = path
    img.file_format = fmt
    img.save()
    bpy.data.images.remove(img)
    log(f"Wrote {path}")


def depth_edge_mask(depth, dilate_steps: int = 1, thresh: float = 0.016):
    d = box_blur(depth, 3)
    gx = np.abs(np.pad(d[:, 1:] - d[:, :-1], ((0, 0), (0, 1)), mode="edge"))
    gy = np.abs(np.pad(d[1:, :] - d[:-1, :], ((0, 1), (0, 0)), mode="edge"))
    mag = np.sqrt(gx * gx + gy * gy)
    return dilate(mag > thresh, dilate_steps)


def snap_palette(rgb, pal, blur=5, majority=5):
    pal = np.array(pal, dtype=np.float32)
    h, w, _ = rgb.shape
    smooth = np.stack([box_blur(rgb[:, :, c], blur) for c in range(3)], axis=2)
    delta = smooth[:, :, None, :] - pal[None, None, :, :]
    idx = (delta * delta).sum(axis=-1).argmin(axis=-1)
    if majority >= 3:
        k = majority
        pad = k // 2
        padded = np.pad(idx, pad, mode="edge")
        from numpy.lib.stride_tricks import sliding_window_view

        win = sliding_window_view(padded, (k, k)).reshape(h, w, k * k)
        counts = np.stack([(win == i).sum(axis=-1) for i in range(pal.shape[0])], axis=0)
        idx = counts.argmax(axis=0)
    return pal[idx]


def write_cell8(beauty, depth, out_path: str) -> None:
    rgb = snap_palette(beauty, CELL8)
    rgb[depth_edge_mask(depth, dilate_steps=1)] = INK
    q8 = (np.clip(rgb, 0, 1) * 255).round().astype(np.int32)
    used = int(np.unique(q8.reshape(-1, 3), axis=0).shape[0])
    log(f"8-colour cell unique={used}")
    save_rgb(rgb, out_path)


def write_lineart(depth, out_path: str) -> None:
    h, w = depth.shape
    paper = np.full((h, w, 3), (0.93, 0.90, 0.84), dtype=np.float32)
    paper[depth_edge_mask(depth, dilate_steps=1, thresh=0.014)] = INK
    save_rgb(paper, out_path)


def build_depth_only(near: float = 0.4, far: float = 55.0):
    tree = new_comp("CellDepthComp")
    n = tree.nodes.new
    rl = n("CompositorNodeRLayers")
    rl.location = (-400, 0)
    mapped = n("ShaderNodeMapRange")
    mapped.location = (-80, 40)
    set_in(mapped, "From Min", near)
    set_in(mapped, "From Max", far)
    set_in(mapped, "To Min", 0.0)
    set_in(mapped, "To Max", 1.0)
    if hasattr(mapped, "clamp"):
        mapped.clamp = True
    comb = n("CompositorNodeCombineColor")
    comb.location = (120, 0)
    out = n("NodeGroupOutput")
    out.location = (340, 0)
    if "Depth" in rl.outputs:
        link(tree, rl, ("Depth",), mapped, ("Value",))
    for chan in ("Red", "Green", "Blue"):
        link(tree, mapped, ("Result", "Value"), comb, (chan,))
    link(tree, comb, ("Image",), out, ("Image",))
    return tree
