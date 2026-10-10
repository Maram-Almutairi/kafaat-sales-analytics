-- =====================================================================
-- Kafaat - Advanced queries with window functions (BigQuery)
-- =====================================================================

-- 1) Rank reps inside each city (RANK + share of city sales)
SELECT
  City,
  Rep,
  ROUND(SUM(Sale), 0)                                                  AS sales,
  RANK() OVER (PARTITION BY City ORDER BY SUM(Sale) DESC)              AS rank_in_city,
  ROUND(SUM(Sale) / SUM(SUM(Sale)) OVER (PARTITION BY City) * 100, 2)  AS share_of_city_pct
FROM `kafaat.v_sales`
GROUP BY City, Rep
ORDER BY City, rank_in_city;

-- 2) Best product per city (QUALIFY keeps rank 1 only)
SELECT
  City,
  Prod,
  ROUND(SUM(Sale), 0) AS sales
FROM `kafaat.v_sales`
GROUP BY City, Prod
QUALIFY ROW_NUMBER() OVER (PARTITION BY City ORDER BY SUM(Sale) DESC) = 1
ORDER BY sales DESC;

-- 3) Monthly sales with MoM growth, 3-month moving average and running total
WITH m AS (
  SELECT YearMonth, SUM(Sale) AS sales, SUM(Profit) AS profit
  FROM `kafaat.v_sales`
  GROUP BY YearMonth
)
SELECT
  YearMonth,
  ROUND(sales, 0)                                                                AS sales,
  ROUND(SAFE_DIVIDE(sales - LAG(sales) OVER w, LAG(sales) OVER w) * 100, 2)      AS mom_growth_pct,
  ROUND(AVG(sales) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 0)         AS sales_3m_avg,
  ROUND(SUM(sales) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 0) AS running_sales,
  ROUND(SAFE_DIVIDE(profit, sales) * 100, 2)                                     AS margin_pct
FROM m
WINDOW w AS (ORDER BY YearMonth)
ORDER BY YearMonth;

-- 4) Same month a year earlier (YoY) per city
WITH m AS (
  SELECT City, YearMonth, SUM(Sale) AS sales
  FROM `kafaat.v_sales`
  GROUP BY City, YearMonth
)
SELECT
  City,
  YearMonth,
  ROUND(sales, 0)                                                   AS sales,
  ROUND(LAG(sales, 12) OVER (PARTITION BY City ORDER BY YearMonth), 0) AS sales_last_year,
  ROUND(SAFE_DIVIDE(sales, LAG(sales, 12) OVER (PARTITION BY City ORDER BY YearMonth)) * 100 - 100, 2) AS yoy_pct
FROM m
ORDER BY City, YearMonth;

-- 5) Top 3 deals by profit inside every store
SELECT Store, Date, City, Rep, Prod, Sale, ROUND(Profit, 2) AS Profit,
       DENSE_RANK() OVER (PARTITION BY Store ORDER BY Profit DESC) AS rank_in_store
FROM `kafaat.v_sales`
QUALIFY rank_in_store <= 3
ORDER BY Store, rank_in_store;

-- 6) Rep low-margin exposure: share of each rep's deals sold below 15% margin
SELECT
  Rep,
  COUNT(*)                                                       AS deals,
  COUNTIF(Margin_Pct < 15)                                       AS low_margin_deals,
  ROUND(COUNTIF(Margin_Pct < 15) / COUNT(*) * 100, 2)            AS low_margin_pct,
  ROUND(SUM(IF(Margin_Pct < 15, Sale, 0)), 0)                    AS low_margin_sales,
  RANK() OVER (ORDER BY COUNTIF(Margin_Pct < 15) / COUNT(*) DESC) AS risk_rank
FROM `kafaat.v_sales`
GROUP BY Rep
ORDER BY risk_rank;

-- 7) Profit opportunity: lift if every deal below 15% margin moved to the 25% tier
SELECT
  COUNT(*)                                AS low_margin_deals,
  ROUND(SUM(Profit), 0)                   AS current_profit,
  ROUND(SUM(Sale * 0.25), 0)              AS profit_at_25pct,
  ROUND(SUM(Sale * 0.25) - SUM(Profit), 0) AS profit_uplift
FROM `kafaat.v_sales`
WHERE Margin_Pct < 15;

-- 8) Deal-size quartiles per product (NTILE)
SELECT
  Prod,
  quartile,
  COUNT(*)                     AS deals,
  ROUND(MIN(Sale), 0)          AS min_sale,
  ROUND(MAX(Sale), 0)          AS max_sale,
  ROUND(AVG(Margin_Pct), 2)    AS avg_margin_pct
FROM (
  SELECT Prod, Sale, Margin_Pct, NTILE(4) OVER (PARTITION BY Prod ORDER BY Sale) AS quartile
  FROM `kafaat.v_sales`
)
GROUP BY Prod, quartile
ORDER BY Prod, quartile;

-- 9) Next-month forecast in BigQuery ML (ARIMA_PLUS) - cloud alternative to scripts/04_ml_model.py
CREATE OR REPLACE MODEL `kafaat.sales_forecast`
OPTIONS (model_type = 'ARIMA_PLUS', time_series_timestamp_col = 'YearMonth',
         time_series_data_col = 'sales', time_series_id_col = 'City', data_frequency = 'MONTHLY') AS
SELECT City, YearMonth, SUM(Sale) AS sales
FROM `kafaat.v_sales`
WHERE YearMonth BETWEEN '2004-07-01' AND '2006-05-01'  -- full months only
GROUP BY City, YearMonth;

SELECT City, forecast_timestamp, ROUND(forecast_value, 0) AS forecast_sales,
       ROUND(prediction_interval_lower_bound, 0) AS lower, ROUND(prediction_interval_upper_bound, 0) AS upper
FROM ML.FORECAST(MODEL `kafaat.sales_forecast`, STRUCT(1 AS horizon, 0.9 AS confidence_level));
