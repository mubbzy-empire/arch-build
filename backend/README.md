# Arch-Build Backend

This folder contains tools to parse architectural blueprints, train a segmentation model to extract walls/rooms/doors/windows, and convert parsed floorplans into 3D scenes (glTF/.glb). The goal: hybrid pipeline (CV + procedural geometry) for reliable conversion of real-world blueprints into realistic 3D houses with well-partitioned interiors.

Structure
- requirements.txt - Python dependencies
- data_loader.py - PyTorch Dataset + utilities
- blueprint_parser.py - image preprocessing, postprocessing and vectorization helpers
- train_unet.py - training script (example) for a U-Net segmentation model
- convert_to_3d.py - procedural 3D builder that exports glTF using trimesh/pygltflib
- blender/convert_floorplan_blender.py - Blender headless script to import JSON and create a high-quality .blend/.gltf

Notes
- This is scaffold code: you will need to provide labeled segmentation masks for supervised training, or use the provided heuristics in blueprint_parser.py as a fallback.
- Running Blender script requires a Blender installation and running blender in background mode: blender --background --python convert_floorplan_blender.py -- <input.json> <output.blend>
