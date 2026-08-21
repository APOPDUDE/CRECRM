# Canonical startUrls for the seven county sweep tasks (2026-08-21)

Alex pasted one failing and one succeeding Apify run. Diffed, they are **identical in
every field except `startUrls`**:

| | failing run | succeeding run (Manatee, 06:26 ET) |
|---|---|---|
| category | `restaurants` | `industrial-properties` + `land` |
| transaction | `for-sale` only | `for-lease` **and** `for-sale` |
| urls | 1 | 4 |
| everything else | identical | identical |

`includeListingDetails: false`, `proxy: RESIDENTIAL`, `maxItems: 10000`,
`maxRequestRetries: 8` are already correct in **both** — so none of them is the cause,
and the three option changes I proposed earlier this session are moot.

Two things are wrong with the failing input:

1. **`restaurants` is not in the sweep's scope at all.** `sweep_finalize_off_market`,
   `v_sweep_coverage` and the off-market diff all filter to `industrial` + `land`. A
   restaurants run contributes nothing to off-market detection even when it succeeds —
   it is spend with no effect, and it burns one of the retry slots.
2. **`for-sale` only.** The working pattern crawls lease *and* sale. Half the book is
   invisible to a for-sale-only task.

Corroborating evidence from the DB: over 21 days Hillsborough's morning county slot has
produced exactly four small ingests (18, 26, 34, 7 items — each alongside Pasco, i.e.
bleed from the neighbouring county's run), while the separate 10:00 ET Hillsborough task
produced nine ingests totalling 199 items. **There is no working morning Hillsborough
county run**, which is what a task pointed at the wrong category looks like.

## The pattern that works

```
https://www.loopnet.com/search/{industrial-properties|land}/{county}-county-fl/{for-lease|for-sale}/
```

Four URLs per county — two categories x two transaction types. Below, that pattern
applied to all seven counties. Everything outside `startUrls` is copied verbatim from
the run that succeeded.

> Not verified against LoopNet: `www.loopnet.com` is blocked by this session's egress
> policy, so these URLs are constructed from the known-good Manatee run, not fetched.


## Hillsborough

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/hillsborough-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/hillsborough-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/hillsborough-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/hillsborough-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Pinellas

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/pinellas-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/pinellas-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/pinellas-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/pinellas-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Pasco

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/pasco-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/pasco-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/pasco-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/pasco-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Polk

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/polk-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/polk-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/polk-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/polk-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Manatee

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/manatee-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/manatee-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/manatee-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/manatee-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Sarasota

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/sarasota-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/sarasota-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/sarasota-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/sarasota-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Hernando

```json
{
  "startUrls": [
    {
      "url": "https://www.loopnet.com/search/industrial-properties/hernando-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/industrial-properties/hernando-county-fl/for-sale/"
    },
    {
      "url": "https://www.loopnet.com/search/land/hernando-county-fl/for-lease/"
    },
    {
      "url": "https://www.loopnet.com/search/land/hernando-county-fl/for-sale/"
    }
  ],
  "includeListingDetails": false,
  "downloadImages": false,
  "enablePriceMonitoring": false,
  "monitoringMode": false,
  "transactionTrackingMode": false,
  "includePortfolioProperties": false,
  "moreResults": true,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "maxItems": 10000,
  "maxConcurrency": 20,
  "minConcurrency": 1,
  "maxRequestRetries": 8,
  "CondosFilter": "0",
  "DateIndicator": "0",
  "freeBrowserSearch": false,
  "State": "none",
  "maxImages": 10
}
```

## Worth deciding

- Is a `restaurants` task deliberate for something else (the 225 scraped Hillsborough
  retail rows suggest retail gets collected somewhere)? If so it should not sit in the
  county sweep group, where the retry bot counts its failure as a failed county run.
- `maxConcurrency: 20` against LoopNet on residential proxies is the remaining plausible
  block contributor — it is identical in both runs, so it explains neither this success
  nor this failure, but it is worth lowering if blocks persist after the URLs are fixed.
- Seven hand-maintained task configs will drift again. Building `startUrls` from the
  county name inside WF3 removes the whole class of bug.

