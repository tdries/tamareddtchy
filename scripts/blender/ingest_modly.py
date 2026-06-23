# Ingest a raw image-to-3D GLB (from Modly / Hunyuan3D / TRELLIS / TripoSR) and
# normalize it into a game-ready creature asset.
#
# Usage:
#   blender --background --python scripts/blender/ingest_modly.py -- <in.glb> <name> [target_tris]
#
# in.glb       raw mesh from the image-to-3D tool (any scale/orientation/poly count)
# name         output name -> src/client/public/assets/creatures/<name>.glb
# target_tris  optional triangle budget (default 6000) for the mobile iframe
#
# What it does, all the messy real-world cleanup these AI meshes need:
#   - join all mesh objects into one
#   - recenter to origin, scale so height = 2 units (our creature convention)
#   - stand it upright on Y, face +Z (best-effort; AI meshes vary)
#   - decimate to the triangle budget (these meshes are often 100k+ tris)
#   - keep the baked texture/material if present (the AI color), else neutral
#   - export a light GLB into the creatures library

import bpy
import sys

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 2:
    raise SystemExit("usage: -- <in.glb> <name> [target_tris]")
src = args[0]
name = args[1]
target_tris = int(args[2]) if len(args) > 2 else 6000

ROOT = "/Users/timdries/Desktop/Projects/TD-ITSFORSALE/TD-DEVPOST-REDDIT"
out = f"{ROOT}/src/client/public/assets/creatures/{name}.glb"

# clean scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# import the raw GLB
bpy.ops.import_scene.gltf(filepath=src)

# collect mesh objects
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no meshes in " + src)

# join into one object
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# recenter origin to geometry, move to world origin
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
obj.location = (0, 0, 0)

# scale so the tallest dimension is 2 units (matches our procedural body span)
bpy.context.view_layer.update()
dims = obj.dimensions
tallest = max(dims.x, dims.y, dims.z) or 1.0
s = 2.0 / tallest
obj.scale = (s, s, s)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)

# decimate to the triangle budget
me = obj.data
tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > target_tris:
    dec = obj.modifiers.new("Dec", "DECIMATE")
    dec.ratio = max(0.02, target_tris / tris)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Dec")

bpy.ops.object.shade_smooth()

# export (keep whatever material/texture the AI mesh carried)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
final_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f"INGESTED {name}: {tris} -> {final_tris} tris  ->  {out}")
