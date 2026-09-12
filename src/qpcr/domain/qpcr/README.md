# qPCR simulation algorithms 1 and 2

This module produces synthetic data locally; it neither reads an instrument file nor estimates instrument efficiency or fitted R².

Projects without `simulation.curveModel`, or explicitly selecting `legacy-v1`, keep algorithm 1 exactly. `reference-v1` uses algorithm 2 for newly created projects. The optical profile does not change Cq, Tm, gene FWHM, requested fold distributions, biological aggregation, sample n or the statistical results. Serialization records the corresponding algorithm version; old files do not silently upgrade.

## Identity and allocation

- A stable sample key is `groupId/bioRep`, with replicates numbered from 1.
- A stable well key is `groupId/bioRep/geneId/techRep`. Manual Cq and overrides use this key.
- `rowSeeds[groupId/geneId]` regenerates the indicated group's gene draws. Other raw well draws remain unchanged. Changing control draws can legitimately change every normalized fold for that gene.
- Plates allocate contiguously by group → biological replicate → gene → technical replicate, row-major A1–H12. Overflow creates another plate. `plateIndex` is zero-based; globally unique `Well.id` is `plateIndex+1/wellId` (e.g. `2/A1`).
- An individual project is limited to 9,600 wells in this local preview.

## Distribution and noise

Requested target means and SDs are *population arithmetic moments* of an untruncated lognormal distribution. The log-space parameters are `sigma² = ln(1 + (SD/mean)²)` and `mu = ln(mean) - sigma²/2`. Cq is constructed from the resulting log-fold, rather than independently inventing a fold after Cq generation. Finite realizations, added measurement errors and control normalization need not reproduce the requested arithmetic moments exactly. The control's nominal fold mean is fixed at 1; its final geometric mean is 1 by ΔΔCq normalization, not by forcing the arithmetic mean.

Auto fold CV is 0.08 / 0.15 / 0.30 for low / medium / high variation. Manual fold SD is used directly. Measurement scale is 0.5 / 1 / 1.75 for the same presets, with an additional factor of 0.25 for the precision preset. This scale multiplies reference Cq drift, technical Cq SD, Tm SD and fluorescence noise. User overrides and manually entered Cq are applied afterwards and are not multiplied. Gene nominal Cq, Tm and FWHM are model centers/parameters. Primer concentration is saved protocol metadata and has no claimed kinetic effect.

In biological mode, each independent biological sample has one latent expression draw shared across technical wells; Cq is averaged over usable technical wells before computing ΔCq. In technical-only preview, there is one sample per group and individual paired technical reference/target readings form illustration points. Requested fold SD then describes illustrative per-reading variation. All points and test results are marked `inferential=false` in this mode; the displayed point count is not biological n.

## Analysis and missingness

Manual Cq input mode requires explicit values, or a well Cq override, for every active well. A missing manual Cq is not silently replaced by its generated counterpart in the analysis. Explicit exclusions and invalid/nonfinite Cq outside `(0, protocol.cycles]` are removed before aggregation. Missing reference/target chains or missing control chains generate structured QC failures. Other QC flags do not automatically exclude valid Cq: the user decides whether to exclude flagged wells.

Sample SD is undefined (`NaN`, displayed as `—`) for fewer than two values. `GroupAnalysis.cqSD` is SD across the sample-aggregated target Cq values, not within-technical-replicate SD. Technical SD is evaluated separately in structured QC. The MAD outlier rule flags deviations above `max(0.5 Cq, 3 × 1.4826 × MAD)` for at least three usable technical wells and does not automatically remove them.

Welch's two-sided test uses biological-sample ΔCq. The lower Student-t tail comes from jStat to avoid subtracting a CDF near 1. Fewer than two values in either group, nonfinite inputs, a same-group comparison or zero variance in both groups return `not_applicable` with null p. Holm correction is applied over the currently configured valid comparisons *separately for each target gene*. Missing or invalid tests do not become p=0. Thresholds follow the specification's strict `<` boundaries.

## Legacy synthetic curves and protocol fields

Amplification is logistic plus deterministic additive fluorescence noise. Its amplitude is `well.plateau × protocol.quantFactor / 20`, and its baseline and slope come from the current well values. In fixed-threshold mode, the noise-free curve is calibrated so `F(input Cq) = threshold`. In baseline-ΔF mode, its later logistic center is solved so `F(input Cq) - mean(F(configured baseline cycles)) = threshold`. If there is no feasible solution, QC flags this and the curve uses input Cq as the logistic midpoint. Added noise may move an apparent threshold crossing.

**Reported Cq remains the simulated/input latent Cq; this preview does not extract Cq from noisy curves.** It does not fit R², PCR amplification efficiency or other diagnostics. Amplification is sampled at integer cycles. Channel, acquisition mode and volume are retained protocol metadata; they do not change the simulated kinetic model. Thermal temperature/time/ramp settings drive the separate protocol timeline, not a thermodynamic model.

