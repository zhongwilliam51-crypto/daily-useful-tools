# Daily Useful Tools

Build small, practical things that solve one concrete everyday problem. The user authorizes daily creation, testing and publication to this public GitHub repository at 20:00 Asia/Hong_Kong.

- Read README.md and catalog.json first. Inspect the latest remote state before editing and preserve unrelated changes.
- One completed tool per Hong Kong calendar date; use catalog dates for idempotency. If today's tool already exists, do not manufacture another commit.
- Prefer standalone buildless HTML with local processing, no dependencies, no accounts and no API keys. Other formats are fine when they better solve the problem.
- Keep instructions understandable, keyboard access usable and layouts responsive. Avoid analytics and third-party requests.
- Never publish personal data, secrets, machine paths, recovery information or local automation state. Use synthetic examples.
- Test actual behavior and important edge cases. For browser tools, smoke-test the UI and mobile layout when browser automation is available.
- Update catalog.json, the README collection, and the index.html catalog together. Keep existing public URLs working.
- Each entry needs a real date, clear purpose, working instructions and appropriate verification. Record only real completed work.
- Publish verified changes to main; no force push, no deleting user work, no fabrication of tests or successful deployments. Reuse the user's signed-in GitHub browser if CLI authentication is unavailable; don't extract browser credentials or create tokens as a workaround.
- GitHub Pages serves main at the repository root. Verify publication and include the live URL and commit URL in the completion report.
- The user wants the whole production-to-publication flow to continue autonomously. Stop only for a concrete missing permission, login or irreducible blocker, and state it plainly.

Current verification: `node --test test-*.mjs` (Node.js >=20, no package installation).
