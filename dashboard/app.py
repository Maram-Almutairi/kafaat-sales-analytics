"""Sales analytics dashboard - Kafaat sample data or any uploaded sales file.

Run from the project root:
    streamlit run dashboard/app.py

Uploaded CSV / Excel files are mapped to the standard fields
(Date, Sale, Cost + up to 4 grouping columns) and cleaned with the same
rules as scripts/01_clean.py.
"""
import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from utils import DIMENSIONS, RAW_CSV, add_features, clean_raw, summarize  # noqa: E402

BLUE = "#2a78d6"
LIGHT_BLUE = "#b7d3f6"
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]
BLUE_SCALE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
NONE = "— none —"
MAX_SLICES = 5  # pie: top 5 + "Other"

# Column-name guesses used to pre-fill the mapping for uploaded files
GUESSES = {
    "Date": ["date", "orderdate", "invoicedate", "day", "التاريخ", "تاريخ"],
    "Sale": ["sale", "sales", "revenue", "amount", "price", "total", "المبيعات", "البيع", "سعر البيع"],
    "Cost": ["cost", "costs", "cogs", "التكلفة", "الكلفة"],
    "City": ["city", "region", "area", "location", "المدينة", "المنطقة"],
    "Rep": ["rep", "salesrep", "salesperson", "employee", "agent", "المندوب", "البائع"],
    "Store": ["store", "branch", "shop", "customer", "client", "المتجر", "الفرع", "العميل"],
    "Prod": ["prod", "product", "category", "item", "المنتج", "الفئة", "الصنف"],
}
FIELD_LABELS = {"Date": "Date", "Sale": "Sale amount", "Cost": "Cost",
                "City": "Group 1 (e.g. City)", "Rep": "Group 2 (e.g. Rep)",
                "Store": "Group 3 (e.g. Store)", "Prod": "Group 4 (e.g. Product)"}

st.set_page_config(page_title="Sales Analytics Dashboard", page_icon="📊", layout="wide")


@st.cache_data
def read_file(name: str, content: bytes) -> pd.DataFrame:
    import io
    if name.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(content), dtype=str)
    for enc in ("utf-8-sig", "cp1256", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(content), dtype=str, encoding=enc, sep=None,
                               engine="python", keep_default_na=False)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not read the file encoding.")


@st.cache_data
def clean(raw: pd.DataFrame):
    df, fixes, log = clean_raw(raw)
    return add_features(df), fixes, log


def guess(field, columns):
    norm = {c: c.strip().lower().replace(" ", "").replace("_", "") for c in columns}
    for g in GUESSES[field]:
        for c, n in norm.items():
            if n == g.replace(" ", ""):
                return c
    return NONE


# ---------------- Data source ----------------
st.sidebar.header("Data")
source = st.sidebar.radio("Source", ["Kafaat sample data", "Upload my own file"], label_visibility="collapsed")

labels = {d: d for d in DIMENSIONS} | {"Prod": "Product"}
currency = "SAR"

