# Cleaning report

- Rows in : **1,998**
- Rows out: **1,992**
- Removed : **6** (0.30%)
- Date range after cleaning: 2004-06-17 .. 2006-06-16

## Name fixes (rows kept)
- Rep: 'Mjeeed' -> 'Mjeed' (1 row(s))
- Store: 'Lulu Hyper' -> 'Lulu' (1 row(s))

## Removed rows

| Step | Rows | Reason |
|---|---:|---|
| Missing Cost/Sale | 2 | Cost or Sale is empty / not a number, or Sale <= 0 |
| Value outliers | 1 | Cost outside [-7,538, 13,453] or Sale outside [-12,285, 22,387] |
| Date outliers | 3 | Invalid date or outside 2001-12-19 .. 2008-12-24 (isolated far from the rest) |
| Duplicates | 0 | Exact duplicate row |

### Missing Cost/Sale

```
    Date    City    Rep   Store  Prod    Cost     Sale
4  38381  Jeddah  Mjeed   Panda  Home           272.62
5  38364  Dammam  Abdul  Othaim  Food          7346.45
```

### Value outliers

```
    Date    City    Rep Store    Prod      Cost     Sale
6  38736  Dammam  Yahia  Lulu  Office  50000000  7880.54
```

### Date outliers

```
      Date    City     Rep      Store  Prod       Cost     Sale
21   42366  Dammam  Maliha  Carrefour  Toys  7221.7024  8206.48
183  41876  Riyadh  Maliha      Panda  Home  4647.2855  8449.61
195  41876    Hail  Maliha       Lulu  Home  3188.9187  7416.09
```
