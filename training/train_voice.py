"""Train a 7-emotion voice classifier on 3-second RAVDESS windows, split by actor.

--arch wavlm    fine-tune microsoft/wavlm-base-plus (baseline, same model as the old project)
--arch mel_cnn  ImageNet-pretrained EfficientNet-B0 on log-mel spectrograms (CNN)

Example (Kaggle GPU):
  python training/prepare_voice.py --audio-dir /kaggle/input/ravdess-emotional-speech-audio --out m.csv
  python training/train_voice.py --audio-dir /kaggle/input/ravdess-emotional-speech-audio --manifest m.csv \
      --out-dir out/voice_mel --arch mel_cnn
"""

import argparse
import csv
import logging
import math
import random
from collections import Counter
from pathlib import Path

import soundfile as sf
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio
import torchaudio.functional as AF
from torch.utils.data import DataLoader, Dataset

from emotions import EMOTIONS
from loop import finish, fit, pick_device, set_seed

log = logging.getLogger("train")
SAMPLE_RATE = 16000
WAVLM = "microsoft/wavlm-base-plus"


def load_clip(path: Path) -> torch.Tensor:
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    wav = torch.from_numpy(audio.mean(axis=1))
    return AF.resample(wav, sr, SAMPLE_RATE) if sr != SAMPLE_RATE else wav


def fit_length(wav: torch.Tensor, length: int, random_offset: bool) -> torch.Tensor:
    if len(wav) < length:
        return torch.nn.functional.pad(wav, (0, length - len(wav)))
    start = random.randint(0, len(wav) - length) if random_offset else (len(wav) - length) // 2
    return wav[start:start + length]


class VoiceDataset(Dataset):
    """Clips are decoded once and kept in memory (all of RAVDESS is about 80 MB at 16 kHz)."""

    def __init__(self, rows: list[dict], root: Path, window: int, train: bool):
        self.clips = [load_clip(root / r["path"]) for r in rows]
        self.targets = [EMOTIONS.index(r["label"]) for r in rows]
        self.window, self.train = window, train

    def __len__(self) -> int:
        return len(self.clips)

    def __getitem__(self, i: int):
        wav = self.clips[i]
        if self.train:
            speed = random.uniform(0.9, 1.1)  # speed perturbation by resampling
            wav = AF.resample(wav, int(SAMPLE_RATE * speed), SAMPLE_RATE)
        wav = fit_length(wav, self.window, random_offset=self.train)
        if self.train:
            wav = wav * random.uniform(0.7, 1.3)
            if random.random() < 0.5:  # background noise at 15-35 dB SNR
                snr = random.uniform(15, 35)
                wav = wav + torch.randn_like(wav) * wav.pow(2).mean().sqrt() / (10 ** (snr / 20))
        return wav, self.targets[i]


