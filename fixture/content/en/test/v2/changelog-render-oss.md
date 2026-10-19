---
title: Changelog render (open source)
weight: 399
description: Renders the interactive changelog toolbar without the open source notes checkbox.
# Direct-path fixture (see gate-transparency.md) so auto-cards.spec.ts's child
# count is unchanged; render:always keeps the page built for the spec to load.
build:
  list: never
  render: always
---

{{< render path="/changelog/fixture-changelog.json" >}}