if source == "Kafaat sample data":
    raw = pd.read_csv(RAW_CSV, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    title = "Kafaat Sales Dashboard"
else:
    up = st.sidebar.file_uploader("CSV or Excel file", type=["csv", "xlsx", "xls"])
    if up is None:
        st.title("📊 Sales Analytics Dashboard")
        st.info(
            "**Upload a sales file (CSV or Excel)** from the sidebar.\n\n"
            "One row per sale. It needs at least:\n"
            "- a **date** column (real dates or Excel serial numbers)\n"
            "- a **sale amount** column\n"
            "- a **cost** column\n\n"
            "Plus up to 4 optional grouping columns such as city, sales rep, store/branch or product. "
            "You choose which column is which after uploading. The file is cleaned automatically "
            "(spaces and commas in numbers, blanks, outliers, bad dates, duplicates) and a cleaning report is shown."
        )
        st.stop()
    try:
        uploaded = read_file(up.name, up.getvalue())
    except Exception as e:  # noqa: BLE001 - show any parse error to the user
        st.error(f"Could not read **{up.name}**: {e}")
        st.stop()
    uploaded.columns = [str(c).strip() for c in uploaded.columns]
    cols = list(uploaded.columns)

    with st.sidebar.expander("Column mapping", expanded=True):
        mapping = {}
        for field in ["Date", "Sale", "Cost", *DIMENSIONS]:
            options = [NONE, *cols]
            default = guess(field, cols)
            mapping[field] = st.selectbox(FIELD_LABELS[field], options, index=options.index(default),
                                          key=f"map_{field}")
        currency = st.text_input("Currency", "SAR")

    missing = [f for f in ("Date", "Sale", "Cost") if mapping[f] == NONE]
    if missing:
        st.title("📊 Sales Analytics Dashboard")
        st.warning(f"Choose the column for: **{', '.join(missing)}** (sidebar → Column mapping).")
        st.dataframe(uploaded.head(20), width="stretch")
        st.stop()
    chosen = [c for c in mapping.values() if c != NONE]
    if len(chosen) != len(set(chosen)):
        st.warning("Each column can only be used once in the mapping.")
        st.stop()

    raw = pd.DataFrame(index=uploaded.index)
    for field, col in mapping.items():
        raw[field] = uploaded[col] if col != NONE else "All"
        if field in DIMENSIONS and col != NONE:
            labels[field] = col
    title = f"Sales Dashboard — {up.name}"

try:
    df, fixes, log = clean(raw)
except Exception as e:  # noqa: BLE001
    st.error(f"Cleaning failed - check the column mapping. Details: {e}")
    st.stop()

if df.empty:
    st.error("No valid rows left after cleaning - check the column mapping.")
    st.stop()

dims = [d for d in DIMENSIONS if df[d].nunique() > 1 or source == "Kafaat sample data"]

# ---------------- Filters ----------------
st.sidebar.header("Filters")
d_min, d_max = df["Date"].min().date(), df["Date"].max().date()
date_range = st.sidebar.date_input("Date range", (d_min, d_max), min_value=d_min, max_value=d_max)
start, end = (date_range if len(date_range) == 2 else (date_range[0], d_max))

mask = df["Date"].between(pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1), inclusive="left")
for d in dims:
    options = sorted(df[d].unique())
    picked = st.sidebar.multiselect(labels[d], options, default=options, key=f"flt_{d}_{labels[d]}")
    mask &= df[d].isin(picked)
f = df[mask]

st.title(f"📊 {title}")
st.caption(f"{len(f):,} deals · {start} → {end}")

removed = len(raw) - len(df)
with st.expander(f"🧹 Cleaning report — {len(raw):,} rows in, {len(df):,} kept, {removed:,} removed"):
    st.table(pd.DataFrame([(s, n, why) for s, n, why, _ in log], columns=["Step", "Rows removed", "Reason"]))
    for fx in fixes:
        st.write(f"Name fix: {fx}")
    for step, n, _, rows in log:
        if n:
            st.write(f"**{step}** — removed rows:")
            st.dataframe(rows.head(200), width="stretch")

if f.empty:
    st.warning("No deals match the current filters.")
    st.stop()

# ---------------- KPI cards ----------------
sales, profit = f["Sale"].sum(), f["Profit"].sum()
low = f["Margin_%"] < 15
k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("Total sales", f"{sales:,.0f} {currency}")
k2.metric("Total profit", f"{profit:,.0f} {currency}")
k3.metric("Margin", f"{profit / sales:.1%}")
k4.metric("Deals", f"{len(f):,}", f"avg {f['Sale'].mean():,.0f} {currency}", delta_color="off")
k5.metric("Deals < 15% margin", f"{low.mean():.1%}", f"{f.loc[low, 'Sale'].sum():,.0f} {currency} sales",
          delta_color="off")

# ---------------- Charts ----------------
plot_cfg = dict(template="plotly_white", margin=dict(l=10, r=10, t=50, b=10))


def bar_by(dim, measure, title, text):
    s = summarize(f, dim).reset_index().sort_values(measure).tail(15)
    fig = px.bar(s, x=measure, y=dim, orientation="h", title=title,
                 hover_data={"Total_Sales": ":,.0f", "Total_Profit": ":,.0f", "Margin_%": ":.1f", "Deals": True},
                 text=s.apply(text, axis=1), labels={dim: labels[dim]})
    fig.update_traces(marker_color=BLUE, textposition="outside", cliponaxis=False)
    return fig.update_layout(**plot_cfg, xaxis_title=currency, yaxis_title="")


first, second = (dims + [None, None])[:2]
last_dim = dims[-1] if len(dims) > 1 else None

c1, c2 = st.columns(2)
if first:
    c1.plotly_chart(bar_by(first, "Total_Sales", f"Sales by {labels[first]} (top 15)",
                           lambda r: f"{r.Total_Sales / 1e6:.2f}M" if r.Total_Sales >= 1e6 else f"{r.Total_Sales / 1e3:,.0f}K"),
                    width="stretch")
