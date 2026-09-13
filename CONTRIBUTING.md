# Contributing

Use Node.js 24 and `npm ci`. Keep the single-owner, self-hosted scope small. Discuss larger changes in an issue before implementing them.

- Use strict TypeScript and shared validated interfaces. Keep lease calculations and trip reconstruction pure.
- Follow `docs/architecture.md` for time, mileage, missing-data and replay semantics. Never turn missing readings into zero mileage.
- Use synthetic records in tests, screenshots and bug reports. Never submit tokens, private keys, real VINs or driving histories.
- Run `npm run check`, broker integration tests and browser tests for affected behavior. Stop the dedicated test containers afterward.
- Update current documentation and `changelog.md` for functional changes. Version bug fixes by 0.0.1 and features by 0.1.0; keep the project below 1.0.0 until an explicit stable-release decision.
- Describe the user-visible change and validation in pull requests. Preserve upstream license notices. Contributions to this repository are provided under its MIT license.

Report security issues privately through GitHub's private vulnerability-reporting feature when available, rather than posting credentials or exploit details in a public issue.
