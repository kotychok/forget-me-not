# Initial M14 measurements

2026-11-02; synthetic content only, Node.js 26.12.1 on macOS/arm64. Encode wall time includes stream/buffer setup (especially the first cold sample), not a CPU profiler or WAN measurement.

| Items | Edit | JSON bytes | Gzip bytes | Reduction | Encode wall ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 | text | 15275 | 4540 | 70.3% | 27.78 |
| 100 | indent | 15263 | 4532 | 70.3% | 3.31 |
| 1000 | text | 151535 | 41888 | 72.4% | 2.11 |
| 1000 | indent | 151523 | 41870 | 72.4% | 1.82 |
| 3000 | text | 454335 | 124243 | 72.7% | 4.84 |
| 3000 | indent | 454323 | 124230 | 72.7% | 5.83 |
| 5000 | text | 757135 | 206739 | 72.7% | 8.56 |
| 5000 | indent | 757123 | 206722 | 72.7% | 8.05 |
