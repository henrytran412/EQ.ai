# Training results (measured)

Only numbers that were actually measured. The model is chosen on validation; test is reported once.

## Kaggle run 3 (current models): 2026-10-24, 2x Tesla T4

Code: base commit a4473ee plus the working-tree changes committed with this file (Kaggle
`--local-snapshot`, source SHA256 936c94e5...; every snapshot file matched the local code).
Outputs: `training/runs/run3/` (gitignored). Face data re-split 80/10/10 by perceptual hash
(train 19,021 / val 2,376 / test 2,395) because AffectNet's own test/sad folder was entirely copies
of train/val. Voice: RAVDESS split by actor (train 1-18, val 19-20, test 21-24).

| Model | val macro-F1 | test accuracy | test macro-F1 | shipped ONNX re-scored locally |
|---|---|---|---|---|
| **face_convnext** (ConvNeXt-Tiny) | 0.785 | 0.782 | 0.770 | **0.784 / 0.773** (single view, as shipped) |
| **voice_wavlm** (WavLM-base-plus) | 0.825 | 0.875 | 0.884 | **0.875 / 0.884** (identical) |
| voice_mel (EfficientNet-B0, log-mel) | 0.730 | 0.644 | 0.633 | 0.635 / 0.621 (fp16 log-mel in eval vs fp32 ONNX) |

Kaggle's face numbers use flip test-time augmentation; the shipped single-view ONNX scores slightly higher.

Test per emotion, face_convnext (F1 / recall / n):

| anger | disgust | fear | happy | neutral | sad | surprise |
|---|---|---|---|---|---|---|
| 0.738 / 71.7% / 350 | 0.701 / 67.6% / 324 | 0.798 / 79.5% / 288 | 0.937 / 92.9% / 434 | 0.722 / 81.6% / 255 | 0.692 / 68.0% / 284 | 0.805 / 80.2% / 460 |

Test per emotion, voice_wavlm (F1 / recall / n):

| anger | disgust | fear | happy | neutral | sad | surprise |
|---|---|---|---|---|---|---|
| 0.849 / 96.9% / 32 | 0.839 / 81.2% / 32 | 0.915 / 84.4% / 32 | 0.821 / 71.9% / 32 | 1.000 / 100% / 16 | 0.889 / 87.5% / 32 | 0.873 / 96.9% / 32 |

### Face baseline on the same split (Kaggle run 4, commit 81658b0)

MobileNetV3-Large (`--model mobilenetv3_large_100`, other settings default). The face manifest was
byte-identical to run 3's, so both models were tested on the same 2,395 images. The run did all
30 epochs (no early stop) and the best val was at epoch 24 (EMA weights). Outputs: `training/runs/run4/`.

| Face model | val macro-F1 | test acc / macro-F1 (flip TTA) | shipped ONNX, single view | ONNX size | laptop CPU, 1 image |
|---|---|---|---|---|---|
| MobileNetV3-Large (baseline) | 0.742 | 0.737 / 0.724 | 0.732 / 0.718 | 17 MB | 3.3 ms |
| **ConvNeXt-Tiny** | 0.785 | 0.782 / 0.770 | 0.784 / 0.773 | 111 MB | 35.7 ms |
| gain | +0.043 | +0.045 / +0.047 | +0.052 / +0.054 | | |

Test F1 per emotion, baseline vs ConvNeXt:

| anger | disgust | fear | happy | neutral | sad | surprise |
|---|---|---|---|---|---|---|
| 0.690 vs 0.738 | 0.656 vs 0.701 | 0.733 vs 0.798 | 0.916 vs 0.937 | 0.675 vs 0.722 | 0.650 vs 0.692 | 0.748 vs 0.805 |

ConvNeXt is better on every emotion. The gain is larger than this test set's sampling noise (about
+/-1.7 points at 95% for each model). Timing is onnxruntime on the dev laptop CPU, not on the Jetson.

Limits:
- Voice test is 208 clips from 4 actors (16-32 per emotion): roughly +/-5 points. RAVDESS is acted
  speech of two fixed sentences; expect lower accuracy on real, accented student speech (not measured).
- Face labels come from labels.csv (origin undocumented); test measures agreement with those labels.

## Kaggle run 1: commit 5c04d79, 2026-10-24, 1x Tesla T4 (old split, superseded)

Source: the Kaggle kernel log (`henrytran412/eq-ai-train` version 1), copied by hand because the run
was stopped before Kaggle saved its output files.

### face_mnv3: MobileNetV3-Large baseline (same family as the old project), ImageNet-pretrained

Data: cleaned AffectNet manifest (train 11,919 / val 1,318 / test 10,555 images, duplicates removed).
Early stop at epoch 27; best val macro-F1 at epoch 21. About 27 s per epoch after the first.

| | accuracy | macro-F1 |
|---|---|---|
| val (best epoch) | 0.704 | 0.700 |
| **test** | **0.706** | **0.660** |

Test per emotion (F1 / recall / n):

| anger | disgust | fear | happy | neutral | sad | surprise |
|---|---|---|---|---|---|---|
| 0.680 / 0.637 / 1605 | 0.646 / 0.626 / 1581 | 0.662 / 0.606 / 1367 | 0.906 / 0.927 / 2163 | 0.640 / 0.789 / 1112 | **0.379 / 0.339 / 579** | 0.708 / 0.715 / 2148 |

Notes:
- The old project reported 72.8% accuracy / 71.8% macro-F1, but on a test split containing
  about 1,500 byte-identical copies of training images. The two numbers are not comparable:
  the test set changed too (duplicates removed, class mix different).
- "sad" is weak (recall 0.34) and rare in test (579 of 10,555 vs 2,107 of 11,919 in train). Not yet investigated.

### voice_wavlm: stopped, not finished

Epoch 1 val macro-F1 0.124, epoch 2 val macro-F1 0.309. Each epoch took about 37 minutes because random
speed-perturbation rates made resampling 300-1000x slower (fixed in commit 6fc3c0f). No test result.
