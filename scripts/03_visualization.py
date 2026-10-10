"""Step 3 - Charts (PNG) saved to output/figures/.

01_sales_by_city.png     bar   - sales by city (profit labelled)
02_monthly_trend.png     line  - monthly sales, partial months marked
03_product_share.png     donut - sales share by product
04_city_product_heat.png heat  - sales City x Product
05_top10_deals.png       bar   - top 10 deals by profit
06_margin_tiers.png      bar   - profit by margin tier
"""
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd
import seaborn as sns
from matplotlib.colors import LinearSegmentedColormap

from utils import FIG_DIR, OUTPUT_DIR, load_clean

# Reference palette (dataviz skill, light mode)
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
BLUE = "#2a78d6"
MUTED = "#b7d3f6"
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
BLUE_RAMP = LinearSegmentedColormap.from_list(
    "blue", ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"])

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK_2, "text.color": INK,
    "xtick.color": INK_2, "ytick.color": INK_2, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.8, "axes.axisbelow": True, "axes.spines.top": False, "axes.spines.right": False,
    "axes.titlesize": 14, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "font.size": 10, "figure.dpi": 110,
})
K = mticker.FuncFormatter(lambda v, _: f"{v / 1000:,.0f}K")


def save(fig, name):
    fig.tight_layout()
    fig.savefig(FIG_DIR / name, dpi=150)
    plt.close(fig)
    print(f"saved output/figures/{name}")


def sales_by_city(df):
    s = df.groupby("City")[["Sale", "Profit"]].sum().sort_values("Sale")
    fig, ax = plt.subplots(figsize=(9, 4.8))
    bars = ax.barh(s.index, s["Sale"], color=BLUE, height=0.6)
    ax.grid(axis="y", visible=False)
    ax.xaxis.set_major_formatter(K)
    for b, (sale, profit) in zip(bars, s.values):
        ax.text(b.get_width() + 15000, b.get_y() + b.get_height() / 2,
                f"{sale / 1e6:.2f}M  ·  profit {profit / 1000:,.0f}K ({profit / sale:.1%})",
                va="center", color=INK_2, fontsize=9)
    ax.set_xlim(0, s["Sale"].max() * 1.45)
    ax.set_title("Sales by city")
    ax.set_xlabel("Total sales (SAR)")
    save(fig, "01_sales_by_city.png")


def monthly_trend():
    m = pd.read_csv(OUTPUT_DIR / "monthly_trend.csv", parse_dates=["YearMonth"])
    full = m[~m["Partial_Month"]]
    fig, ax = plt.subplots(figsize=(11, 4.8))
    ax.plot(full["YearMonth"], full["Total_Sales"], color=BLUE, lw=2, marker="o", ms=5, label="Monthly sales")
    ax.plot(m["YearMonth"], m["Sales_3M_Avg"], color=INK_2, lw=1.5, ls="--", label="3-month average")
    part = m[m["Partial_Month"]]
    ax.scatter(part["YearMonth"], part["Total_Sales"], s=50, facecolor=SURFACE, edgecolor=BLUE, lw=1.5,
               zorder=3, label="Partial month (half-month of data)")
    for _, r in pd.concat([full.nlargest(1, "Total_Sales"), full.nsmallest(1, "Total_Sales")]).iterrows():
        ax.annotate(f"{r['YearMonth']:%b %Y}\n{r['Total_Sales'] / 1000:,.0f}K", (r["YearMonth"], r["Total_Sales"]),
                    textcoords="offset points", xytext=(0, 10 if r["Total_Sales"] > 400000 else -30),
                    ha="center", fontsize=9, color=INK)
    ax.yaxis.set_major_formatter(K)
    ax.set_ylim(0, m["Total_Sales"].max() * 1.2)
    ax.set_title("Monthly sales trend (Jun 2004 – Jun 2006)")
    ax.set_ylabel("Sales (SAR)")
    ax.legend(frameon=False, loc="lower center", ncol=3)
    save(fig, "02_monthly_trend.png")


def product_share(df):
    s = df.groupby("Prod")["Sale"].sum().sort_values(ascending=False)
    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    ax.pie(s, colors=CATEGORICAL, startangle=90, counterclock=False,
           wedgeprops={"width": 0.42, "edgecolor": SURFACE, "linewidth": 2},
           labels=[f"{p}\n{v / 1e6:.2f}M · {v / s.sum():.1%}" for p, v in s.items()],
           labeldistance=1.15, textprops={"color": INK, "fontsize": 10})
    ax.text(0, 0, f"{s.sum() / 1e6:.2f}M\ntotal sales", ha="center", va="center", fontsize=12, color=INK)
    ax.set_title("Sales share by product")
    save(fig, "03_product_share.png")


def city_product_heat(df):
    pv = df.pivot_table(index="City", columns="Prod", values="Sale", aggfunc="sum") / 1000
    pv = pv.loc[pv.sum(axis=1).sort_values(ascending=False).index]
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.heatmap(pv, annot=True, fmt=",.0f", cmap=BLUE_RAMP, linewidths=2, linecolor=SURFACE,
                cbar_kws={"label": "Sales (K SAR)"}, ax=ax)
    ax.set_title("Sales by city × product (K SAR)")
    ax.set_xlabel("")
    ax.set_ylabel("")
    ax.tick_params(length=0)
    save(fig, "04_city_product_heat.png")


def top10_deals(df):
    t = df.nlargest(10, "Profit").iloc[::-1]
    labels = [f"{r.Date:%Y-%m-%d} · {r.City} · {r.Rep} · {r.Store} · {r.Prod}" for r in t.itertuples()]
    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.barh(labels, t["Profit"], color=BLUE, height=0.6)
    ax.grid(axis="y", visible=False)
    for b, (p, m) in zip(bars, t[["Profit", "Margin_%"]].values):
        ax.text(b.get_width() + 40, b.get_y() + b.get_height() / 2, f"{p:,.0f}  ({m:.0f}%)",
                va="center", fontsize=9, color=INK_2)
    ax.set_xlim(0, t["Profit"].max() * 1.18)
    ax.set_title("Top 10 deals by profit")
    ax.set_xlabel("Profit (SAR)")
    save(fig, "05_top10_deals.png")


def margin_tiers():
    t = pd.read_csv(OUTPUT_DIR / "margin_tiers.csv")
    fig, ax = plt.subplots(figsize=(9, 4.5))
    colors = [MUTED if m < 15 else BLUE for m in t["Margin_%"]]
    bars = ax.bar(t["Margin_%"].map(lambda m: f"{m:g}%"), t["Profit"], color=colors, width=0.65)
    ax.grid(axis="x", visible=False)
    for b, (d, p) in zip(bars, t[["Deals_%", "Profit_%"]].values):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 8000, f"{p:.1f}%\nof profit",
                ha="center", fontsize=8, color=INK_2)
    ax.yaxis.set_major_formatter(K)
    ax.set_ylim(0, t["Profit"].max() * 1.25)
    ax.set_title("Profit by margin tier — each tier holds ~10% of deals")
    ax.set_xlabel("Margin tier (light = below 15%)")
    ax.set_ylabel("Profit (SAR)")
    save(fig, "06_margin_tiers.png")


def main():
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load_clean()
    sales_by_city(df)
    monthly_trend()
    product_share(df)
    city_product_heat(df)
    top10_deals(df)
    margin_tiers()


if __name__ == "__main__":
    main()
