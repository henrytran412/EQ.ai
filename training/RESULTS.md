# Training results (measured)

Only numbers that were actually measured. The model is chosen on validation; test is reported once.

## Kaggle run 1: commit 5c04d79, 2026-10-24, 1x Tesla T4

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
