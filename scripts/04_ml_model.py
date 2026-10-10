"""Step 4 - Next-month sales forecast (Linear Regression vs Random Forest).

Unit of prediction: monthly sales per city (6 cities x 23 full months).
The two partial months at the edges (Jun 2004, Jun 2006) are excluded.

Features : city (one-hot), month-of-year, time index, lag 1/2/3, 3-month rolling mean
Split    : time-based - last 4 months are the test set (no shuffling)
Baseline : naive forecast = 3-month rolling mean (a model must beat this to be useful)
Output   : output/ml_metrics.csv, output/ml_feature_importance.csv,
           output/ml_forecast.csv, output/figures/07_feature_importance.png
"""
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from utils import FIG_DIR, OUTPUT_DIR, load_clean

TEST_MONTHS = 4
LAGS = (1, 2, 3)


def build_panel(df):
    full_months = pd.read_csv(OUTPUT_DIR / "monthly_trend.csv").query("~Partial_Month")["YearMonth"]
    full_months = pd.to_datetime(full_months)
    panel = (df[df["YearMonth"].isin(full_months)]
             .groupby(["City", "YearMonth"])["Sale"].sum()
             .unstack(fill_value=0).stack().rename("Sales").reset_index()
             .sort_values(["City", "YearMonth"]))
    return panel


def add_features(panel):
    p = panel.copy()
    g = p.groupby("City")["Sales"]
    for k in LAGS:
        p[f"lag_{k}"] = g.shift(k)
    p["roll3_mean"] = g.transform(lambda s: s.shift(1).rolling(3).mean())
    p["month_of_year"] = p["YearMonth"].dt.month
    p["t"] = (p["YearMonth"].dt.year - 2004) * 12 + p["YearMonth"].dt.month
    p = pd.get_dummies(p, columns=["City"], prefix="city", dtype=int).assign(City=panel["City"])
    return p


def metrics(y, pred):
    return {"MAE": mean_absolute_error(y, pred),
            "RMSE": np.sqrt(mean_squared_error(y, pred)),
            "R2": r2_score(y, pred),
            "MAPE_%": np.mean(np.abs((y - pred) / y)) * 100}


def main():
    df = load_clean()
    panel = build_panel(df)
    data = add_features(panel).dropna().reset_index(drop=True)
    features = [c for c in data.columns if c not in ("Sales", "YearMonth", "City")]

    months = np.sort(data["YearMonth"].unique())
    test_start = months[-TEST_MONTHS]
    train, test = data[data["YearMonth"] < test_start], data[data["YearMonth"] >= test_start]
    print(f"Rows: train {len(train)}, test {len(test)}  "
          f"(test = {pd.Timestamp(test_start):%Y-%m} .. {pd.Timestamp(months[-1]):%Y-%m})")

    models = {
        "Linear Regression": make_pipeline(StandardScaler(), LinearRegression()),
        "Random Forest": RandomForestRegressor(n_estimators=500, max_depth=6, min_samples_leaf=3, random_state=42),
    }
    preds = {"Naive (3-month avg)": test["roll3_mean"].values}
    for name, model in models.items():
        model.fit(train[features], train["Sales"])
        preds[name] = model.predict(test[features])

    # evaluate per city-month and on the company total per month (errors partly cancel)
    total_actual = test.groupby("YearMonth")["Sales"].sum()
    rows = []
    for name, p in preds.items():
        total_pred = pd.Series(p, index=test.index).groupby(test["YearMonth"]).sum()
        rows.append({"Model": name, "Level": "City-month", **metrics(test["Sales"], p)})
        rows.append({"Model": name, "Level": "Company-month", **metrics(total_actual, total_pred)})
    res = pd.DataFrame(rows).set_index(["Level", "Model"]).sort_index().round(3)
    res.to_csv(OUTPUT_DIR / "ml_metrics.csv")
    print("\nTest-set metrics (SAR):\n", res.to_string())

    # feature importance
    rf = models["Random Forest"]
    lr = models["Linear Regression"][-1]
    imp = pd.DataFrame({
        "RF_Importance": rf.feature_importances_,
        "LR_Std_Coef": lr.coef_,  # coefficient per 1 std-dev of the feature
    }, index=features).sort_values("RF_Importance", ascending=False).round(4)
    imp.to_csv(OUTPUT_DIR / "ml_feature_importance.csv")
    print("\nFeature importance:\n", imp.to_string())

    fig, ax = plt.subplots(figsize=(8, 5), facecolor="#fcfcfb")
    top = imp["RF_Importance"].iloc[::-1]
    ax.set_facecolor("#fcfcfb")
    ax.barh(top.index, top.values, color="#2a78d6", height=0.6)
    ax.set_axisbelow(True)
    ax.grid(axis="x", color="#e4e3df")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.set_title("Random Forest feature importance", loc="left", fontweight="bold")
    ax.set_xlabel("Importance (share of impurity reduction)")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "07_feature_importance.png", dpi=150)
    plt.close(fig)

    # forecast next month (2006-06) per city: refit on everything, build next-month features
    next_month = pd.Timestamp(months[-1]) + pd.offsets.MonthBegin(1)
    future = pd.concat([panel, pd.DataFrame({"City": panel["City"].unique(), "YearMonth": next_month,
                                             "Sales": np.nan})], ignore_index=True)
    future = future.sort_values(["City", "YearMonth"]).reset_index(drop=True)
    fx = add_features(future)
    fx = fx[fx["YearMonth"] == next_month]
    out = pd.DataFrame({"City": fx["City"].values, "Naive_3M_Avg": fx["roll3_mean"].values})
    for name, model in models.items():
        model.fit(data[features], data["Sales"])
        out[name] = model.predict(fx[features])
    out = out.set_index("City").round(0)
    out.loc["TOTAL"] = out.sum()
    out.to_csv(OUTPUT_DIR / "ml_forecast.csv")
    print(f"\nForecast for {next_month:%Y-%m} (SAR):\n", out.to_string())


if __name__ == "__main__":
    main()
