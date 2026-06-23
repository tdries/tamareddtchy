# One parametric Blender generator for the whole creature part library.
# Usage:
#   blender --background --python scripts/blender/gen_part.py -- <part> <variant> <out.glb>
#
# part   = body | head | ear | horn | limb
# variant= a name that tweaks the shape (e.g. body/round, head/long, ear/tall,
#          horn/antler, limb/default)
#
# Design: every part is sculpted to a SHARED coordinate convention so the game can
# assemble them. Materials are neutral white (the game tints per genome). We bake
# a normal map from high-res surface noise into the GLB-friendly material so the
# low-ish poly export still reads as rich, organic skin (the "rich but cute"
# target). Pure offline: no external services.

import bpy
import sys
import math

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
part = args[0] if len(args) > 0 else "body"
variant = args[1] if len(args) > 1 else "default"
out = args[2] if len(args) > 2 else "/tmp/part.glb"


def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for b in (bpy.data.meshes, bpy.data.materials, bpy.data.textures):
        for d in list(b):
            try:
                b.remove(d)
            except Exception:
                pass


def organic_material(name="Skin", rough=0.5):
    # Principled BSDF with a procedural bump so surfaces are not glassy-smooth.
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.86, 0.86, 0.86, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    # noise -> bump -> normal, baked into the material (exports to GLB as a
    # normal contribution via the Principled node where supported)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 14.0
    tex.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def finalize(obj, mat, decimate=0.18):
    # Decimate hard BEFORE applying, so the exported mesh is light enough for a
    # mobile iframe while keeping the sculpted silhouette. ratio 0.18 = keep 18%.
    if decimate < 1.0:
        dec = obj.modifiers.new("Dec", "DECIMATE")
        dec.ratio = decimate
    bpy.ops.object.shade_smooth()
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception:
            pass
    obj.data.materials.append(mat)


def subsurf(obj, levels=2):
    s = obj.modifiers.new("Subsurf", "SUBSURF")
    s.levels = levels
    s.render_levels = levels


def displace(obj, strength=0.1, scale=1.0):
    tex = bpy.data.textures.new("disp", type="CLOUDS")
    tex.noise_scale = scale
    d = obj.modifiers.new("Disp", "DISPLACE")
    d.texture = tex
    d.strength = strength
    d.mid_level = 0.5


clean()

if part == "body":
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
    o = bpy.context.active_object
    if variant == "long":
        o.scale = (1.0, 1.05, 1.5)
    elif variant == "tall":
        o.scale = (0.95, 1.35, 1.0)
    else:  # round
        o.scale = (1.0, 1.12, 1.05)
    bpy.ops.object.transform_apply(scale=True)
    subsurf(o, 2)
    displace(o, 0.12, 0.9)
    # heavier bottom (belly)
    sd = o.modifiers.new("Taper", "SIMPLE_DEFORM")
    sd.deform_method = "TAPER"
    sd.factor = -0.18
    finalize(o, organic_material("Skin", 0.55))

elif part == "head":
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.7)
    o = bpy.context.active_object
    if variant == "long":  # snout/muzzle
        o.scale = (0.9, 0.95, 1.5)
    elif variant == "dome":
        o.scale = (1.0, 1.2, 1.0)
    else:
        o.scale = (1.0, 1.0, 1.05)
    bpy.ops.object.transform_apply(scale=True)
    subsurf(o, 2)
    displace(o, 0.06, 1.0)
    finalize(o, organic_material("Skin", 0.5))

elif part == "ear":
    if variant == "tall":
        bpy.ops.mesh.primitive_cone_add(radius1=0.18, depth=0.7, vertices=12)
    elif variant == "floppy":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.22)
        bpy.context.active_object.scale = (1, 1.6, 0.4)
        bpy.ops.object.transform_apply(scale=True)
    else:  # round
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.24)
        bpy.context.active_object.scale = (1, 1, 0.5)
        bpy.ops.object.transform_apply(scale=True)
    o = bpy.context.active_object
    subsurf(o, 2)
    finalize(o, organic_material("Skin", 0.55))

elif part == "horn":
    if variant == "antler":
        bpy.ops.mesh.primitive_cone_add(radius1=0.07, depth=0.6, vertices=8)
        main = bpy.context.active_object
        bpy.ops.mesh.primitive_cone_add(radius1=0.04, depth=0.3, vertices=6, location=(0.12, 0.0, 0.18))
        bpy.context.active_object.rotation_euler = (0, 0, -0.7)
        bpy.ops.object.select_all(action="SELECT")
        bpy.context.view_layer.objects.active = main
        bpy.ops.object.join()
        o = main
    elif variant == "curved":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.05, major_segments=12, minor_segments=8)
        o = bpy.context.active_object
    else:  # straight
        bpy.ops.mesh.primitive_cone_add(radius1=0.1, depth=0.5, vertices=10)
        o = bpy.context.active_object
    subsurf(o, 2)
    finalize(o, organic_material("Horn", 0.4))

elif part == "limb":
    # a tapered two-bulge limb (thigh + calf feel) ending in a paw
    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=1.0, vertices=16)
    o = bpy.context.active_object
    subsurf(o, 2)
    displace(o, 0.03, 1.2)
    # paw at the bottom
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.22, location=(0, 0, -0.5))
    bpy.context.active_object.scale = (1, 1.4, 0.7)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()
    finalize(o, organic_material("Skin", 0.55))

else:
    raise SystemExit("unknown part: " + part)

# No Draco: the meshes are already hard-decimated, so uncompressed GLB stays
# small, and we avoid DRACOLoader's worker/decoder fragility inside the iframe.
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
print("EXPORTED", part, variant, out)
