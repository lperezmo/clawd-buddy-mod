# Contributing

Thanks for wanting to help Clawd out.

## Bugs and ideas

Open an [issue](https://github.com/lperezmo/clawd-buddy-mod/issues/new/choose).
For a bug, include your Claude Code version (`claude --version`), your OS, and
whether it happens in the terminal or the desktop app.

## Pull requests

1. Fork and branch from `main`.
2. The mod lives in `plugins/clawd-buddy/hooks`. Load your copy with
   `/plugin marketplace add <path to your clone>` and `/reload-plugins`.
3. Before pushing, run what CI runs (needs [Bun](https://bun.sh) canary):

   ```
   bun fmt --check .
   bun lint --max-warnings 0
   ```

4. Keep PRs small and say what you checked by hand.

Don't edit `hooks/sprites.ts` by hand; `bun tools/extract-sprites.ts` generates it.

## License

By contributing you agree your code is released under the [MIT License](LICENSE).
Clawd's sprites belong to Anthropic; see [NOTICE](plugins/clawd-buddy/NOTICE).
