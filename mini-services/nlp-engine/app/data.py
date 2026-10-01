"""Dataset loading for the LIAR corpus (PolitiFact).

Data discipline (BRD §9 — golden test set):
  * train + valid feed the retrieval knowledge base and calibrator.
  * test is FROZEN — used only by /v1/eval release-gate metrics.
"""

from __future__ import annotations

import csv
import hashlib
import os
from dataclasses import dataclass, field
from typing import List

from . import taxonomy

DATA_DIR = os.environ.get(
    "VERITAS_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "raw")),
)


@dataclass
class KBRecord:
    """One human-fact-checked statement from the LIAR corpus."""
    kb_id: str
    rating: str                 # true | mostly-true | half-true | barely-true | false | pants-fire
    statement: str
    subjects: List[str] = field(default_factory=list)
    speaker: str = ""
    speaker_job: str = ""
    state: str = ""
    party: str = ""
    context: str = ""
    credit_history: List[int] = field(default_factory=list)  # [barely, false, half, mostly, pants]

    @property
    def taxonomy_label(self) -> str:
        return taxonomy.RATING_TO_TAXONOMY[self.rating]

    @property
    def direction(self) -> float:
        return taxonomy.RATING_TO_DIRECTION[self.rating]

    @property
    def primary_subject(self) -> str:
        return self.subjects[0].replace("-", " ").title() if self.subjects else "General"

    @property
    def retrieval_doc(self) -> str:
        """Weighted document used for TF-IDF: statement dominates, metadata adds signal."""
        subjects = " ".join(self.subjects)
        return (
            f"{self.statement} {self.statement} {subjects} {subjects} "
            f"{self.speaker} {self.speaker_job} {self.state}"
        )


def _parse_tsv(path: str) -> List[KBRecord]:
    records: List[KBRecord] = []
    with open(path, "r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            if len(row) < 12:
                continue
            try:
                rec = KBRecord(
                    kb_id=row[0].replace(".json", ""),
                    rating=row[1].strip().lower(),
                    statement=row[2].strip(),
                    subjects=[s for s in row[3].split(",") if s.strip()] if row[3].strip() else [],
                    speaker=row[4].strip() if len(row) > 4 else "",
                    speaker_job=row[5].strip() if len(row) > 5 else "",
                    state=row[6].strip() if len(row) > 6 else "",
                    party=row[7].strip() if len(row) > 7 else "",
                    context=row[13].strip() if len(row) > 13 else "",
                    credit_history=[int(x) if x.strip().isdigit() else 0 for x in row[8:13]],
                )
                if rec.rating in taxonomy.RATING_TO_TAXONOMY and rec.statement:
                    records.append(rec)
            except (ValueError, IndexError):
                continue
    return records


def load_corpus() -> dict:
    """Load train/valid/test splits with provenance metadata."""
    splits = {}
    for name, fname in (("train", "train.tsv"), ("valid", "valid.tsv"), ("test", "test.tsv")):
        path = os.path.join(DATA_DIR, fname)
        splits[name] = _parse_tsv(path)
    return {
        "splits": splits,
        "kb": splits["train"] + splits["valid"],  # retrieval knowledge base
        "calibration_set": splits["valid"],      # used to fit the calibrator
        "frozen_test": splits["test"],           # golden test set — never tuned on
        "data_dir": DATA_DIR,
        "checksums": {
            fname: hashlib.md5(open(os.path.join(DATA_DIR, fname), "rb").read()).hexdigest()
            for fname in ("train.tsv", "valid.tsv", "test.tsv")
        },
    }
