---
title: Test status badge (failed)
weight: 396
description: Renders the doc-test badge for a page whose test_status is failed.
test_status: failed
# Direct-path fixture (see gate-transparency.md) so auto-cards.spec.ts's child
# count is unchanged; render:always keeps the page built for the spec to load.
build:
  list: never
  render: always
---

The badge, if any, renders under the page title.
