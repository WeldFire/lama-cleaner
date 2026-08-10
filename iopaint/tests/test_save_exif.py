import io
from pathlib import Path
from typing import List

from PIL import Image

from iopaint.helper import pil_to_bytes, load_img

current_dir = Path(__file__).parent.absolute().resolve()


def print_exif(exif):
    for k, v in exif.items():
        print(f"{k}: {v}")


def extra_info(img_p: Path):
    ext = img_p.suffix.strip(".")
    img_bytes = img_p.read_bytes()
    np_img, _, infos = load_img(img_bytes, False, True)
    res_pil_bytes = pil_to_bytes(Image.fromarray(np_img), ext=ext, infos=infos)
    res_img = Image.open(io.BytesIO(res_pil_bytes))
    return infos, res_img.info, res_pil_bytes


def assert_keys(keys: List[str], infos, res_infos):
    for k in keys:
        assert k in infos
        assert k in res_infos
        assert infos[k] == res_infos[k]


def run_test(file_path, keys, tmp_path):
    infos, res_infos, res_pil_bytes = extra_info(file_path)
    assert_keys(keys, infos, res_infos)
    # Windows can deny a second open of NamedTemporaryFile. pytest's temporary
    # directory gives this round-trip a closed, cross-platform path instead.
    temp_file = tmp_path / f"roundtrip{file_path.suffix}"
    temp_file.write_bytes(res_pil_bytes)
    infos, res_infos, res_pil_bytes = extra_info(temp_file)
    assert_keys(keys, infos, res_infos)


def test_png_icc_profile_png(tmp_path):
    run_test(current_dir / "icc_profile_test.png", ["icc_profile", "exif"], tmp_path)


def test_png_icc_profile_jpeg(tmp_path):
    run_test(current_dir / "icc_profile_test.jpg", ["icc_profile", "exif"], tmp_path)


def test_jpeg(tmp_path):
    jpg_img_p = current_dir / "bunny.jpeg"
    run_test(jpg_img_p, ["dpi", "exif"], tmp_path)


def test_png_parameter(tmp_path):
    jpg_img_p = current_dir / "png_parameter_test.png"
    run_test(jpg_img_p, ["parameters"], tmp_path)
