# Evaluation protocol

The 18 article specifications in `posts.json` were drafted by the coding assistant after visually inspecting the downloaded contact sheet, **before running the final model**. They are AI-assisted manual labels and should be reviewed by the intern. They are not a claim of independent human annotation.

- **Calibration:** 6 articles (5 positive image labels, 1 no-match case). Only this split selects confidence/similarity thresholds.
- **Held-out test:** 12 articles (11 positives, 1 no-match case). It is evaluated only after threshold selection. Gold labels and filenames are never model inputs.
- **Exact-image top-1:** exact labeled first accepted image / all positive posts. Abstention counts as incorrect for a positive post.
- **Subject top-1:** correct semantic subject / all positive posts. It does not replace exact-image precision.
- **Coverage:** accepted result / all positive posts.
- **Offered precision:** exact image correct / positive posts for which a recommendation is offered.
- **Decision accuracy:** correct exact image or correct no-match decision / all test posts.

Several same-subject images can be plausible. Strict exact-image labels intentionally penalize a different plausible fox or coffee cup, so interpret exact-image and subject metrics together. Tiny, curated results are not a population performance estimate.

Run `npm run evaluate` only after the real background jobs finish. It refuses to report when corpus images are pending/failed. It reads the actual persisted model outputs/vectors, searches a declared threshold grid on calibration, writes `thresholds.json`, and saves detailed results to `docs/proof/real-evaluation.json`. Restart the API to load newly calibrated thresholds. It does not call a model, modify gold labels or inspect held-out labels while choosing thresholds.

Deterministic tests inject fixed vectors and synthetic metadata to verify guard/control flow. **They are never used to calculate the real-model accuracy number.**