Melting is a synthetic Gaussian `-dF/dT` peak plus deterministic noise with `sigma = FWHM / 2.35482` and peak amplitude `plateau × meltFactor`. Melt start/end and readings-per-degree drive the temperature grid. This preview does not reconstruct integrated melting fluorescence or instrument-specific raw file formats.

Both curve functions use stable well keys and the same row sub-seeds as the generator. Excluded wells can still be viewed as curves, but do not contribute to expression statistics.

## Reference-v1 optical profile

The local source analysis is summarized in `docs/reference-profile.json`, with methods in `scripts/analyze-reference-xls.py`. The four user XLS references contain two distinct amplification/melt numeric payload sets, not four independent experimental runs. Three Ny328 exports share identical numeric data. The two unique sets contain 72 and 63 signal-bearing wells. No reference sample records or individual raw curves are embedded in the application.

Per-well descriptive median 10–90% rise widths were 8.32 and 7.03 cycles. Baseline-detrended SD divided by endpoint dynamic range was approximately 0.00065 and 0.00071; median lag-1 residual correlations were 0.17 and 0.28. Export metadata says signal smoothing is enabled. These summarize processed observations and do not identify true detector-noise parameters. Fluorescence scales differ by approximately four orders of magnitude, so the application continues to use synthetic normalized units, not instrument calibration.

The reference amplification profile uses a five-parameter-logistic shape `logistic(cycle, center, slope)^exponent`, with a bounded keyed exponent centered at 1.7. Generated slope is lognormal centered at 0.54 with log-SD 0.14; generated plateau remains centered at 1.12 with log-SD 0.14. This produces an illustrative rise width around 7–8 cycles. Baseline lies between 0.05 and 0.075 synthetic units. User-entered well parameters still override these generated values.

Within-well point noise is an AR(1) sequence with coefficient 0.4, combined with a weaker shared plate sequence (coefficient 0.45). Innovation keys include stable well identity and row revision; shared-plate keys include plate index and cycle. The point-noise SD envelope is `well.noise × (0.18 + 0.52 × sqrt(signalFraction))`. For the default noise input of 0.004, early point-noise SD is about 0.00072 and increases toward 0.0028 as signal rises. A small amplitude-relative linear baseline drift is also scaled by `well.noise / 0.004`. Noise=0 removes point noise and baseline drift; the seeded shape parameters remain. Precision mode reduces the configured noise before these mappings. These coefficients are restrained model choices guided by the descriptors, not fitted instrument estimates.

Threshold calibration solves against the full noise-free 5PL signal including its baseline drift. Fixed mode aligns absolute F(Cq); baseline mode aligns F(Cq) minus mean(F) within the configured baseline window. An infeasible threshold remains a QC warning, and reported Cq remains latent/input. It is never silently replaced with a fitted crossing.

Reference melt peaks use a split Gaussian with a right/left half-width ratio centered at 0.9. The observed reference medians were 0.89 and 0.91, suggesting a modestly wider left side. The sum of the model's left and right half-widths is exactly the user's FWHM, and the noiseless dominant peak remains centered on the configured Tm. A constant background is 8% of peak amplitude; noise has a smaller AR(1) component with coefficient 0.6 and envelope `well.noise × (0.18 + 0.22 × peakFraction)`. The profile does not introduce automatic second peaks or infer molecular specificity from shape.

## Canonical raw export observations

`rawAmplificationData` returns `{ cycle, rn, deltaRn, baseline }` for the exact plotted amplification points. `rn` is the synthetic normalized signal, and `deltaRn = rn - baseline` where `baseline` is the *noisy* signal mean over the configured baseline-cycle range. This simple convention is not a claim to reproduce the vendor's processing. Missing Cq gives no amplification observations; the export layer can retain an expected cycle grid with blank signal cells. Exclusion does not erase raw observations.

`rawMeltingData` returns `{ reading, temperature, fluorescence, derivative }`. The derivative is exactly the plotted melt y value. Fluorescence is integrated backward using the trapezoid rule and actual temperature spacing, initially using the well baseline as the terminal fluorescence. If extreme noise makes any integrated value negative, every fluorescence value is shifted by one common offset, preserving every derivative and trapezoidal difference. The actual terminal value is then baseline plus that offset. Derivatives are not clipped. Valid Tm/shape parameters can still produce a synthetic melt observation independently of missing Cq; export status records the missing Cq explicitly.

Original detector channels such as `x1-m1`, `x2-m2` and `x4-m4` are not manufactured. The instrument-export-like field organization is a convenience for inspecting synthetic observations, not proof of software-import or hardware compatibility.

## Validation

Tests include analytical ΔCq/ΔΔCq/fold fixtures, a known Student-t probability, invalid variance/sample-size behavior, technical aggregation, missing references and controls, deterministic substreams, single-row regeneration, overflow allocation, outlier QC, noise presets, and threshold/melt parameter fixtures. Separate golden tests preserve legacy values; reference-profile tests check unchanged analysis, threshold alignment, total FWHM/Tm, broad descriptive rise/noise ranges, raw-to-chart equality, trapezoidal integration and extreme-noise offsets. The domain-check gate is an additional deterministic code-pattern check; it cannot prove scientific correctness.
