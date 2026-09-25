"""Runs inside Unreal Editor 5.8 (launched by worker/backends/unreal.py).

Reads the job from $SLOP_JOB_JSON and turns a reconstructed head into a rigged,
assembled MetaHuman using the MetaHuman Character Python API:

  import head mesh -> track landmarks on portrait -> create character
  -> conform (head only) -> texture sources (cloud) -> auto-rig (cloud)
  -> assemble -> export DCC + DNA -> rig checks -> result.json -> quit

Every call below mirrors Epic's examples in
Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples.
The cloud steps need the editor to be signed in to an Epic account with
MetaHuman Cloud access (open the worker project interactively once to sign in).
"""
import json
import os
import traceback
from pathlib import Path

import unreal

JOB = json.loads(Path(os.environ["SLOP_JOB_JSON"]).read_text(encoding="utf-8"))
OUT = Path(JOB["out_dir"])
OUT.mkdir(parents=True, exist_ok=True)

state = {"step": "start", "steps": []}


def step(name):
    state["step"] = name
    state["steps"].append(name)
    unreal.log(f"[slop] {name}")


def write_result(payload):
    (OUT / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def delete_if_exists(path):
    if unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.delete_directory(path)
    elif unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)


def enum_value(enum_type, name):
    value = getattr(enum_type, name, None)
    if value is None:
        raise ValueError(f"{enum_type.__name__} has no member {name}")
    return value


def import_head_mesh(path, folder, name):
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = folder
    task.destination_name = name
    task.automated = True
    task.save = True
    task.replace_existing = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    for object_path in task.imported_object_paths:
        asset = unreal.load_asset(object_path)
        if isinstance(asset, (unreal.StaticMesh, unreal.SkeletalMesh)):
            return asset
    raise RuntimeError(f"Importing {path} produced no mesh")


def track_portrait(subsystem, portrait_path):
    image_size, pixels = unreal.PromotedFrameUtils.get_promoted_frame_as_pixel_array_from_disk(portrait_path)
    if image_size.x <= 0 or image_size.y <= 0:
        raise RuntimeError(f"Failed to load portrait {portrait_path}")
    result = subsystem.track_face_landmarks_from_image(pixels, image_size.x, image_size.y)
    if isinstance(result, tuple) and len(result) == 1:
        result = result[0]
    if not result or not hasattr(result, "items"):
        raise RuntimeError("No face landmarks found on the portrait render")
    return image_size, result


def camera_view(camera, image_size):
    view = unreal.MinimalViewInfo()
    view.location = unreal.Vector(*camera["location"])
    rot = camera["rotation"]
    view.rotation = unreal.Rotator(pitch=rot["pitch"], yaw=rot["yaw"], roll=rot["roll"])
    view.fov = float(camera["fov"])
    view.aspect_ratio = float(image_size.x) / float(image_size.y)
    view.projection_mode = unreal.CameraProjectionMode.PERSPECTIVE
    return view


def rig_checks(asset_name, build_folder, rig_type):
    """The gate for "pre-rigged": every build must pass before it ships."""
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    assets = registry.get_assets_by_path(f"{build_folder}/{asset_name}", recursive=True)
    skeletal = [a for a in assets if str(a.asset_class_path.asset_name) == "SkeletalMesh"]

    morph_targets = 0
    for data in skeletal:
        mesh = unreal.load_asset(str(data.package_name))
        names = getattr(mesh, "get_all_morph_target_names", lambda: [])()
        morph_targets = max(morph_targets, len(names))

    dna_files = sorted(p.name for p in (OUT / "dna").rglob("*.dna"))
    checks = {
        "assembled_assets": len(assets),
        "skeletal_meshes": len(skeletal),
        "dna_files": dna_files,
        "max_morph_targets": morph_targets,
        "rig_type": rig_type,
    }
    checks["passed"] = bool(
        skeletal
        and len(dna_files) >= 2  # head + body
        and (rig_type != "JOINTS_AND_BLENDSHAPES" or morph_targets > 0)
    )
    # TODO: deeper checks with Epic's DNACalib (joint count vs. archetype, no NaN deltas)
    # and a range-of-motion render to catch mesh explosions.
    return checks


