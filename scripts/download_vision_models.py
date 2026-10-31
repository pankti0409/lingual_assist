"""Install Google's versioned MediaPipe bundles without third-party mirrors.

Run: python scripts/download_vision_models.py
Source: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md
"""
from pathlib import Path
import hashlib
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = {
    "face_landmarker": (
        "face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    ),
    "gesture_recognizer": (
        "gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
        "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482",
    ),
}


def main():
    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)
    records = {}
    for name, (path, expected_sha256) in MODELS.items():
        url = "https://storage.googleapis.com/mediapipe-models/" + path
        target = assets / f"{name}.task"
        temp = target.with_suffix(".task.part")
        if not target.exists():
            print(f"Downloading {name}…", flush=True)
            try:
                with urllib.request.urlopen(url, timeout=60) as response, temp.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                with zipfile.ZipFile(temp) as bundle:
                    if bundle.testzip() is not None:
                        raise ValueError(f"Corrupt model bundle: {name}")
                temp.replace(target)
            finally:
                temp.unlink(missing_ok=True)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != expected_sha256:
            raise ValueError(f"SHA-256 mismatch for {name}: expected {expected_sha256}, got {digest}")
        records[name] = {"url": url, "sha256": digest, "bytes": target.stat().st_size}
        print(f"{name}: {target.stat().st_size} bytes, SHA256 {digest}", flush=True)
    (assets / "models.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
