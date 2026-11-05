# Manual deals

`manual-deals.json` holds off-market deals you want in the shared feed (wholesaler
emails, pocket listings, Coastal Commission agenda items, probate leads...). The scanner
merges them in on every run. The app's **+ Add deal → Export for repo** button creates
this file for you.

```json
[
  {
    "id": "pb-duplex-1",
    "title": "Pacific Beach duplex – off market",
    "address": "123 Example St, San Diego, CA 92109",
    "city": "San Diego",
    "zip": "92109",
    "price": 1850000,
    "units": 2,
    "categories": ["multifamily", "fix_flip"],
    "coastalExemption": false,
    "description": "Seller wants a quick close, needs full rehab.",
    "url": "https://example.com/listing"
  }
]
```

`categories` can be any of `fix_flip`, `new_construction`, `coastal`, `multifamily`;
they are also auto-detected from the title/description and coastal zips.
