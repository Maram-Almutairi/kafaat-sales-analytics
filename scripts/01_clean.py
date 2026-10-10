"""Step 1 - Data cleaning.

Input : data/Kafaat.csv
Output: data/Kafaat_Cleaned.csv  (original 7 columns, Date converted to ISO)
        output/cleaning_report.md

The rules live in utils.clean_raw() so the dashboard cleans uploaded
files exactly the same way.
"""
import pandas as pd

from utils import CLEAN_CSV, OUTPUT_DIR, RAW_CSV, clean_raw


def report(raw, df, fixes, log):
    removed = len(raw) - len(df)
    lines = [
        "# Cleaning report",
        "",
        f"- Rows in : **{len(raw):,}**",
        f"- Rows out: **{len(df):,}**",
        f"- Removed : **{removed}** ({removed / len(raw):.2%})",
        f"- Date range after cleaning: {df['Date'].min():%Y-%m-%d} .. {df['Date'].max():%Y-%m-%d}",
        "",
        "## Name fixes (rows kept)",
        *[f"- {f}" for f in fixes],
        "",
        "## Removed rows",
        "",
        "| Step | Rows | Reason |",
        "|---|---:|---|",
        *[f"| {step} | {n} | {why} |" for step, n, why, _ in log],
    ]
    for step, n, _, rows in log:
        if n:
            lines += ["", f"### {step}", "", "```", rows.to_string(), "```"]
    return "\n".join(lines) + "\n"


def main():
    raw = pd.read_csv(RAW_CSV, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    df, fixes, log = clean_raw(raw)
    df.to_csv(CLEAN_CSV, index=False, date_format="%Y-%m-%d")
    text = report(raw, df, fixes, log)
    (OUTPUT_DIR / "cleaning_report.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(exist_ok=True)
    main()
