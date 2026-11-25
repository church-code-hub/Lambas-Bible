---
name: automated-testing
description: Run and add focused Lambas Bible unit, integration, browser, API, PWA, and regression tests.
---
# Automated Testing Engineering
Use `node --test tests/*.test.js` and existing CI syntax checks first. Add focused tests that fail without the behavior change. Use mocks and isolated Test Mode resources. Separate PASS, FAIL, BLOCKED, and NOT RUN. Never claim live GAS behavior from mocks alone.
