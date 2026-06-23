# Headless Blender script: sculpt a high-quality creature body and export GLB.
# Run: blender --background --python scripts/blender/sculpt_body.py -- out.glb
#
# Proves the pipeline: Blender's modifiers (subdivision + displacement from
# procedural noise) produce a sculpted, organic, high-poly-looking body that a
# raw Three.js primitive can't match, exported as a GLB the game loads. Vertex
# colors are left neutral so the game tints per genome; the SHAPE is the value.

import bpy
import sys
import math

# ---- args: output path after the "--" separator ----
argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "/tmp/body.glb"

# ---- clean scene ----
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# ---- base: an ico sphere, then sculpt it up ----
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
obj = bpy.context.active_object
obj.name = "Body"

# pear/torso proportions
obj.scale = (1.0, 1.15, 1.05)
bpy.ops.object.transform_apply(scale=True)

# subdivision surface for smooth high-res geometry
sub = obj.modifiers.new("Subsurf", "SUBSURF")
sub.levels = 3
sub.render_levels = 3

# displacement from a procedural texture for organic surface relief (skin lumps)
tex = bpy.data.textures.new("skin", type="MUSGRAVE")
try:
    tex.musgrave_type = "MULTIFRACTAL"
    tex.noise_scale = 0.9
    tex.dimension_max = 1.2
except Exception:
    pass
disp = obj.modifiers.new("Disp", "DISPLACE")
disp.texture = tex
disp.strength = 0.12
disp.mid_level = 0.5

# a gentle taper so the bottom is heavier (sits like a belly)
bpy.ops.object.modifier_add(type="SIMPLE_DEFORM")
sd = obj.modifiers[-1]
sd.deform_method = "TAPER"
sd.factor = -0.15

# shade smooth
bpy.ops.object.shade_smooth()

# apply modifiers so the GLB carries the real sculpted geometry
bpy.context.view_layer.objects.active = obj
for m in list(obj.modifiers):
    try:
        bpy.ops.object.modifier_apply(modifier=m.name)
    except Exception:
        pass

# ---- a clean PBR material (neutral white; game multiplies by genome color) ----
mat = bpy.data.materials.new("Skin")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.85, 0.85, 0.85, 1.0)
    # roughness varies a touch for a soft organic sheen
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.55
obj.data.materials.append(mat)

# ---- export GLB ----
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
print("EXPORTED", out)
