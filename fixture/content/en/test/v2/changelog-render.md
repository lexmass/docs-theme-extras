---
title: Changelog render (enterprise)
weight: 398
description: Renders the interactive changelog toolbar with the open source notes checkbox.
# Direct-path fixture (see gate-transparency.md) so auto-cards.spec.ts's child
# count is unchanged; render:always keeps the page built for the spec to load.
build:
  list: never
  render: always
---

> [!NOTE]
> The toolbar below must not sit flush against this callout.

{{< render path="/changelog/fixture-changelog.json" enterprise="true" >}}
