Content for `hugo-sitemap-i18n.toml`, the only multilingual fixture build.
`en/` and `ja/` hold the same two pages, so each page has a translation and
the sitemap emits `hreflang` alternates. Pages under a language root are
paired by path, so keep the file names identical in both directories.
