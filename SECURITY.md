# Security

VulnForge is research software, not a guarantee that a project is secure.
A scan report can contain sensitive dependency and project information.

## Reporting a sensitive issue

Do not publish credentials, exploit details affecting private systems, or private
project reports in a public issue or pull request.

No dedicated private security contact or response-time commitment has been set
for this repository. Use GitHub private vulnerability reporting if the repository
shows that option. Otherwise, open a public issue asking the maintainers for a
private reporting channel **without disclosing sensitive details**.

## Before sharing a report

Remove credentials, personal paths, internal package names where necessary, and
any source code you do not have permission to share. Rotate exposed credentials
at their provider; deleting them from the latest commit does not erase history.

## Scope and deployment

The dashboard is designed for a trusted local machine and binds to loopback.
Do not expose its port through a public tunnel or treat it as an authenticated
multi-user service. Keep Node.js and dependencies updated and review optional
AI endpoint configuration before sending project data to a hosted provider.
