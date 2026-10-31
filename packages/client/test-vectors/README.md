# Vendored canopy contract vectors

The two JSON files here are byte copies of canopy's contract vector files. canopy defines them; this package only
tests against them.

| File | canopy source | git blob |
|------|---------------|----------|
| `heartbeat_vectors.json` | `src/canopy/contracts/heartbeat_vectors.json` | `135edc5948eb9231f66a7619aa2b0a93140b25f0` |
| `wc6_vectors.json` | `src/canopy/contracts/wc6_vectors.json` | `76b9e92b62c8a9b3a8e2898547ad30ecd2f35d79` |

Both copies match canopy commit `c75a9176687b4cefbdeedfd4748664bf7ffff1fe`, which last changed either file. That
commit is not on canopy `main` yet; the files land there with the canopy change that adds the heartbeat
reachability and write-state fields and the WC6 write relay. `git hash-object <file>` here must print the blob
above, and equal `git rev-parse <canopy commit>:<canopy source>`.

- `heartbeat_vectors.json`: what a heartbeat's `reachable` and `writes` fields mean and what the viewer shows for
  them. Read by `src/hare/HarePVService.test.ts`.
- `wc6_vectors.json`: the WC6 write-outcome table, one row per way a screen write can end. Read by
  `src/hare/submit.test.ts`, which checks `src/hare/writeOutcome.ts` against it.

## Rules

- Never edit or reformat these files here. `.prettierignore` excludes this directory.
- canopy's `tests/canopy/hare/test_heartbeat_vectors_vendor.py` and `test_write_vectors_vendor.py` compare the raw
  bytes of these copies with canopy's files when `CANOPY_SCHEMA_SIBLINGS` points at a checkout of this repo.
- To update: change the file in canopy first, copy it here byte for byte, and update the commit and blobs above.
