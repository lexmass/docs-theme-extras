---
title: Test status badge (legacy slot override)
weight: 396
description: Renders the doc-test badge on a page whose under-heading slot override already prints one.
test_status: passed
fixture_legacy_badge: true
# Direct-path fixture (see gate-transparency.md) so auto-cards.spec.ts's child
# count is unchanged; render:always keeps the page built for the spec to load.
build:
  list: never
  render: always
---

The badge, if any, renders under the page title.
