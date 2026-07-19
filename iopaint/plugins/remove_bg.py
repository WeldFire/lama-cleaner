import os
import cv2
import numpy as np
from loguru import logger
import torch
import torch.nn.functional as F
from torch.hub import get_dir

from iopaint.plugins.base_plugin import BasePlugin
from iopaint.schema import Device, RunPluginRequest, RemoveBGModel


def _rmbg_remove(device, *args, **kwargs):
    from rembg import remove

    return remove(*args, **kwargs)


class LucidaSession:
    """Pinned Lucida inference with 1024px ImageNet-normalized RGB input and uint8 alpha output."""

    model_id = "egeorcun/lucida"
    revision = "a34eeda32a7f43b487e7a30532153f47946512fa"
    input_size = 1024

    def __init__(self, device):
        from transformers import AutoModelForImageSegmentation

        self.device = torch.device(device)
        self.model = AutoModelForImageSegmentation.from_pretrained(
            self.model_id, revision=self.revision, trust_remote_code=True, torch_dtype=torch.float32
        )
        self.model.to(self.device).eval()

    @torch.inference_mode()
    def alpha(self, rgb_np_img: np.ndarray) -> np.ndarray:
        image = torch.from_numpy(rgb_np_img).permute(2, 0, 1).unsqueeze(0)
        image = image.to(device=self.device, dtype=torch.float32).div_(255)
        image = F.interpolate(image, size=(self.input_size, self.input_size), mode="bilinear", align_corners=False)
        mean = torch.tensor([0.485, 0.456, 0.406], device=self.device).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], device=self.device).view(1, 3, 1, 1)
        # Lucida returns multi-scale logits; the final item is its full-resolution alpha.
        prediction = self.model((image - mean) / std)[-1].sigmoid()
        prediction = F.interpolate(prediction, size=rgb_np_img.shape[:2], mode="bilinear", align_corners=False)
        return (prediction[0, 0].detach().float().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)


class RemoveBG(BasePlugin):
    name = "RemoveBG"
    support_gen_mask = True
    support_gen_image = True

    def __init__(self, model_name, device):
        self.model_name = model_name
        self.device = device
        super().__init__()

        if model_name.startswith("birefnet"):
            import rembg

            if rembg.__version__ < "2.0.59":
                raise ValueError(
                    "To use birefnet models, please upgrade rembg to >= 2.0.59. pip install -U rembg"
                )

        hub_dir = get_dir()
        model_dir = os.path.join(hub_dir, "checkpoints")
        os.environ["U2NET_HOME"] = model_dir

        self._init_session(model_name)

    def _init_session(self, model_name: str):
        self.device_warning()

        if model_name == RemoveBGModel.lucida:
            self.session = LucidaSession(self.device)
            self.remove = None
        elif model_name == RemoveBGModel.briaai_rmbg_1_4:
            from iopaint.plugins.briarmbg import (
                create_briarmbg_session,
                briarmbg_process,
            )

            self.session = create_briarmbg_session().to(self.device)
            self.remove = briarmbg_process
        elif model_name == RemoveBGModel.briaai_rmbg_2_0:
            from iopaint.plugins.briarmbg2 import (
                create_briarmbg2_session,
                briarmbg2_process,
            )

            self.session = create_briarmbg2_session().to(self.device)
            self.remove = briarmbg2_process
        else:
            from rembg import new_session

            self.session = new_session(model_name=model_name)
            self.remove = _rmbg_remove

    def switch_model(self, new_model_name):
        if self.model_name == new_model_name:
            return

        logger.info(
            f"Switching removebg model from {self.model_name} to {new_model_name}"
        )
        self._init_session(new_model_name)
        self.model_name = new_model_name

    @torch.inference_mode()
    def gen_image(self, rgb_np_img, req: RunPluginRequest) -> np.ndarray:
        if self.model_name == RemoveBGModel.lucida:
            return np.dstack((rgb_np_img, self.session.alpha(rgb_np_img)))

        bgr_np_img = cv2.cvtColor(rgb_np_img, cv2.COLOR_RGB2BGR)

        # return BGRA image
        output = self.remove(self.device, bgr_np_img, session=self.session)
        return cv2.cvtColor(output, cv2.COLOR_BGRA2RGBA)

    @torch.inference_mode()
    def gen_mask(self, rgb_np_img, req: RunPluginRequest) -> np.ndarray:
        if self.model_name == RemoveBGModel.lucida:
            return self.session.alpha(rgb_np_img)

        bgr_np_img = cv2.cvtColor(rgb_np_img, cv2.COLOR_RGB2BGR)

        # return BGR image, 255 means foreground, 0 means background
        output = self.remove(
            self.device, bgr_np_img, session=self.session, only_mask=True
        )
        return output

    def check_dep(self):
        try:
            if self.model_name == RemoveBGModel.lucida:
                import transformers
            else:
                import rembg
        except ImportError as e:
            import traceback

            error_msg = traceback.format_exc()
            dependency = "transformers" if self.model_name == RemoveBGModel.lucida else "rembg"
            return f"Install {dependency} failed, Error details:\n{error_msg}"

    def device_warning(self):
        if self.device == Device.cuda and self.model_name not in [
            RemoveBGModel.lucida,
            RemoveBGModel.briaai_rmbg_1_4,
            RemoveBGModel.briaai_rmbg_2_0,
        ]:
            logger.warning(
                f"remove_bg_device=cuda only supports briaai models({RemoveBGModel.briaai_rmbg_1_4.value}/{RemoveBGModel.briaai_rmbg_2_0.value})"
            )