class LogMel(nn.Module):
    """Log-mel spectrogram (dB, 80 dB floor) built from conv1d + matmul, so the model exports to ONNX.

    Matches torchaudio.transforms.MelSpectrogram(center=False); torchaudio's own STFT uses complex
    numbers, which the ONNX exporter rejects.
    """

    def __init__(self, n_fft: int = 512, win_length: int = 400, hop: int = 160, n_mels: int = 128):
        super().__init__()
        left = (n_fft - win_length) // 2
        window = F.pad(torch.hann_window(win_length), (left, n_fft - win_length - left))
        angle = 2 * math.pi * torch.arange(n_fft // 2 + 1)[:, None] * torch.arange(n_fft)[None, :] / n_fft
        self.register_buffer("dft", (torch.cat([torch.cos(angle), -torch.sin(angle)]) * window)[:, None, :])
        self.register_buffer("fbank", AF.melscale_fbanks(n_fft // 2 + 1, 0.0, SAMPLE_RATE / 2, n_mels, SAMPLE_RATE))
        self.hop, self.n_freq = hop, n_fft // 2 + 1

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        spec = F.conv1d(wav.unsqueeze(1), self.dft, stride=self.hop)
        power = spec[:, :self.n_freq] ** 2 + spec[:, self.n_freq:] ** 2
        db = 10 * torch.log10(torch.matmul(power.transpose(1, 2), self.fbank).transpose(1, 2).clamp_min(1e-10))
        return torch.maximum(db, db.amax(dim=(1, 2), keepdim=True) - 80)


class MelCNN(nn.Module):
    """Log-mel spectrogram -> timm CNN. SpecAugment masks run only in training mode."""

    def __init__(self, cnn_name: str, pretrained: bool, n_classes: int):
        super().__init__()
        self.log_mel = LogMel()
        self.masks = nn.Sequential(torchaudio.transforms.FrequencyMasking(24), torchaudio.transforms.TimeMasking(48))
        self.cnn = timm.create_model(cnn_name, pretrained=pretrained, num_classes=n_classes, in_chans=1,
                                     drop_path_rate=0.1)

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        spec = self.log_mel(wav).unsqueeze(1)
        spec = (spec - spec.mean(dim=(2, 3), keepdim=True)) / (spec.std(dim=(2, 3), keepdim=True) + 1e-5)
        if self.training:
            spec = self.masks(spec)
        return self.cnn(spec)


class WavLMClassifier(nn.Module):
    def __init__(self, pretrained: bool, n_classes: int):
        super().__init__()
        from transformers import WavLMConfig, WavLMForSequenceClassification
        self.model = (WavLMForSequenceClassification.from_pretrained(WAVLM, num_labels=n_classes) if pretrained
                      else WavLMForSequenceClassification(WavLMConfig(num_labels=n_classes)))
        self.model.freeze_feature_encoder()  # the convolutional front end stays as pretrained

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        wav = (wav - wav.mean(-1, keepdim=True)) / (wav.std(-1, keepdim=True) + 1e-5)
        return self.model(input_values=wav).logits


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--audio-dir", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--arch", choices=["wavlm", "mel_cnn"], default="mel_cnn")
    p.add_argument("--cnn", default="efficientnet_b0.ra_in1k", help="timm model for --arch mel_cnn")
    p.add_argument("--pretrained", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--window-sec", type=float, default=3.0)
    p.add_argument("--lr", type=float, default=1e-3, help="head learning rate")
    p.add_argument("--backbone-lr", type=float, default=None, help="default 3e-5 for wavlm, 3e-4 for mel_cnn")
    p.add_argument("--weight-decay", type=float, default=0.01)
    p.add_argument("--label-smoothing", type=float, default=0.1)
    p.add_argument("--ema-decay", type=float, default=0.998)
    p.add_argument("--patience", type=int, default=8)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    if args.backbone_lr is None:
        args.backbone_lr = 3e-5 if args.arch == "wavlm" else 3e-4
    return args


def main(argv=None) -> None:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    set_seed(args.seed)
    device = pick_device()
    labels = list(EMOTIONS)
    window = int(args.window_sec * SAMPLE_RATE)

    with open(args.manifest, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    splits = {s: [r for r in rows if r["split"] == s] for s in ("train", "val", "test")}
    log.info("device %s | %s", device, {s: len(r) for s, r in splits.items()})

    if args.arch == "wavlm":
        model = WavLMClassifier(args.pretrained, len(labels))
        head = nn.ModuleList([model.model.projector, model.model.classifier])
    else:
        model = MelCNN(args.cnn, args.pretrained, len(labels))
        head = model.cnn.get_classifier()
    model.to(device)

    counts = Counter(r["label"] for r in splits["train"])
    class_weights = torch.tensor([len(splits["train"]) / (len(labels) * counts[n]) for n in labels])
    loader = dict(batch_size=args.batch_size, num_workers=args.workers, pin_memory=device.type == "cuda")
    train_dl = DataLoader(VoiceDataset(splits["train"], args.audio_dir, window, True), shuffle=True, **loader)
    val_dl = DataLoader(VoiceDataset(splits["val"], args.audio_dir, window, False), **loader)
    test_dl = DataLoader(VoiceDataset(splits["test"], args.audio_dir, window, False), **loader)

    model, val_best = fit(model, head, train_dl, val_dl, labels, args, device, args.out_dir,
                          class_weights=class_weights)
    finish(model, test_dl, labels, args, device, args.out_dir, val_best,
           example=torch.randn(1, window),
           preprocess={"arch": args.arch, "sample_rate": SAMPLE_RATE, "window_sec": args.window_sec,
                       "input": "mono float32 waveform, 16 kHz, exactly window_sec long (pad or center-crop)"})


if __name__ == "__main__":
    main()
