# towelie

Local code review tool. Fast, easy and without clutter.

## Usage

```bash
uvx towelie
```

This starts a local server at `http://localhost:4242` and opens it in your browser.

## Development

```bash
uv run towelie --dev
```

This runs:
- FastAPI with backend auto-reload
- Bun frontend watcher for `bundle.js`
- Tailwind watcher for `output.css`

Browser reload is manual in dev mode, but every refresh will pick up the latest built JS/CSS.
