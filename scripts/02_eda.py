"""Step 2 - Exploratory data analysis.

Writes output/{city,rep,store,product}_summary.csv, monthly_trend.csv,
city_product_matrix.csv and prints the tables used in output/insights.md.
"""
import pandas as pd

from utils import OUTPUT_DIR, load_clean, summarize

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", None)
pd.set_option("display.float_format", "{:,.2f}".format)


def section(title):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def monthly_trend(df):
    m = df.groupby("YearMonth").agg(
        Deals=("Sale", "size"), Total_Sales=("Sale", "sum"), Total_Profit=("Profit", "sum"),
        First_Day=("Date", "min"), Last_Day=("Date", "max"),
    )
    days_in_month = m.index.to_series().dt.days_in_month
    covered = (m["Last_Day"] - m["First_Day"]).dt.days + 1
    # first/last month of the data only cover part of the month
    m["Partial_Month"] = covered < days_in_month - 3
    m["Margin_%"] = m["Total_Profit"] / m["Total_Sales"] * 100
    m["MoM_Growth_%"] = m["Total_Sales"].pct_change() * 100
    m["Sales_3M_Avg"] = m["Total_Sales"].rolling(3).mean()
    m.index = m.index.strftime("%Y-%m")
    return m.drop(columns=["First_Day", "Last_Day"]).round(2)


def main():
    df = load_clean()

    section("OVERVIEW")
    print(f"Deals        : {len(df):,}")
    print(f"Period       : {df['Date'].min():%Y-%m-%d} .. {df['Date'].max():%Y-%m-%d}")
    print(f"Total sales  : {df['Sale'].sum():,.2f}")
    print(f"Total cost   : {df['Cost'].sum():,.2f}")
    print(f"Total profit : {df['Profit'].sum():,.2f}")
    print(f"Margin       : {df['Profit'].sum() / df['Sale'].sum():.2%}")
    print(f"Avg deal     : {df['Sale'].mean():,.2f}  (median {df['Sale'].median():,.2f})")
    print("\nDeal-level stats:\n", df[["Cost", "Sale", "Profit", "Margin_%"]].describe().T)

    for name, col in [("city", "City"), ("rep", "Rep"), ("store", "Store"), ("product", "Prod")]:
        s = summarize(df, col)
        s.to_csv(OUTPUT_DIR / f"{name}_summary.csv")
        section(f"BY {col.upper()}  (top 5 by sales; full table in output/{name}_summary.csv)")
        print(s.head(5))
        top_profit = s.sort_values("Total_Profit", ascending=False).index[:5].tolist()
        print(f"Top 5 by profit: {top_profit}")
        spread = s["Total_Sales"].max() / s["Total_Sales"].min() - 1
        print(f"Best vs worst sales gap: {spread:.1%}")

    section("PRODUCT MARGIN (deal-level distribution)")
    print(df.groupby("Prod")["Margin_%"].describe()[["mean", "std", "min", "50%", "max"]])

    trend = monthly_trend(df)
    trend.to_csv(OUTPUT_DIR / "monthly_trend.csv")
    section("MONTHLY TREND")
    print(trend)
    full = trend[~trend["Partial_Month"]]
    print(f"\nBest full month : {full['Total_Sales'].idxmax()} ({full['Total_Sales'].max():,.0f})")
    print(f"Worst full month: {full['Total_Sales'].idxmin()} ({full['Total_Sales'].min():,.0f})")
    yoy = df.assign(PeriodYear=(df["Date"] >= "2005-06-17").map({False: "Y1", True: "Y2"}))
    yoy = yoy.groupby("PeriodYear")[["Sale", "Profit"]].sum()
    print(f"\nYear-1 (Jun04-Jun05) vs Year-2 (Jun05-Jun06):\n{yoy}")
    print(f"Sales change Y2 vs Y1: {yoy.loc['Y2', 'Sale'] / yoy.loc['Y1', 'Sale'] - 1:.2%}")

    section("CITY x PRODUCT (sales)")
    matrix = df.pivot_table(index="City", columns="Prod", values="Sale", aggfunc="sum").round(0)
    matrix.to_csv(OUTPUT_DIR / "city_product_matrix.csv")
    print(matrix)
    print("\nMargin % by City x Product:")
    print(df.pivot_table(index="City", columns="Prod", values="Profit", aggfunc="sum")
          .div(matrix).mul(100).round(1))

    section("REP x STORE (profit)")
    print(df.pivot_table(index="Rep", columns="Store", values="Profit", aggfunc="sum").round(0))

    section("PATTERNS")
    wd = summarize(df, "Weekday").sort_index()
    print("By weekday:\n", wd[["Deals", "Total_Sales", "Margin_%"]])
    print(f"\nCorrelation Cost~Sale     : {df['Cost'].corr(df['Sale']):.3f}")
    print(f"Correlation Sale~Margin_% : {df['Sale'].corr(df['Margin_%']):.3f}")
    # Margin is not continuous: every deal sits on one of a few fixed pricing tiers
    tiers = df.groupby(df["Margin_%"].round(1)).agg(
        Deals=("Sale", "size"), Sales=("Sale", "sum"), Profit=("Profit", "sum"))
    tiers["Deals_%"] = tiers["Deals"] / tiers["Deals"].sum() * 100
    tiers["Profit_%"] = tiers["Profit"] / tiers["Profit"].sum() * 100
    tiers.round(2).to_csv(OUTPUT_DIR / "margin_tiers.csv")
    print(f"\nDistinct margin tiers: {len(tiers)}\n", tiers)
    low = df[df["Margin_%"] < 15]
    print(f"\nDeals with margin < 15%: {len(low)} ({len(low) / len(df):.1%}), "
          f"sales {low['Sale'].sum():,.0f}, profit {low['Profit'].sum():,.0f}")
    print("Low-margin deals by rep:\n", low["Rep"].value_counts())
    print("Low-margin deals by product:\n", low["Prod"].value_counts())

    section("TOP 10 DEALS BY PROFIT")
    print(df.nlargest(10, "Profit")[["Date", "City", "Rep", "Store", "Prod", "Cost", "Sale", "Profit", "Margin_%"]])


if __name__ == "__main__":
    main()
