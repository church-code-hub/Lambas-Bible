# Risk-Based Verification

## Small UI or documentation
- Use the smallest syntax, text, or focused test available.
- Browser/visual verification only when it materially checks the result.

## JavaScript
- Run the relevant test file or test name.
- Run syntax checks for touched scripts.

## Backend
- Run focused backend-smoke tests and static contract checks.
- Use isolated Test Mode data/deployment for integration only.

## Cross-module
- Run relevant frontend and backend tests, then the integration suites tied to the contract.

## Authentication, permissions, security, data integrity, or protected components
- Run targeted tests plus focused independent review.
- Do not modify protected QR implementation.
- Use no production resources.

Run the full suite before major release, broad architectural change, or when cross-cutting risk is not covered by targeted tests.
