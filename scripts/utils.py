"""Shared paths, cleaning rules and helpers for the Kafaat pipeline.

Used by scripts/01-04 and by dashboard/app.py (which also cleans files
uploaded by the user with exactly the same rules).
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output"
FIG_DIR = OUTPUT_DIR / "figures"

RAW_CSV = DATA_DIR / "Kafaat.csv"
CLEAN_CSV = DATA_DIR / "Kafaat_Cleaned.csv"

FIELDS = ["Date", "City", "Rep", "Store", "Prod", "Cost", "Sale"]
DIMENSIONS = ["City", "Rep", "Store", "Prod"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

NAME_FIXES = {
    "Rep": {"Mjeeed": "Mjeed"},
    "Store": {"Lulu Hyper": "Lulu"},
}
EXCEL_EPOCH = pd.Timestamp("1899-12-30")
IQR_K = 3.0


def iqr_bounds(s: pd.Series, k: float = IQR_K):
    q1, q3 = s.quantile([0.25, 0.75])
    return q1 - k * (q3 - q1), q3 + k * (q3 - q1)


def to_number(s: pd.Series) -> pd.Series:
    cleaned = s.astype("string").str.replace(r"[\s,]", "", regex=True).replace("", None)
    return pd.to_numeric(cleaned, errors="coerce")


def to_date(s: pd.Series) -> pd.Series:
    """Excel serial numbers (e.g. 38634) or date text (e.g. 2005-10-10) -> Timestamp."""
    serial = to_number(s)
    if serial.notna().mean() > 0.9 and serial.dropna().between(1, 2_958_465).all():
        return EXCEL_EPOCH + pd.to_timedelta(serial.round(), unit="D")
    return pd.to_datetime(s, errors="coerce", format="mixed")


def clean_raw(raw: pd.DataFrame):
    """Apply the cleaning rules to a frame with the FIELDS columns (any dtype).

    Rules, in order:
      1. Trim text fields and fix known spelling variants.
      2. Cost / Sale: strip spaces and thousands separators, cast to number;
         drop rows where either is missing or Sale <= 0.
      3. Drop value outliers: Cost or Sale outside Q1-3*IQR .. Q3+3*IQR.
      4. Date: Excel serial or text -> date; drop invalid dates and dates
         outside Q1-3*IQR .. Q3+3*IQR (isolated typos years away from the rest).
      5. Drop exact duplicate rows.

    Returns (clean_df, fixes, log) where log is a list of
    (step, rows_removed, reason, removed_rows).
    """
    df = raw[FIELDS].copy()
    for col in DIMENSIONS:
        df[col] = df[col].astype("string").str.strip().fillna("(blank)").replace("", "(blank)")
    log, fixes = [], []

    for col, mapping in NAME_FIXES.items():
        for bad, good in mapping.items():
            n = int((df[col] == bad).sum())
            if n:
                fixes.append(f"{col}: '{bad}' -> '{good}' ({n} row(s))")
                df[col] = df[col].replace(bad, good)

    df["Cost"], df["Sale"] = to_number(df["Cost"]), to_number(df["Sale"])
    mask = df["Cost"].isna() | df["Sale"].isna() | (df["Sale"] <= 0)
    log.append(("Missing Cost/Sale", int(mask.sum()), "Cost or Sale is empty / not a number, or Sale <= 0", raw[mask]))
    df = df[~mask]

    c_lo, c_hi = iqr_bounds(df["Cost"])
    s_lo, s_hi = iqr_bounds(df["Sale"])
    mask = ~df["Cost"].between(c_lo, c_hi) | ~df["Sale"].between(s_lo, s_hi)
    log.append(("Value outliers", int(mask.sum()),
                f"Cost outside [{c_lo:,.0f}, {c_hi:,.0f}] or Sale outside [{s_lo:,.0f}, {s_hi:,.0f}]",
                raw.loc[mask[mask].index]))
    df = df[~mask].copy()

    df["Date"] = to_date(df["Date"])
    days = (df["Date"] - EXCEL_EPOCH).dt.days
    d_lo, d_hi = iqr_bounds(days.dropna())
    mask = df["Date"].isna() | ~days.between(d_lo, d_hi)
    lo = EXCEL_EPOCH + pd.Timedelta(days=int(d_lo))
    hi = EXCEL_EPOCH + pd.Timedelta(days=int(d_hi))
    log.append(("Date outliers", int(mask.sum()),
                f"Invalid date or outside {lo:%Y-%m-%d} .. {hi:%Y-%m-%d} (isolated far from the rest)",
                raw.loc[mask[mask].index]))
    df = df[~mask]

    mask = df.duplicated()
    log.append(("Duplicates", int(mask.sum()), "Exact duplicate row", raw.loc[mask[mask].index]))
    df = df[~mask].sort_values("Date").reset_index(drop=True)
    return df, fixes, log


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Profit, Margin_%, Year, Month, YearMonth, Weekday."""
    df = df.copy()
    df["Profit"] = df["Sale"] - df["Cost"]
    df["Margin_%"] = (df["Profit"] / df["Sale"] * 100).round(2)
    df["Year"] = df["Date"].dt.year
    df["Month"] = df["Date"].dt.month
    df["YearMonth"] = df["Date"].dt.to_period("M").dt.to_timestamp()
    df["Weekday"] = pd.Categorical(df["Date"].dt.day_name(), categories=WEEKDAYS, ordered=True)
    return df


def load_clean() -> pd.DataFrame:
    """Load data/Kafaat_Cleaned.csv (the original 7 columns) and add the analysis columns."""
    return add_features(pd.read_csv(CLEAN_CSV, parse_dates=["Date"]))


def summarize(df: pd.DataFrame, by) -> pd.DataFrame:
    """Sales / cost / profit / margin / deal count grouped by one or more columns."""
    g = df.groupby(by, observed=True).agg(
        Deals=("Sale", "size"),
        Total_Sales=("Sale", "sum"),
        Total_Cost=("Cost", "sum"),
        Total_Profit=("Profit", "sum"),
        Avg_Sale=("Sale", "mean"),
    )
    g["Margin_%"] = g["Total_Profit"] / g["Total_Sales"] * 100
    g["Sales_Share_%"] = g["Total_Sales"] / g["Total_Sales"].sum() * 100
    return g.round(2).sort_values("Total_Sales", ascending=False)
