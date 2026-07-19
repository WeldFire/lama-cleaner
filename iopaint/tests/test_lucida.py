import numpy as np
import torch

from iopaint.plugins.remove_bg import LucidaSession


def test_lucida_alpha_returns_source_sized_uint8_mask():
    session = object.__new__(LucidaSession)
    session.device = torch.device("cpu")
    session.model = lambda image: [torch.zeros((1, 1, 1024, 1024))]

    alpha = session.alpha(np.zeros((7, 11, 3), dtype=np.uint8))

    assert alpha.shape == (7, 11)
    assert alpha.dtype == np.uint8
    assert (alpha == 127).all()
