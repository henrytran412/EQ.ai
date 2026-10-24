// Public, aggregate evaluation snapshot. No images, audio, identities, or model weights.
// ONNX scores: training/RESULTS.md, runs 3 and 4 (2026-10-24).
// Kaggle scores and class breakdowns: each run's out/<model>/metrics.json.
// The old run 1 used a different test split and is intentionally not compared here.
export const RESULTS_DATE = 'October 24, 2026'

export type Scores = { accuracy: number; macroF1: number }
export type EmotionResult = { emotion: string; f1: number; recall: number; support: number }
export type ModelResult = {
  id: string
  name: string
  modality: 'Face' | 'Voice'
  role: 'Selected model' | 'Baseline'
  dataset: string
  samples: number
  source: string
  onnx: Scores
  kaggle: Scores
}

export const MODELS: ModelResult[] = [
  {
    id: 'face_convnext', name: 'ConvNeXt-Tiny', modality: 'Face', role: 'Selected model',
    dataset: 'AffectNet', samples: 2395, source: 'training/runs/run3/out/face_convnext/metrics.json',
    onnx: { accuracy: 0.784, macroF1: 0.773 },
    kaggle: { accuracy: 0.7816283924843423, macroF1: 0.770418679130332 },
  },
  {
    id: 'face_mnv3', name: 'MobileNetV3-Large', modality: 'Face', role: 'Baseline',
    dataset: 'AffectNet', samples: 2395, source: 'training/runs/run4/out/face_mnv3/metrics.json',
    onnx: { accuracy: 0.732, macroF1: 0.718 },
    kaggle: { accuracy: 0.7365344467640919, macroF1: 0.7238338903655911 },
  },
  {
    id: 'voice_wavlm', name: 'WavLM-base-plus', modality: 'Voice', role: 'Selected model',
    dataset: 'RAVDESS', samples: 208, source: 'training/runs/run3/out/voice_wavlm/metrics.json',
    onnx: { accuracy: 0.875, macroF1: 0.884 },
    kaggle: { accuracy: 0.875, macroF1: 0.8838336971625457 },
  },
  {
    id: 'voice_mel', name: 'EfficientNet-B0', modality: 'Voice', role: 'Baseline',
    dataset: 'RAVDESS', samples: 208, source: 'training/runs/run3/out/voice_mel/metrics.json',
    onnx: { accuracy: 0.635, macroF1: 0.621 },
    kaggle: { accuracy: 0.6442307692307693, macroF1: 0.6325399210002713 },
  },
]

// These class-level scores are from Kaggle evaluation, not the ONNX re-score.
export const FACE_EMOTIONS: EmotionResult[] = [
  { emotion: 'Anger', f1: 0.7382352941176471, recall: 0.7171428571428572, support: 350 },
  { emotion: 'Disgust', f1: 0.7008, recall: 0.6759259259259259, support: 324 },
  { emotion: 'Fear', f1: 0.7979094076655052, recall: 0.7951388888888888, support: 288 },
  { emotion: 'Happy', f1: 0.9372093023255814, recall: 0.9285714285714286, support: 434 },
  { emotion: 'Neutral', f1: 0.7222222222222223, recall: 0.8156862745098039, support: 255 },
  { emotion: 'Sad', f1: 0.6917562724014337, recall: 0.6795774647887324, support: 284 },
  { emotion: 'Surprise', f1: 0.8047982551799348, recall: 0.8021739130434783, support: 460 },
]
export const VOICE_EMOTIONS: EmotionResult[] = [
  { emotion: 'Anger', f1: 0.8493150684931506, recall: 0.96875, support: 32 },
  { emotion: 'Disgust', f1: 0.8387096774193549, recall: 0.8125, support: 32 },
  { emotion: 'Fear', f1: 0.9152542372881356, recall: 0.84375, support: 32 },
  { emotion: 'Happy', f1: 0.8214285714285714, recall: 0.71875, support: 32 },
  { emotion: 'Neutral', f1: 1, recall: 1, support: 16 },
  { emotion: 'Sad', f1: 0.8888888888888888, recall: 0.875, support: 32 },
  { emotion: 'Surprise', f1: 0.8732394366197183, recall: 0.96875, support: 32 },
]

export const FACE_MODEL = MODELS[0]
export const VOICE_MODEL = MODELS[2]
export const percent = (value: number) => `${(value * 100).toFixed(1)}%`
