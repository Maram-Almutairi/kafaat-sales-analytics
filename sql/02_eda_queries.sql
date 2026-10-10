-- =====================================================================
-- Kafaat - EDA queries (BigQuery). Mirror scripts/02_eda.py.
-- =====================================================================

-- 1) Overall KPIs
SELECT
  COUNT(*)                                       AS deals,
  MIN(Date)                                      AS first_date,
  MAX(Date)                                      AS last_date,
  ROUND(SUM(Sale), 2)                            AS total_sales,
  ROUND(SUM(Cost), 2)                            AS total_cost,
  ROUND(SUM(Profit), 2)                          AS total_profit,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct,
  ROUND(AVG(Sale), 2)                            AS avg_deal
FROM `kafaat.v_sales`;

-- 2) By city  (-> output/city_summary.csv)
SELECT
  City,
  COUNT(*)                                            AS deals,
  ROUND(SUM(Sale), 2)                                 AS total_sales,
  ROUND(SUM(Profit), 2)                               AS total_profit,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct,
  ROUND(SUM(Sale) / SUM(SUM(Sale)) OVER () * 100, 2)  AS sales_share_pct
FROM `kafaat.v_sales`
GROUP BY City
ORDER BY total_sales DESC;

-- 3) By rep  (-> output/rep_summary.csv)
SELECT
  Rep,
  COUNT(*)                                            AS deals,
  ROUND(SUM(Sale), 2)                                 AS total_sales,
  ROUND(SUM(Profit), 2)                               AS total_profit,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct,
  ROUND(AVG(Sale), 2)                                 AS avg_deal
FROM `kafaat.v_sales`
GROUP BY Rep
ORDER BY total_sales DESC;

-- 4) By store
SELECT
  Store,
  COUNT(*)                                            AS deals,
  ROUND(SUM(Sale), 2)                                 AS total_sales,
  ROUND(SUM(Profit), 2)                               AS total_profit,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct
FROM `kafaat.v_sales`
GROUP BY Store
ORDER BY total_sales DESC;

-- 5) By product with margin  (-> output/product_summary.csv)
SELECT
  Prod,
  COUNT(*)                                            AS deals,
  ROUND(SUM(Sale), 2)                                 AS total_sales,
  ROUND(SUM(Profit), 2)                               AS total_profit,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct,
  ROUND(AVG(Margin_Pct), 2)                           AS avg_deal_margin_pct
FROM `kafaat.v_sales`
GROUP BY Prod
ORDER BY total_sales DESC;

-- 6) Monthly trend  (-> output/monthly_trend.csv)
SELECT
  YearMonth,
  COUNT(*)              AS deals,
  ROUND(SUM(Sale), 2)   AS total_sales,
  ROUND(SUM(Profit), 2) AS total_profit,
  -- first/last month of the data are partial
  DATE_DIFF(MAX(Date), MIN(Date), DAY) + 1 < EXTRACT(DAY FROM LAST_DAY(YearMonth)) - 3 AS partial_month
FROM `kafaat.v_sales`
GROUP BY YearMonth
ORDER BY YearMonth;

-- 7) City x Product sales matrix (heatmap)
SELECT *
FROM (SELECT City, Prod, Sale FROM `kafaat.v_sales`)
PIVOT (ROUND(SUM(Sale), 0) FOR Prod IN ('Food', 'Home', 'Office', 'Toys'))
ORDER BY City;

-- 8) Margin tiers: margin takes only a handful of fixed values
SELECT
  ROUND(Margin_Pct, 1)                                   AS margin_tier,
  COUNT(*)                                               AS deals,
  ROUND(SUM(Sale), 0)                                    AS sales,
  ROUND(SUM(Profit), 0)                                  AS profit,
  ROUND(SUM(Profit) / SUM(SUM(Profit)) OVER () * 100, 2) AS profit_share_pct
FROM `kafaat.v_sales`
GROUP BY margin_tier
ORDER BY margin_tier;

-- 9) Weekday pattern
SELECT
  Weekday,
  COUNT(*)                                            AS deals,
  ROUND(SUM(Sale), 0)                                 AS sales,
  ROUND(SAFE_DIVIDE(SUM(Profit), SUM(Sale)) * 100, 2) AS margin_pct
FROM `kafaat.v_sales`
GROUP BY Weekday, EXTRACT(DAYOFWEEK FROM Date)
ORDER BY EXTRACT(DAYOFWEEK FROM Date);

-- 10) Top 10 deals by profit
SELECT Date, City, Rep, Store, Prod, Cost, Sale, ROUND(Profit, 2) AS Profit, Margin_Pct
FROM `kafaat.v_sales`
ORDER BY Profit DESC
LIMIT 10;
