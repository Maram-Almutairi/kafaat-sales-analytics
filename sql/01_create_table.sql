-- =====================================================================
-- Kafaat - BigQuery setup
-- Replace `kafaat` with your dataset name (project.dataset if needed).
-- =====================================================================

-- 1) Dataset
CREATE SCHEMA IF NOT EXISTS `kafaat`
OPTIONS (location = 'US', description = 'Kafaat sales analytics');

-- 2) Raw table: every column STRING so dirty values (spaces, blanks,
--    Excel serial dates) load without errors. Load data/Kafaat.csv into it:
--    bq load --source_format=CSV --skip_leading_rows=1 --replace \
--      kafaat.sales_raw data/Kafaat.csv \
--      Date:STRING,City:STRING,Rep:STRING,Store:STRING,Prod:STRING,Cost:STRING,Sale:STRING
CREATE OR REPLACE TABLE `kafaat.sales_raw` (
  Date  STRING,
  City  STRING,
  Rep   STRING,
  Store STRING,
  Prod  STRING,
  Cost  STRING,
  Sale  STRING
);

-- 3) Clean table - same rules as scripts/01_clean.py:
--    trim + spelling fixes, SAFE_CAST numbers, drop blanks,
--    drop Sale <= 0, drop Cost/Sale/Date outside Q1-3*IQR .. Q3+3*IQR,
--    Excel serial -> DATE via DATE_ADD from 1899-12-30, drop duplicates.
CREATE OR REPLACE TABLE `kafaat.sales_clean`
PARTITION BY DATE_TRUNC(Date, MONTH)
CLUSTER BY City, Prod AS
WITH typed AS (
  SELECT
    SAFE_CAST(TRIM(Date) AS INT64) AS DateSerial,
    TRIM(City) AS City,
    CASE TRIM(Rep)   WHEN 'Mjeeed'     THEN 'Mjeed' ELSE TRIM(Rep)   END AS Rep,
    CASE TRIM(Store) WHEN 'Lulu Hyper' THEN 'Lulu'  ELSE TRIM(Store) END AS Store,
    TRIM(Prod) AS Prod,
    SAFE_CAST(NULLIF(REGEXP_REPLACE(Cost, r'[\s,]', ''), '') AS FLOAT64) AS Cost,
    SAFE_CAST(NULLIF(REGEXP_REPLACE(Sale, r'[\s,]', ''), '') AS FLOAT64) AS Sale
  FROM `kafaat.sales_raw`
),
non_null AS (
  SELECT * FROM typed
  WHERE Cost IS NOT NULL AND Sale IS NOT NULL AND DateSerial IS NOT NULL
),
q AS (
  SELECT
    APPROX_QUANTILES(Cost, 4)       AS qc,
    APPROX_QUANTILES(Sale, 4)       AS qs,
    APPROX_QUANTILES(DateSerial, 4) AS qd
  FROM non_null
),
bounds AS (
  SELECT
    qc[OFFSET(1)] - 3 * (qc[OFFSET(3)] - qc[OFFSET(1)]) AS cost_lo,
    qc[OFFSET(3)] + 3 * (qc[OFFSET(3)] - qc[OFFSET(1)]) AS cost_hi,
    qs[OFFSET(1)] - 3 * (qs[OFFSET(3)] - qs[OFFSET(1)]) AS sale_lo,
    qs[OFFSET(3)] + 3 * (qs[OFFSET(3)] - qs[OFFSET(1)]) AS sale_hi,
    qd[OFFSET(1)] - 3 * (qd[OFFSET(3)] - qd[OFFSET(1)]) AS date_lo,
    qd[OFFSET(3)] + 3 * (qd[OFFSET(3)] - qd[OFFSET(1)]) AS date_hi
  FROM q
)
SELECT DISTINCT
  DATE_ADD(DATE '1899-12-30', INTERVAL n.DateSerial DAY) AS Date,
  n.City, n.Rep, n.Store, n.Prod, n.Cost, n.Sale
FROM non_null n
CROSS JOIN bounds b
WHERE n.Cost BETWEEN b.cost_lo AND b.cost_hi
  AND n.Sale BETWEEN b.sale_lo AND b.sale_hi
  AND n.DateSerial BETWEEN b.date_lo AND b.date_hi
  AND n.Sale > 0;

-- 4) Analysis view with derived columns (Looker Studio connects to this)
CREATE OR REPLACE VIEW `kafaat.v_sales` AS
SELECT
  *,
  Sale - Cost                                        AS Profit,
  ROUND(SAFE_DIVIDE(Sale - Cost, Sale) * 100, 2)     AS Margin_Pct,
  EXTRACT(YEAR FROM Date)                            AS Year,
  EXTRACT(MONTH FROM Date)                           AS Month,
  DATE_TRUNC(Date, MONTH)                            AS YearMonth,
  FORMAT_DATE('%A', Date)                            AS Weekday
FROM `kafaat.sales_clean`;

-- 5) Cleaning audit: how many rows were dropped
SELECT
  (SELECT COUNT(*) FROM `kafaat.sales_raw`)   AS rows_raw,
  (SELECT COUNT(*) FROM `kafaat.sales_clean`) AS rows_clean,
  (SELECT COUNT(*) FROM `kafaat.sales_raw`) - (SELECT COUNT(*) FROM `kafaat.sales_clean`) AS rows_removed;
