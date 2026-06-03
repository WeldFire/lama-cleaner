<h1 align="center">IOPaint</h1>
<p align="center">A free and open-source inpainting & outpainting tool powered by SOTA AI model.</p>

<p align="center">
  <a href="https://github.com/Sanster/IOPaint">
    <img alt="total download" src="https://pepy.tech/badge/iopaint" />
  </a>
  <a href="https://pypi.org/project/iopaint">
    <img alt="version" src="https://img.shields.io/pypi/v/iopaint" />
  </a>
  <a href="">
    <img alt="python version" src="https://img.shields.io/pypi/pyversions/iopaint" />
  </a>
  <a href="https://huggingface.co/spaces/Sanster/iopaint-lama">
    <img alt="HuggingFace Spaces" src="https://img.shields.io/badge/%F0%9F%A4%97%20HuggingFace-Spaces-blue" />
  </a>
  <a href="https://colab.research.google.com/drive/1TKVlDZiE3MIZnAUMpv2t_S4hLr6TUY1d?usp=sharing">
    <img alt="Open in Colab" src="https://colab.research.google.com/assets/colab-badge.svg" />
  </a>
</p>

|Erase([LaMa](https://www.iopaint.com/models/erase/lama))|Replace Object([PowerPaint](https://www.iopaint.com/models/diffusion/powerpaint))|
|-----|----|
|<video src="https://github.com/Sanster/IOPaint/assets/3998421/264bc27c-0abd-4d8b-bb1e-0078ab264c4a">  | <video src="https://github.com/Sanster/IOPaint/assets/3998421/1de5c288-e0e1-4f32-926d-796df0655846">|

|Draw Text([AnyText](https://www.iopaint.com/models/diffusion/anytext))|Out-painting([PowerPaint](https://www.iopaint.com/models/diffusion/powerpaint))|
|---------|-----------|
|<video src="https://github.com/Sanster/IOPaint/assets/3998421/ffd4eda4-f7d4-4693-93d8-d2cd5aa7c6d6">|<video src="https://github.com/Sanster/IOPaint/assets/3998421/c4af8aef-8c29-49e0-96eb-0aae2f768da2">|


## Features

- Completely free and open-source, fully self-hosted, support CPU & GPU & Apple Silicon
- [Windows 1-Click Installer](https://www.iopaint.com/install/windows_1click_installer)
- [OptiClean](https://apps.apple.com/ca/app/opticlean/id6452387177): macOS & iOS App for object erase
- Supports various AI [models](https://www.iopaint.com/models) to perform erase, inpainting or outpainting task.
  - [Erase models](https://www.iopaint.com/models#erase-models): These models can be used to remove unwanted object, defect, watermarks, people from image.
  - Diffusion models: These models can be used to replace objects or perform outpainting. Some popular used models include:
    - [runwayml/stable-diffusion-inpainting](https://huggingface.co/runwayml/stable-diffusion-inpainting)
    - [diffusers/stable-diffusion-xl-1.0-inpainting-0.1](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1)
    - [andregn/Realistic_Vision_V3.0-inpainting](https://huggingface.co/andregn/Realistic_Vision_V3.0-inpainting)
    - [Lykon/dreamshaper-8-inpainting](https://huggingface.co/Lykon/dreamshaper-8-inpainting)
    - [Sanster/anything-4.0-inpainting](https://huggingface.co/Sanster/anything-4.0-inpainting)
    - [BrushNet](https://www.iopaint.com/models/diffusion/brushnet)
    - [PowerPaintV2](https://www.iopaint.com/models/diffusion/powerpaint_v2)
    - [Sanster/AnyText](https://huggingface.co/Sanster/AnyText)
    - [Fantasy-Studio/Paint-by-Example](https://huggingface.co/Fantasy-Studio/Paint-by-Example)

- [Plugins](https://www.iopaint.com/plugins):
  - [Segment Anything](https://iopaint.com/plugins/interactive_seg): Accurate and fast Interactive Object Segmentation
  - [RemoveBG](https://iopaint.com/plugins/rembg): Remove image background or generate masks for foreground objects
  - [Anime Segmentation](https://iopaint.com/plugins/anime_seg): Similar to RemoveBG, the model is specifically trained for anime images.
  - [RealESRGAN](https://iopaint.com/plugins/RealESRGAN): Super Resolution
  - [GFPGAN](https://iopaint.com/plugins/GFPGAN): Face Restoration
  - [RestoreFormer](https://iopaint.com/plugins/RestoreFormer): Face Restoration
- [FileManager](https://iopaint.com/file_manager): Browse your pictures conveniently and save them directly to the output directory.


## Quick Start

### Docker

The fastest way to get started — no Python environment needed.

**Prerequisites:** [Docker Desktop](https://docs.docker.com/get-docker/) (or Docker Engine + Compose plugin). For GPU acceleration, also install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

```bash
git clone https://github.com/Sanster/IOPaint.git
cd IOPaint
docker compose up
```

Open **http://localhost:8080** in your browser. Models download automatically on first use and are cached in a Docker volume so subsequent starts are instant.

Configure via environment variables:

```bash
# CPU only (no GPU required)
DEVICE=cpu docker compose up

# CUDA GPU with a specific model
DEVICE=cuda MODEL=lama docker compose up

# Enable interactive segmentation with SAM2
DEVICE=cuda INTERACTIVE_SEG_MODEL=sam2_1_large docker compose up
```

| Variable | Default | Options |
|---|---|---|
| `DEVICE` | `cuda` | `cuda`, `cpu`, `mps` |
| `MODEL` | `lama` | See [supported models](https://www.iopaint.com/models) |
| `INTERACTIVE_SEG_MODEL` | `sam2_1_tiny` | `sam2_1_tiny`, `sam2_1_small`, `sam2_1_base`, `sam2_1_large` |
| `INTERACTIVE_SEG_DEVICE` | `cuda` | `cuda`, `cpu` |
| `PORT` | `8080` | Any free port |

---

### pip

```bash
# GPU — install CUDA PyTorch first
pip3 install torch==2.1.2 torchvision==0.16.2 --index-url https://download.pytorch.org/whl/cu118
# AMD GPU (Linux only)
# pip3 install torch==2.1.2 torchvision==0.16.2 --index-url https://download.pytorch.org/whl/rocm5.6

pip3 install iopaint
iopaint start --model=lama --device=cpu --port=8080
```

Visit http://localhost:8080. Models download automatically. See [model docs](https://www.iopaint.com/install/download_model) for custom download directories and [all supported models](https://www.iopaint.com/models).

### Plugins

Enable plugins with flags passed to `iopaint start` (see `iopaint start --help` for all options):

```bash
iopaint start --enable-interactive-seg --interactive-seg-device=cuda
```

More plugin examples at [iopaint.com/plugins](https://www.iopaint.com/plugins).

### Batch processing

```bash
iopaint run --model=lama --device=cpu \
  --image=/path/to/image_folder \
  --mask=/path/to/mask_folder \
  --output=output_dir
```

`--image` is the folder of input images, `--mask` is the folder of corresponding masks (or a single mask file applied to all images).

---

## Development

### Docker (recommended)

```bash
git clone https://github.com/Sanster/IOPaint.git
cd IOPaint
docker compose up --watch
```

Both the Python backend and the React frontend update automatically as you edit files.

| What changes | What happens | Latency |
|---|---|---|
| `iopaint/**` Python source | Synced into the container; backend restarts | ~5 s |
| `web_app/src/**` at **http://localhost:5173** | Vite HMR — browser updates without a reload | < 1 s |
| `web_app/src/**` at **http://localhost:8080** | Image rebuild (fast layers only); container restarts | ~30–60 s |
| `requirements.txt` / `setup.py` | Full image rebuild | ~10–15 min |
| `web_app/package.json` / `package-lock.json` | Frontend container restarts, re-runs `npm ci` | ~60 s |

| URL | Description |
|---|---|
| http://localhost:5173 | Vite dev server — instant HMR, recommended for frontend work |
| http://localhost:8080 | Built bundle served by the Python backend — good for end-to-end testing |

Model weights are stored in a named Docker volume (`models`) and persist across restarts.

### Local (without Docker)

Build and copy the frontend:

```bash
git clone https://github.com/Sanster/IOPaint.git
cd IOPaint/web_app
npm install
npm run build
cp -r dist/ ../iopaint/web_app
```

Create `web_app/.env.local` with the backend address:

```
VITE_BACKEND=http://127.0.0.1:8080
```

Start the frontend dev server:

```bash
npm run dev
```

Start the backend:

```bash
pip install -r requirements.txt
python3 main.py start --model lama --port 8080
```

Visit http://localhost:5173. Frontend changes hot-reload automatically; Python changes require a backend restart.
