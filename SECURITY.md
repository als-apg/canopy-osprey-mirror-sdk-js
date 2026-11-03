# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Don't open a public issue,
pull request or discussion for them.

Use GitHub's private vulnerability reporting: open the repository's
[Security tab](https://github.com/slaclab/canopy-sdk-js/security) and choose
**Report a vulnerability**. Only the maintainers can see the report.

A useful report says:

- which package and version you used, or the commit if you built from source;
- the steps to reproduce it and what you expected to happen;
- the impact as you understand it.

The maintainers will acknowledge the report, work with you on a fix and agree a
disclosure date with you. Tell us if you want to be credited.

## Supported versions

canopy-sdk-js is pre-1.0 and under active development, and all its packages
share one version. Security fixes are made on `main` and published in a new
release; they are not backported to older versions. Use the latest release.

## Scope

This repository holds client libraries and development tooling. It runs no
service. Report a vulnerability in the Canopy server to
[slaclab/canopy](https://github.com/slaclab/canopy/security), and a
vulnerability in a dependency to that project. Tell us too if this SDK's usage
of it makes the impact worse.
