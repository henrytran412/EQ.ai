"""Accuracy, macro F1 and confusion matrix, with no ML library dependency."""


def classification_metrics(y_true: list[int], y_pred: list[int], labels: list[str]) -> dict:
    n = len(labels)
    confusion = [[0] * n for _ in range(n)]  # rows = true label, columns = predicted
    for t, p in zip(y_true, y_pred):
        confusion[t][p] += 1

    per_class = {}
    for i, name in enumerate(labels):
        tp = confusion[i][i]
        predicted = sum(row[i] for row in confusion)
        support = sum(confusion[i])
        precision = tp / predicted if predicted else 0.0
        recall = tp / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[name] = {"precision": precision, "recall": recall, "f1": f1, "support": support}

    total = sum(map(sum, confusion))
    return {
        "accuracy": sum(confusion[i][i] for i in range(n)) / total if total else 0.0,
        "macro_f1": sum(c["f1"] for c in per_class.values()) / n,
        "per_class": per_class,
        "confusion": confusion,
    }