def main():
    subsystem = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    name = JOB["asset_name"]
    options = JOB["options"]
    char_folder = JOB["character_folder"]
    build_folder = JOB["build_folder"]

    step("clean previous outputs")
    delete_if_exists(f"{char_folder}/{name}")
    delete_if_exists(f"{char_folder}/{name}_Head")
    delete_if_exists(f"{build_folder}/{name}")

    step("import head mesh")
    head_mesh = import_head_mesh(JOB["head_mesh"], char_folder, f"{name}_Head")

    step("track portrait landmarks")
    image_size, tracking = track_portrait(subsystem, JOB["portrait"])

    step("create character")
    character = asset_tools.create_asset(
        asset_name=name,
        package_path=char_folder,
        asset_class=unreal.MetaHumanCharacter,
        factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew),
    )
    if character is None:
        raise RuntimeError("Could not create the MetaHuman Character asset")
    if not subsystem.try_add_object_to_edit(character):
        raise RuntimeError("Character is already open for edit")

    try:
        step("conform head")
        vertices, indices, *_ = subsystem.get_mesh_data_for_conforming(head_mesh)
        params = unreal.ConformTargetParams()
        params.conform_target_mesh.target_parts_type = unreal.TargetPartsType.HEAD_ONLY
        params.conform_target_mesh.head_vertices = vertices
        params.conform_target_mesh.head_vertex_indices = indices
        params.auto_solve = True
        params.curve_tracking_points = tracking
        params.camera_view_info = camera_view(JOB["camera"], image_size)
        params.image_size = image_size
        key = unreal.MetaHumanCharacterTargetMeshKey()
        key.head_mesh = head_mesh
        if not subsystem.conform_to_target_meshes(character, key, params):
            raise RuntimeError("conform_to_target_meshes failed")
        # Verify on the first real run: Epic's combined-mesh example commits with
        # commit_posed_state_as_a_pose; for head-only conforms the face state is what changes.
        subsystem.commit_face_state(character)

        step("download texture sources (MetaHuman Cloud)")
        textures = unreal.MetaHumanCharacterTextureRequestParams()
        textures.blocking = True
        textures.report_progress = False
        subsystem.request_texture_sources(character, textures)

        step("auto-rig (MetaHuman Cloud)")
        rig = unreal.MetaHumanCharacterAutoRiggingRequestParams()
        rig.blocking = True
        rig.report_progress = False
        rig.rig_type = enum_value(unreal.MetaHumanRigType, options["rigType"])
        subsystem.request_auto_rigging(character, rig)

        step("assemble")
        build = unreal.MetaHumanCharacterEditorBuildParameters()
        build.pipeline_type = enum_value(unreal.MetaHumanDefaultPipelineType, options["pipeline"])
        build.pipeline_quality = enum_value(unreal.MetaHumanQualityLevel, options["quality"])
        build.absolute_build_path = build_folder
        build.common_folder_path = f"{build_folder}/Common"
        build.enable_wardrobe_item_validation = False
        subsystem.build_meta_human(character=character, params=build)

        step("export DCC")
        dcc = unreal.MetaHumanDCCExportParams()
        dcc.external_path = (OUT / "dcc").as_posix()
        dcc.bake_make_up = True
        dcc.compress_in_zip_file = True
        dcc.archive_name = "dcc"
        unreal.MetaHumanCharacterExportBlueprintLibrary.export_dcc(character, dcc)

        step("export DNA")
        dna = unreal.MetaHumanDNAExportParams()
        dna.external_path = (OUT / "dna").as_posix()
        dna.dna_head = True
        dna.dna_body = True
        unreal.MetaHumanCharacterExportBlueprintLibrary.export_dna(character, dna)
    finally:
        if subsystem.is_object_added_for_editing(character):
            subsystem.remove_object_to_edit(character)

    step("save")
    unreal.EditorAssetLibrary.save_directory(char_folder, only_if_is_dirty=False, recursive=True)
    unreal.EditorAssetLibrary.save_directory(build_folder, only_if_is_dirty=False, recursive=True)

    step("rig checks")
    checks = rig_checks(name, build_folder, options["rigType"])

    write_result(
        {
            "ok": True,
            "engine_version": unreal.SystemLibrary.get_engine_version(),
            "rig_checks": checks,
            "steps": state["steps"],
        }
    )


try:
    main()
except Exception as exc:  # report every failure to the worker, then still quit
    unreal.log_error(traceback.format_exc())
    write_result({"ok": False, "step": state["step"], "error": f"{type(exc).__name__}: {exc}", "steps": state["steps"]})
finally:
    unreal.SystemLibrary.quit_editor()
