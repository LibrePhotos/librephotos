import runpy
from pathlib import Path


if __name__ == "__main__":
    runpy.run_path(
        str(
            Path(__file__).resolve().parents[1]
            / "multimodal_inference"
            / "main.py"
        ),
        run_name="__main__",
    )