if last_dim:
    share = f.groupby(last_dim)["Sale"].sum().sort_values(ascending=False)
    if len(share) > MAX_SLICES + 1:
        share = pd.concat([share.iloc[:MAX_SLICES], pd.Series({"Other": share.iloc[MAX_SLICES:].sum()})])
    share = share.rename_axis("Group").reset_index(name="Sale")
    fig = px.pie(share, names="Group", values="Sale", hole=0.45, title=f"Sales share by {labels[last_dim]}",
                 color="Group", color_discrete_sequence=CATEGORICAL)
    fig.update_traces(textinfo="label+percent", sort=False)
    c2.plotly_chart(fig.update_layout(**plot_cfg), width="stretch")

monthly = f.groupby("YearMonth", as_index=False).agg(Sales=("Sale", "sum"), Profit=("Profit", "sum"),
                                                     First=("Date", "min"), Last=("Date", "max"))
covered = (monthly["Last"] - monthly["First"]).dt.days + 1
monthly["Partial"] = covered < monthly["YearMonth"].dt.days_in_month - 3
fig = px.line(monthly, x="YearMonth", y="Sales", markers=True, title="Monthly sales",
              hover_data={"Profit": ":,.0f", "Partial": True})
fig.update_traces(line_color=BLUE, line_width=2)
part = monthly[monthly["Partial"]]
if not part.empty:
    fig.add_scatter(x=part["YearMonth"], y=part["Sales"], mode="markers", name="Partial month",
                    marker=dict(size=11, color="white", line=dict(color=BLUE, width=2)))
fig.update_layout(**plot_cfg, xaxis_title="", yaxis_title=currency, hovermode="x unified")
st.plotly_chart(fig, width="stretch")

c3, c4 = st.columns(2)
if first and last_dim and first != last_dim:
    top_rows = f.groupby(first)["Sale"].sum().nlargest(15).index
    top_cols = f.groupby(last_dim)["Sale"].sum().nlargest(15).index
    heat = (f[f[first].isin(top_rows) & f[last_dim].isin(top_cols)]
            .pivot_table(index=first, columns=last_dim, values="Sale", aggfunc="sum").fillna(0) / 1000)
    fig = px.imshow(heat.round(0), text_auto=",.0f", color_continuous_scale=BLUE_SCALE, aspect="auto",
                    title=f"Sales by {labels[first]} × {labels[last_dim]} (K {currency})")
    c3.plotly_chart(fig.update_layout(**plot_cfg, xaxis_title="", yaxis_title=""), width="stretch")
if second:
    c4.plotly_chart(bar_by(second, "Total_Profit", f"Profit by {labels[second]} (top 15)",
                           lambda r: f"{r['Margin_%']:.1f}%"), width="stretch")

hist = f.assign(Band=f["Margin_%"].lt(15).map({True: "Below 15%", False: "15% or more"}))
fig = px.histogram(hist, x="Margin_%", y="Profit", histfunc="sum", nbins=70, color="Band",
                   title="Profit by deal margin", color_discrete_map={"Below 15%": LIGHT_BLUE, "15% or more": BLUE})
st.plotly_chart(fig.update_layout(**plot_cfg, xaxis_title="Deal margin %", yaxis_title=currency,
                                  bargap=0.1, legend_title=""), width="stretch")

# ---------------- Tables ----------------
show = ["Date", *dims, "Cost", "Sale", "Profit", "Margin_%"]
st.subheader("Top 10 deals by profit")
st.dataframe(
    f.nlargest(10, "Profit")[show].rename(columns=labels)
    .style.format({"Date": "{:%Y-%m-%d}", "Cost": "{:,.2f}", "Sale": "{:,.2f}", "Profit": "{:,.2f}", "Margin_%": "{:.1f}"}),
    width="stretch", hide_index=True)

if dims:
    with st.expander("Summary tables"):
        dim = st.radio("Group by", dims, horizontal=True, format_func=labels.get)
        st.dataframe(summarize(f, dim).rename_axis(labels[dim]), width="stretch")

st.download_button("Download cleaned & filtered data (CSV)",
                   f[show].rename(columns=labels).to_csv(index=False).encode("utf-8-sig"),
                   "cleaned_filtered.csv", "text/csv")
